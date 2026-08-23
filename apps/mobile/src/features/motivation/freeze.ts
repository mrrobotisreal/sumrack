import { z } from 'zod';

/**
 * Streak-freeze inventory (T19, §7.7: earned, max 2 held). Stored as one
 * settings row (SETTING_KEYS.streakFreeze), Zod-validated on read.
 *
 * Earn rule (recorded decision): +1 freeze each time the streak reaches a
 * multiple of 7 counted days (7, 14, 21, …), capped at MAX_FREEZES held.
 * `lastEarnedOnDate` guards against earning twice for the same day when
 * evaluation runs repeatedly. Consumption coverage is audited per-day in
 * the `frozen_days` table; this row is only the wallet.
 */
export const MAX_FREEZES = 2;
export const FREEZE_EARN_EVERY_DAYS = 7;

export const FreezeStateSchema = z.strictObject({
  available: z.number().int().min(0).max(MAX_FREEZES),
  lastEarnedOnDate: z.string().nullable(),
});
export type FreezeState = z.infer<typeof FreezeStateSchema>;

export const DEFAULT_FREEZE_STATE: FreezeState = { available: 0, lastEarnedOnDate: null };

export function parseFreezeState(raw: unknown): FreezeState {
  const parsed = FreezeStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_FREEZE_STATE;
}

/**
 * Whether meeting the goal today earns a freeze. `todayCounted` is required:
 * a stalled streak re-evaluated on a fresh morning sits at the same multiple
 * and must NOT re-earn (caught live on device — a Vienna-morning boot after
 * a 7-day streak minted a second freeze before this gate existed).
 */
export function earnsFreeze(
  state: FreezeState,
  streak: { current: number; todayCounted: boolean },
  todayKey: string,
): boolean {
  return (
    streak.todayCounted &&
    streak.current > 0 &&
    streak.current % FREEZE_EARN_EVERY_DAYS === 0 &&
    state.available < MAX_FREEZES &&
    state.lastEarnedOnDate !== todayKey
  );
}
