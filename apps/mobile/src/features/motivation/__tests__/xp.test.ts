import { describe, expect, it } from 'vitest';

import { Rating } from '@/db/repositories/reviews';

import { levelForXp, XP_TABLE, xpForRating, xpForReading, xpToNextLevel } from '../xp';

describe('XP table (T19 §7.7)', () => {
  it('awards per rating, identically for every game mode by construction', () => {
    expect(xpForRating(Rating.Again)).toBe(1);
    expect(xpForRating(Rating.Hard)).toBe(2);
    expect(xpForRating(Rating.Good)).toBe(3);
    expect(xpForRating(Rating.Easy)).toBe(4);
  });

  it('reading XP is per full minute', () => {
    expect(xpForReading(59_000)).toBe(0);
    expect(xpForReading(60_000)).toBe(1);
    expect(xpForReading(10 * 60_000 + 30_000)).toBe(10);
  });

  it('bonuses stay ordered by effort (note < lesson ≤ journal < story < quiz < checkpoint)', () => {
    expect(XP_TABLE.noteCreated).toBeLessThan(XP_TABLE.journalEntry);
    expect(XP_TABLE.lessonCompleted).toBeLessThanOrEqual(XP_TABLE.journalEntry);
    expect(XP_TABLE.journalEntry).toBeLessThan(XP_TABLE.storyFinished);
    expect(XP_TABLE.storyFinished).toBeLessThan(XP_TABLE.unitQuizPassed);
    expect(XP_TABLE.unitQuizPassed).toBeLessThan(XP_TABLE.checkpointPassed);
  });
});

describe('level curve', () => {
  it('costs 100, 150, 200… per level', () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(2)).toBe(150);
    expect(xpToNextLevel(3)).toBe(200);
  });

  it('maps totals to levels at exact boundaries', () => {
    expect(levelForXp(0)).toEqual({ level: 1, intoLevel: 0, levelSpan: 100 });
    expect(levelForXp(99)).toEqual({ level: 1, intoLevel: 99, levelSpan: 100 });
    expect(levelForXp(100)).toEqual({ level: 2, intoLevel: 0, levelSpan: 150 });
    expect(levelForXp(249)).toEqual({ level: 2, intoLevel: 149, levelSpan: 150 });
    expect(levelForXp(250)).toEqual({ level: 3, intoLevel: 0, levelSpan: 200 });
  });

  it('never returns nonsense for negative input', () => {
    expect(levelForXp(-50).level).toBe(1);
  });
});
