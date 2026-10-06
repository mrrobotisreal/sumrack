import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENTS_BY_ID } from '../achievements';
import { recordExamFinished, recordExamVerdictUnlocks } from '../service';
import { XP_TABLE } from '../xp';

/**
 * T71: mock XP (15 per scored subtest, 60 per full mock, 100 first pass — ONE
 * `bumpDailyActivity` per attempt) and the four mock achievements, over a
 * mocked repo layer. The verdict-gated unlocks also fire from the T72/T73
 * path via `recordExamVerdictUnlocks`.
 */

const bumpDailyActivity = vi.hoisted(() => vi.fn());
const unlockAchievement = vi.hoisted(() => vi.fn());
const countCardsInReview = vi.hoisted(() => vi.fn());
const listAttempts = vi.hoisted(() => vi.fn());
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
    exams: { countCardsInReview, listAttempts },
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
  listAttempts.mockReset().mockResolvedValue([]);
});

const unlockedIds = () => unlockAchievement.mock.calls.map((c) => c[0] as string);
const five = (n: number) => ({ writing: n, lexgram: n, reading: n, listening: n, speaking: n });

describe('mock XP table', () => {
  it('15 / 60 / 100', () => {
    expect(XP_TABLE.examSubtestFinished).toBe(15);
    expect(XP_TABLE.examFullFinished).toBe(60);
    expect(XP_TABLE.examFirstPass).toBe(100);
  });
});

describe('recordExamFinished', () => {
  it('a three-subtest full mock: 3×15 + 60 once, first-mock unlocked, no verdict unlocks', async () => {
    const r = await recordExamFinished({
      scope: 'full',
      scoredSubtests: 3,
      pcts: { lexgram: 70, reading: 70, listening: 70 },
      verdict: null,
    });
    expect(r.xp).toBe(105);
    expect(bumpDailyActivity).toHaveBeenCalledWith({ xp: 105 });
    expect(unlockedIds()).toEqual(['torfl-first-mock']);
    expect(listAttempts).not.toHaveBeenCalled();
  });

  it('a single subtest: 15 XP; lexgram ≥ 90 adds «Без словаря»', async () => {
    const r = await recordExamFinished({
      scope: 'subtest',
      scoredSubtests: 1,
      pcts: { lexgram: 92 },
      verdict: null,
    });
    expect(r.xp).toBe(15);
    expect(unlockedIds()).toEqual(['torfl-first-mock', 'torfl-lexgram-90']);
  });

  it('the first pass pays +100; a later pass does not (earlier finished pass in history)', async () => {
    const pass = {
      scope: 'full' as const,
      scoredSubtests: 5,
      pcts: five(85),
      verdict: 'pass' as const,
    };
    const first = await recordExamFinished(pass, { excludeAttemptId: 'me' });
    expect(first.xp).toBe(5 * 15 + 60 + 100);
    expect(unlockedIds()).toEqual(
      expect.arrayContaining(['torfl-first-mock', 'torfl-would-pass', 'torfl-margin']),
    );
    listAttempts.mockResolvedValue([
      { id: 'old', mode: 'mock', status: 'finished', verdict: 'pass-borderline' },
      { id: 'me', mode: 'mock', status: 'finished', verdict: 'pass' },
    ]);
    const second = await recordExamFinished(pass, { excludeAttemptId: 'me' });
    expect(second.xp).toBe(5 * 15 + 60);
  });

  it('a fail verdict never pays the pass bonus nor unlocks would-pass', async () => {
    const r = await recordExamFinished({
      scope: 'full',
      scoredSubtests: 5,
      pcts: five(40),
      verdict: 'fail',
    });
    expect(r.xp).toBe(5 * 15 + 60);
    expect(unlockedIds()).toEqual(['torfl-first-mock']);
  });
});

describe('recordExamVerdictUnlocks (T72/T73 path)', () => {
  it('fires only the verdict-gated pair', async () => {
    await recordExamVerdictUnlocks(five(90), 'pass');
    expect(unlockedIds().sort()).toEqual(['torfl-margin', 'torfl-would-pass']);
    unlockAchievement.mockClear();
    await recordExamVerdictUnlocks(five(70), 'pass');
    expect(unlockedIds()).toEqual(['torfl-would-pass']);
    unlockAchievement.mockClear();
    await recordExamVerdictUnlocks(five(40), 'fail');
    expect(unlockedIds()).toEqual([]);
  });
});

describe('definitions', () => {
  it('the four titles', () => {
    const t = (id: string) => ACHIEVEMENTS_BY_ID.get(id)?.title;
    expect(t('torfl-first-mock')).toBe('Первый вариант');
    expect(t('torfl-would-pass')).toBe('Сдал бы!');
    expect(t('torfl-margin')).toBe('С запасом');
    expect(t('torfl-lexgram-90')).toBe('Без словаря');
  });
});
