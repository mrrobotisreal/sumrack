import { describe, expect, it } from 'vitest';

import { DEFAULT_FREEZE_STATE, earnsFreeze, parseFreezeState } from '../freeze';
import { DEFAULT_DAILY_GOAL, goalIsMet, parseDailyGoal } from '../goal-prefs';

describe('daily goal prefs (T19)', () => {
  it('heals corrupt values to defaults', () => {
    expect(parseDailyGoal(null)).toEqual(DEFAULT_DAILY_GOAL);
    expect(parseDailyGoal({ reviews: 'x' })).toEqual(DEFAULT_DAILY_GOAL);
    expect(parseDailyGoal({ reviews: 20, readingMin: 10, extra: 1 })).toEqual(DEFAULT_DAILY_GOAL);
  });

  it('heals the trivially-met both-zero goal', () => {
    expect(parseDailyGoal({ reviews: 0, readingMin: 0 })).toEqual(DEFAULT_DAILY_GOAL);
  });

  it('goalIsMet requires every non-zero target', () => {
    const goal = { reviews: 20, readingMin: 10 };
    expect(goalIsMet(goal, { reviewsDone: 20, readingMs: 10 * 60_000 })).toBe(true);
    expect(goalIsMet(goal, { reviewsDone: 20, readingMs: 9 * 60_000 })).toBe(false);
    expect(goalIsMet(goal, { reviewsDone: 19, readingMs: 60 * 60_000 })).toBe(false);
  });

  it('a zero target disables that half', () => {
    expect(goalIsMet({ reviews: 0, readingMin: 10 }, { reviewsDone: 0, readingMs: 600_000 })).toBe(
      true,
    );
    expect(goalIsMet({ reviews: 20, readingMin: 0 }, { reviewsDone: 20, readingMs: 0 })).toBe(true);
  });
});

describe('streak-freeze wallet (T19)', () => {
  it('heals corrupt state', () => {
    expect(parseFreezeState(undefined)).toEqual(DEFAULT_FREEZE_STATE);
    expect(parseFreezeState({ available: 99 })).toEqual(DEFAULT_FREEZE_STATE);
  });

  it('earns on 7-day multiples only, capped at 2, once per day', () => {
    const none = { available: 0, lastEarnedOnDate: null };
    expect(earnsFreeze(none, 7, '2026-08-22')).toBe(true);
    expect(earnsFreeze(none, 14, '2026-08-22')).toBe(true);
    expect(earnsFreeze(none, 6, '2026-08-22')).toBe(false);
    expect(earnsFreeze(none, 8, '2026-08-22')).toBe(false);
    expect(earnsFreeze(none, 0, '2026-08-22')).toBe(false);
    expect(earnsFreeze({ available: 2, lastEarnedOnDate: null }, 7, '2026-08-22')).toBe(false);
    expect(earnsFreeze({ available: 1, lastEarnedOnDate: '2026-08-22' }, 7, '2026-08-22')).toBe(
      false,
    );
    expect(earnsFreeze({ available: 1, lastEarnedOnDate: '2026-08-15' }, 7, '2026-08-22')).toBe(
      true,
    );
  });
});
