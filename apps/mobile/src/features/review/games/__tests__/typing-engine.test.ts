import { describe, expect, it } from 'vitest';

import { XP_TABLE } from '@/features/motivation/xp';

import {
  computeTypingStats,
  judgeTypedWord,
  pickNextWord,
  ROUND_MS,
  typingWeight,
  TYPING_WEIGHTS,
  xpForTypingRound,
  type TypingAttempt,
} from '../typing/engine';

/** T40 — pure typing-trainer engine: stats math, XP brackets, weighted sourcing. */

const attempt = (expected: string, typed: string, correct: boolean): TypingAttempt => ({
  expected,
  typed,
  correct,
  msTaken: 1000,
});

describe('ROUND_MS', () => {
  it('is the 120 s ticket clock', () => {
    expect(ROUND_MS).toBe(120_000);
  });
});

describe('computeTypingStats', () => {
  /*
   * Hand-computed round (ticket example):
   *   дом     typed дом    ✓  folded length 3 → correct chars (3+1) = 4
   *   кошка   typed кошка  ✓  folded length 5 → correct chars (5+1) = 6
   *   окно    typed окн    ✗  wrong → 0 correct chars (still counts 3 typed chars)
   *   ёлка    typed елка   ✓  folded «елка» length 4 → correct chars (4+1) = 5
   * correctChars = 4 + 6 + 5 = 15
   * elapsed 30 000 ms = 0.5 min → wpm = (15 / 5) / 0.5 = 6.0
   * accuracy = 3 correct / 4 words = 0.75
   * chars typed = 3 + 5 + 3 + 4 = 15
   */
  const round: TypingAttempt[] = [
    attempt('дом', 'дом', true),
    attempt('кошка', 'кошка', true),
    attempt('окно', 'окн', false),
    attempt('ёлка', 'елка', true),
  ];

  it('matches the hand-computed round', () => {
    const s = computeTypingStats(round, 30_000);
    expect(s.words).toBe(4);
    expect(s.correctCount).toBe(3);
    expect(s.correctChars).toBe(15);
    expect(s.wpm).toBe(6);
    expect(s.accuracy).toBe(0.75);
    expect(s.chars).toBe(15);
    expect(s.elapsedMs).toBe(30_000);
  });

  it('judges ё/е, casing and stress marks through the shared comparator', () => {
    expect(judgeTypedWord('ёлка', 'елка')).toBe(true);
    expect(judgeTypedWord('Дом', 'дом')).toBe(true);
    expect(judgeTypedWord('ма́ма', 'мама')).toBe(true);
    expect(judgeTypedWord('дом', 'дома')).toBe(false);
  });

  it('counts a correct word by the folded expected length, not the typed one', () => {
    // Stress mark in the expected word must not inflate the character count.
    const s = computeTypingStats([attempt('ма́ма', 'мама', true)], 60_000);
    expect(s.correctChars).toBe(4 + 1);
  });

  it('gives zero WPM and zero accuracy for a zero-elapsed round', () => {
    const s = computeTypingStats(round, 0);
    expect(s.wpm).toBe(0);
    expect(s.accuracy).toBe(0.75);
  });

  it('gives zero WPM, zero accuracy and zero counts for a zero-attempt round', () => {
    const s = computeTypingStats([], 120_000);
    expect(s.words).toBe(0);
    expect(s.wpm).toBe(0);
    expect(s.accuracy).toBe(0);
    expect(s.correctChars).toBe(0);
    expect(s.chars).toBe(0);
  });

  it('rounds WPM to one decimal', () => {
    // Three correct «я»: correctChars = 3 × (1+1) = 6 → 6/5 = 1.2 words over
    // 7 s = 7/60 min → 1.2 / (7/60) = 10.2857… → rounds to 10.3.
    const s = computeTypingStats(
      [attempt('я', 'я', true), attempt('я', 'я', true), attempt('я', 'я', true)],
      7_000,
    );
    expect(s.wpm).toBe(10.3);
  });
});

describe('xpForTypingRound', () => {
  const xp = (wpm: number, accuracy: number, words = 10) =>
    xpForTypingRound({ words, wpm, accuracy });

  it('uses the data table brackets (highest minWpm ≤ wpm)', () => {
    expect(XP_TABLE.typingRound).toEqual([
      { minWpm: 0, xp: 5 },
      { minWpm: 10, xp: 10 },
      { minWpm: 20, xp: 15 },
      { minWpm: 30, xp: 20 },
    ]);
    expect(xp(0, 1)).toBe(5);
    expect(xp(9.9, 1)).toBe(5);
    expect(xp(10, 1)).toBe(10);
    expect(xp(19.9, 1)).toBe(10);
    expect(xp(20, 1)).toBe(15);
    expect(xp(29.9, 1)).toBe(15);
    expect(xp(30, 1)).toBe(20);
    expect(xp(55, 1)).toBe(20);
  });

  it('caps a sloppy round (accuracy below 0.7) at the first bracket', () => {
    expect(xp(45, 0.69)).toBe(5);
    expect(xp(45, 0.7)).toBe(20);
  });

  it('awards nothing for a zero-word round', () => {
    expect(xp(0, 0, 0)).toBe(0);
  });
});

describe('typingWeight', () => {
  it('weights learning ×3, young ×2, mature ×1, and never-reviewed ×3 (ticket, record)', () => {
    expect(typingWeight(1)).toBe(TYPING_WEIGHTS.learning);
    expect(typingWeight(7)).toBe(TYPING_WEIGHTS.young);
    expect(typingWeight(30)).toBe(TYPING_WEIGHTS.mature);
    expect(typingWeight(null)).toBe(TYPING_WEIGHTS.unreviewed);
    expect(TYPING_WEIGHTS.unreviewed).toBe(3);
  });
});

describe('pickNextWord', () => {
  const cands = [
    { id: 'a', minCoreStability: 1 }, // learning
    { id: 'b', minCoreStability: 10 }, // young
    { id: 'c', minCoreStability: 40 }, // mature
    { id: 'd', minCoreStability: null }, // unreviewed
    { id: 'e', minCoreStability: 2 }, // learning
  ];

  it('returns null for an empty pool', () => {
    expect(pickNextWord([], [])).toBeNull();
  });

  it('skips the last 3 served ids when there are at least 5 candidates', () => {
    // rng 0 would normally pick the first candidate ('a'); 'a' is recent, so it is skipped.
    const pick = pickNextWord(cands, ['x', 'a', 'b', 'c'], () => 0);
    expect(pick?.id).not.toBe('b');
    expect(['a', 'b', 'c']).not.toContain(pick?.id);
  });

  it('does not skip recent ids below the 5-candidate floor', () => {
    const few = cands.slice(0, 4);
    expect(pickNextWord(few, ['a', 'b', 'c'], () => 0)?.id).toBe('a');
  });

  it('only skips the LAST three served ids, not the whole history', () => {
    // History ['a','b','c','d','e']: last three are c, d, e → only a, b are eligible.
    const picks = new Set<string>();
    for (const r of [0, 0.5, 0.99])
      picks.add(pickNextWord(cands, ['a', 'b', 'c', 'd', 'e'], () => r)!.id);
    expect([...picks].sort()).toEqual(['a', 'b']);
  });
});
