import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACHIEVEMENTS_BY_ID } from '../achievements';
import { recordScenarioFinished } from '../service';

/**
 * The three scenario unlock predicates (T62 §9.4) over a mocked stats repo:
 * `first-scenario-finished` ← finishedRunCount ≥ 1 · `scenario-clean-run`
 * ← cleanRunCount ≥ 1 · `scenario-family-all-rungs` ← familiesCompleted ≥ 1,
 * and the XP bump the finish awards.
 */

const getScenarioStats = vi.hoisted(() => vi.fn());
const unlockAchievement = vi.hoisted(() => vi.fn());
const bumpDailyActivity = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
vi.mock('@/db', () => ({
  repos: {
    stats: {
      getScenarioStats,
      unlockAchievement,
      bumpDailyActivity,
      getDailyActivity: vi.fn().mockResolvedValue(null),
      getStreakDays: vi.fn().mockResolvedValue({ met: new Set(), frozen: new Set() }),
      markGoalMet: vi.fn(),
      insertFrozenDays: vi.fn(),
    },
    settings: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('@/services/analytics', () => ({ track }));
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
  getScenarioStats.mockReset();
  unlockAchievement.mockReset().mockResolvedValue(true);
  bumpDailyActivity.mockReset().mockResolvedValue(undefined);
  track.mockReset();
});

const unlockedIds = () => unlockAchievement.mock.calls.map((c) => c[0] as string);

describe('recordScenarioFinished', () => {
  it('awards 25 + 2 × cleanTurns for a dirty run and unlocks only first-scenario-finished', async () => {
    getScenarioStats.mockResolvedValue({
      finishedRunCount: 1,
      cleanRunCount: 0,
      familiesCompleted: 0,
    });
    const xp = await recordScenarioFinished({ turns: 4, cleanTurns: 2 });
    expect(xp).toBe(29);
    expect(bumpDailyActivity).toHaveBeenCalledWith({ xp: 29 });
    expect(unlockedIds()).toContain('first-scenario-finished');
    expect(unlockedIds()).not.toContain('scenario-clean-run');
    expect(unlockedIds()).not.toContain('scenario-family-all-rungs');
  });

  it('a clean run unlocks scenario-clean-run and pays the 40 + 2 × turns', async () => {
    getScenarioStats.mockResolvedValue({
      finishedRunCount: 2,
      cleanRunCount: 1,
      familiesCompleted: 0,
    });
    const xp = await recordScenarioFinished({ turns: 4, cleanTurns: 4 });
    expect(xp).toBe(48);
    expect(unlockedIds()).toEqual(
      expect.arrayContaining(['first-scenario-finished', 'scenario-clean-run']),
    );
    expect(unlockedIds()).not.toContain('scenario-family-all-rungs');
  });

  it('every installed rung of a family finished unlocks scenario-family-all-rungs', async () => {
    getScenarioStats.mockResolvedValue({
      finishedRunCount: 3,
      cleanRunCount: 0,
      familiesCompleted: 1,
    });
    await recordScenarioFinished({ turns: 5, cleanTurns: 1 });
    expect(unlockedIds()).toContain('scenario-family-all-rungs');
  });

  it('the three ids are defined achievements with stable copy', () => {
    for (const id of [
      'first-scenario-finished',
      'scenario-clean-run',
      'scenario-family-all-rungs',
    ]) {
      expect(ACHIEVEMENTS_BY_ID.get(id)).toBeDefined();
    }
    expect(ACHIEVEMENTS_BY_ID.get('first-scenario-finished')!.title).toBe('В эфире');
  });
});
