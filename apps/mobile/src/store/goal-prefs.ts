import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  DEFAULT_DAILY_GOAL,
  parseDailyGoal,
  type DailyGoal,
} from '@/features/motivation/goal-prefs';
import { track } from '@/services/analytics';

/**
 * Daily-goal settings (T19). Same pattern as daily-prefs: hydrated once by
 * DbProvider, setters write through to the settings table fire-and-forget;
 * stored value Zod-validated on read so a corrupt row falls back to
 * defaults. The motivation service reads the goal synchronously from here.
 */
interface GoalPrefsState {
  goal: DailyGoal;
  setGoal: (goal: DailyGoal) => void;
}

export const useGoalPrefs = create<GoalPrefsState>((set) => ({
  goal: DEFAULT_DAILY_GOAL,
  setGoal: (raw) => {
    const goal = parseDailyGoal(raw);
    set({ goal });
    track('daily_goal_changed', { reviews: goal.reviews, readingMin: goal.readingMin });
    void repos.settings.set(SETTING_KEYS.dailyGoal, goal);
  },
}));

/** Load persisted goal after the DB is ready (called by DbProvider). */
export async function hydrateGoalPrefsFromDb(): Promise<void> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.dailyGoal);
  if (stored != null) {
    useGoalPrefs.setState({ goal: parseDailyGoal(stored) });
  }
}
