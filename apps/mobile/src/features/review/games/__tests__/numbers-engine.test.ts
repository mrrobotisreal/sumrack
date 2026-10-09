import { describe, expect, it } from 'vitest';

import {
  answerKey,
  bandForNumber,
  generateRound,
  isCorrectAnswer,
  mergeBandTallies,
  numberDistractors,
  NUMBERS_TIERS,
  ROUND_SIZE,
  suggestTier,
  tallyBands,
  xpForNumbersRound,
} from '@/features/review/games/numbers/engine';

/** Deterministic LCG so generation is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('generateRound', () => {
  it.each(NUMBERS_TIERS)('tier %i yields a full round of words-only prompts', (tier) => {
    for (let seed = 1; seed <= 25; seed++) {
      const round = generateRound(tier, seeded(seed));
      expect(round).toHaveLength(ROUND_SIZE);
      for (const item of round) {
        // The recorded principle: TTS never gets digits.
        expect(item.spoken).not.toMatch(/\d/);
        expect(item.spoken).toBe(item.spoken.normalize('NFC'));
        expect(item.answer).toMatch(/\d/);
        // The canonical answer always passes its own check.
        expect(isCorrectAnswer(item, item.answer)).toBe(true);
        if (item.mode === 'choice') {
          expect(item.options).toHaveLength(4);
          expect(new Set(item.options).size).toBe(4);
          expect(item.options).toContain(item.answer);
        }
      }
    }
  });

  it('tier 1 is pick-from-4 over 0–20; tiers 2–5 are typed', () => {
    const t1 = generateRound(1, seeded(7));
    expect(t1.every((i) => i.mode === 'choice' && Number(i.answer) <= 20)).toBe(true);
    for (const tier of [2, 3, 4, 5] as const) {
      expect(generateRound(tier, seeded(7)).every((i) => i.mode === 'typed')).toBe(true);
    }
  });

  it('tier 3 mixes prices in; tier 4 covers years, dates and times', () => {
    const t3 = Array.from({ length: 10 }, (_, s) => generateRound(3, seeded(s + 1))).flat();
    expect(t3.some((i) => i.kind === 'price')).toBe(true);
    expect(t3.some((i) => i.kind === 'number')).toBe(true);
    const t4 = Array.from({ length: 10 }, (_, s) => generateRound(4, seeded(s + 1))).flat();
    expect(new Set(t4.map((i) => i.kind))).toEqual(new Set(['year', 'date', 'time']));
    const t5 = Array.from({ length: 10 }, (_, s) => generateRound(5, seeded(s + 1))).flat();
    expect(t5.some((i) => i.kind === 'age')).toBe(true);
    expect(t5.some((i) => i.kind === 'number' && Number(i.answer) > 1000)).toBe(true);
  });
});

describe('isCorrectAnswer', () => {
  it('compares times part-wise or separator-free', () => {
    const item = { kind: 'time' as const, answer: '9:05' };
    expect(isCorrectAnswer(item, '9:05')).toBe(true);
    expect(isCorrectAnswer(item, '09.05')).toBe(true);
    expect(isCorrectAnswer(item, '905')).toBe(true);
    expect(isCorrectAnswer(item, '9.5')).toBe(false);
    expect(isCorrectAnswer(item, '9.50')).toBe(false);
    expect(isCorrectAnswer(item, '95')).toBe(false);
  });

  it('dates need the separator (11.1 vs 1.11 is ambiguous)', () => {
    const item = { kind: 'date' as const, answer: '11.1' };
    expect(isCorrectAnswer(item, '11.1')).toBe(true);
    expect(isCorrectAnswer(item, '11/01')).toBe(true);
    expect(isCorrectAnswer(item, '111')).toBe(false);
    expect(isCorrectAnswer(item, '1.11')).toBe(false);
  });

  it('prices: kopecks two-digit part-wise; whole prices as digits', () => {
    expect(isCorrectAnswer({ kind: 'price', answer: '12.50' }, '12,50')).toBe(true);
    expect(isCorrectAnswer({ kind: 'price', answer: '12.50' }, '12.5')).toBe(false);
    expect(isCorrectAnswer({ kind: 'price', answer: '3.07' }, '3.07')).toBe(true);
    expect(isCorrectAnswer({ kind: 'price', answer: '12.50' }, '1250')).toBe(false);
    expect(isCorrectAnswer({ kind: 'price', answer: '125' }, '125')).toBe(true);
  });

  it('numbers: digits only, empty is wrong', () => {
    expect(isCorrectAnswer({ kind: 'number', answer: '1000000' }, '1 000 000')).toBe(true);
    expect(isCorrectAnswer({ kind: 'number', answer: '0' }, '0')).toBe(true);
    expect(isCorrectAnswer({ kind: 'number', answer: '0' }, '')).toBe(false);
    expect(answerKey('007')).toBe('7');
  });
});

describe('distractors + bands', () => {
  it('distractors are 3 distinct non-answers ≥ 0', () => {
    for (let n = 0; n <= 20; n++) {
      const d = numberDistractors(n, seeded(n + 3));
      expect(d).toHaveLength(3);
      expect(new Set(d).size).toBe(3);
      expect(d).not.toContain(n);
      expect(d.every((x) => x >= 0)).toBe(true);
    }
  });

  it('bands by magnitude', () => {
    expect(bandForNumber(0)).toBe('0-20');
    expect(bandForNumber(20)).toBe('0-20');
    expect(bandForNumber(21)).toBe('21-100');
    expect(bandForNumber(1000)).toBe('101-1000');
    expect(bandForNumber(1001)).toBe('1001+');
  });

  it('tallies and merges per band', () => {
    const a = tallyBands([
      { band: 'price', kind: 'price', correct: true, plays: 1 },
      { band: 'price', kind: 'price', correct: false, plays: 2 },
      { band: '0-20', kind: 'number', correct: true, plays: 1 },
    ]);
    expect(a).toEqual({ price: { seen: 2, correct: 1 }, '0-20': { seen: 1, correct: 1 } });
    expect(mergeBandTallies([a, { price: { seen: 1, correct: 1 } }])).toEqual({
      price: { seen: 3, correct: 2 },
      '0-20': { seen: 1, correct: 1 },
    });
  });
});

describe('suggestTier + XP', () => {
  it('starts at 1, promotes at ≥ 80 %, demotes under 50 %, else stays', () => {
    expect(suggestTier([])).toBe(1);
    expect(suggestTier([{ tier: 2, correct: 9, total: 10 }])).toBe(3);
    expect(suggestTier([{ tier: 5, correct: 10, total: 10 }])).toBe(5);
    expect(suggestTier([{ tier: 3, correct: 4, total: 10 }])).toBe(2);
    expect(suggestTier([{ tier: 1, correct: 2, total: 10 }])).toBe(1);
    expect(suggestTier([{ tier: 3, correct: 6, total: 10 }])).toBe(3);
    // Window: the last three rounds of the latest tier only.
    expect(
      suggestTier([
        { tier: 3, correct: 10, total: 10 },
        { tier: 3, correct: 7, total: 10 },
        { tier: 3, correct: 7, total: 10 },
        { tier: 3, correct: 0, total: 10 },
        { tier: 2, correct: 0, total: 10 },
      ]),
    ).toBe(4);
  });

  it('XP = base 5 + 1 per correct', () => {
    expect(xpForNumbersRound(10, 10)).toBe(15);
    expect(xpForNumbersRound(0, 10)).toBe(5);
    expect(xpForNumbersRound(0, 0)).toBe(0);
  });
});
