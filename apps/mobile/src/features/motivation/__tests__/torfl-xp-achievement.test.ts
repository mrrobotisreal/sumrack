import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENTS_BY_ID, EXAM_DECK_TARGET } from '../achievements';
import { recordExamDeckSession, recordExamDrillFinished, sweepAchievements } from '../service';
import { XP_TABLE } from '../xp';

/**
 * T70: drill XP (10 per drill / «Молния» session, 5 per deck session — one
 * `bumpDailyActivity` each) and the `torfl-deck-100` unlock predicate
 * (≥ 100 exam cards in the FSRS Review state), over a mocked repo layer.
 */

const bumpDailyActivity = vi.hoisted(() => vi.fn());
const unlockAchievement = vi.hoisted(() => vi.fn());
const countCardsInReview = vi.hoisted(() => vi.fn());
vi.mock('@/db', () => ({
  repos: {
    stats: {
      bumpDailyActivity,
      unlockAchievement,
      getDailyActivity: vi.fn().mockResolvedValue(null),
      getStreakDays: vi.fn().mockResolvedValue({ met: new Set(), frozen: new Set() }),
      markGoalMet: vi.fn(),
      insertFrozenDays: vi.fn(),
      getTotalXp: vi.fn().mockResolvedValue(0),
      getScenarioStats: vi
        .fn()
        .mockResolvedValue({ finishedRunCount: 0, cleanRunCount: 0, familiesCompleted: 0 }),
    },
    bank: { countItems: vi.fn().mockResolvedValue(0) },
    reviews: { countMasteredLemmas: vi.fn().mockResolvedValue(0) },
    dialogues: {
      getAchievementStats: vi
        .fn()
        .mockResolvedValue({ finishedRunCount: 0, anyDialogueAllEndingsSeen: false }),
    },
    exams: { countCardsInReview },
    settings: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/query-client', () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/store/goal-prefs', () => ({
  useGoalPrefs: { getState: () => ({ goal: { reviews: 0, readingMin: 0 } }) },
}));
vi.mock('../notifications', () => ({ replanReminders: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../toast-store', () => ({
  useAchievementToasts: { getState: () => ({ push: vi.fn() }) },
}));

beforeEach(() => {
  bumpDailyActivity.mockReset().mockResolvedValue(undefined);
  unlockAchievement.mockReset().mockResolvedValue(true);
  countCardsInReview.mockReset().mockResolvedValue(0);
});

const unlockedIds = () => unlockAchievement.mock.calls.map((c) => c[0] as string);

describe('exam drill XP', () => {
  it('the table: 10 per drill, 5 per deck session', () => {
    expect(XP_TABLE.examDrillFinished).toBe(10);
    expect(XP_TABLE.examDeckSession).toBe(5);
  });
  it('recordExamDrillFinished bumps XP once by 10 and returns it', async () => {
    expect(await recordExamDrillFinished()).toBe(10);
    expect(bumpDailyActivity).toHaveBeenCalledTimes(1);
    expect(bumpDailyActivity).toHaveBeenCalledWith({ xp: 10 });
  });
  it('recordExamDeckSession bumps XP once by 5 and returns it', async () => {
    expect(await recordExamDeckSession()).toBe(5);
    expect(bumpDailyActivity).toHaveBeenCalledTimes(1);
    expect(bumpDailyActivity).toHaveBeenCalledWith({ xp: 5 });
  });
});

describe('torfl-deck-100', () => {
  it('is a defined achievement with the spec title', () => {
    expect(ACHIEVEMENTS_BY_ID.get('torfl-deck-100')?.title).toBe('Работа над ошибками');
    expect(EXAM_DECK_TARGET).toBe(100);
  });
  it('does not unlock at 99 Review-state cards', async () => {
    countCardsInReview.mockResolvedValue(99);
    await sweepAchievements();
    expect(unlockedIds()).not.toContain('torfl-deck-100');
  });
  it("unlocks at exactly 100 (idempotency is the stats repo's unlock)", async () => {
    countCardsInReview.mockResolvedValue(100);
    await sweepAchievements();
    expect(unlockedIds()).toContain('torfl-deck-100');
  });
});
