import { addDaysToKey } from './dates';

/**
 * Pure streak math (T19, design §7.7). Shared by the motivation service
 * (feature layer) and the dashboard repository, so both always agree.
 *
 * The date-boundary algorithm, recorded per the ticket:
 *  - Day identity is the device-local calendar date AT THE MOMENT of the
 *    event ('YYYY-MM-DD' via localDateKey). Nothing stores a timezone or
 *    UTC day; changing timezones mid-trip simply changes which key "now"
 *    maps to from that moment on.
 *  - A day counts toward the streak when its goal was met (goal_met_at
 *    stamped) OR a streak-freeze covered it (frozen_days row).
 *  - The current streak anchors at today when today already counts,
 *    otherwise at yesterday (today isn't "missed" while it's still
 *    running), and walks backwards over consecutive counted keys.
 *  - Traveling east (Denver → Salzburg) shortens a wall-clock day but never
 *    skips a calendar key; traveling west can revisit a key, and because
 *    counters/goal-met are keyed by date, a revisited day merges into the
 *    already-stamped row — it can never double-count.
 */

export interface StreakDays {
  /** Day keys whose goal was met (daily_activity.goal_met_at != null). */
  met: ReadonlySet<string>;
  /** Day keys covered by a consumed streak-freeze. */
  frozen: ReadonlySet<string>;
}

export interface StreakResult {
  /** Current streak length in days (goal-met + frozen days). */
  current: number;
  /** True when today itself already counts (met or frozen). */
  todayCounted: boolean;
}

function counts(days: StreakDays, key: string): boolean {
  return days.met.has(key) || days.frozen.has(key);
}

export function computeStreak(todayKey: string, days: StreakDays): StreakResult {
  const todayCounted = counts(days, todayKey);
  let cursor = todayCounted ? todayKey : addDaysToKey(todayKey, -1);
  let current = 0;
  while (counts(days, cursor)) {
    current += 1;
    cursor = addDaysToKey(cursor, -1);
  }
  return { current, todayCounted };
}

/**
 * The missed days immediately before today that freezes would have to cover
 * to keep a live streak alive: walking back from yesterday, collect missing
 * keys until a counted day is found.
 *
 * Returns null when there is nothing to (or no way to) cover:
 *  - yesterday already counts (no gap), or
 *  - the gap is longer than `maxCover` (streak already broken — freezes are
 *    NOT wasted on an unsavable streak; recorded decision), or
 *  - no counted day exists before the gap (no streak to save).
 */
export function gapNeedingFreezes(
  todayKey: string,
  days: StreakDays,
  maxCover: number,
): string[] | null {
  if (maxCover <= 0) return null;
  const gap: string[] = [];
  let cursor = addDaysToKey(todayKey, -1);
  while (!counts(days, cursor)) {
    gap.push(cursor);
    if (gap.length > maxCover) return null;
    cursor = addDaysToKey(cursor, -1);
    // No counted day this far back → nothing behind the gap to save.
    if (gap.length > 366) return null;
  }
  return gap.length > 0 ? gap : null;
}
