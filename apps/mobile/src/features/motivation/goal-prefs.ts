import { z } from 'zod';

/**
 * Daily-goal configuration (T19, §7.7 default: 20 reviews + 10 min
 * reading). Stored as one settings row (SETTING_KEYS.dailyGoal),
 * Zod-validated on read — corrupt values fall back to defaults (T13/T14
 * prefs pattern). A target of 0 disables that half of the goal; both-zero
 * is healed to the defaults so the goal can never be trivially "met".
 */
export const DailyGoalSchema = z.strictObject({
  reviews: z.number().int().min(0).max(500),
  readingMin: z.number().int().min(0).max(240),
});
export type DailyGoal = z.infer<typeof DailyGoalSchema>;

export const DEFAULT_DAILY_GOAL: DailyGoal = { reviews: 20, readingMin: 10 };

export const GOAL_REVIEW_OPTIONS = [0, 10, 20, 30, 50] as const;
export const GOAL_READING_OPTIONS = [0, 5, 10, 15, 20, 30] as const;

export function parseDailyGoal(raw: unknown): DailyGoal {
  const parsed = DailyGoalSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_DAILY_GOAL;
  const goal = parsed.data;
  if (goal.reviews === 0 && goal.readingMin === 0) return DEFAULT_DAILY_GOAL;
  return goal;
}

/** Whether the day's counters satisfy the goal (every non-zero target reached). */
export function goalIsMet(
  goal: DailyGoal,
  activity: { reviewsDone: number; readingMs: number },
): boolean {
  if (goal.reviews > 0 && activity.reviewsDone < goal.reviews) return false;
  if (goal.readingMin > 0 && activity.readingMs < goal.readingMin * 60_000) return false;
  return true;
}
