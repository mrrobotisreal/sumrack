/**
 * Local-day-key arithmetic (T19). A "day key" is a 'YYYY-MM-DD' string
 * produced from the device's CURRENT local timezone at the moment an event
 * happens (see localDateKey in the stats repo). All streak math operates on
 * these strings, never on Date objects carrying a timezone: two events get
 * the same key iff the device's wall calendar said they were the same day.
 *
 * Arithmetic pins keys to UTC noon before adding days so DST transitions
 * (23/25-hour days) can never skip or repeat a key.
 */

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: string): boolean {
  return KEY_RE.test(value);
}

function keyToUtcNoon(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!, 12, 0, 0);
}

function utcToKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** key + n days (n may be negative). */
export function addDaysToKey(key: string, days: number): string {
  return utcToKey(keyToUtcNoon(key) + days * 86_400_000);
}

/** Whole days from `b` to `a` (a − b): diffDayKeys('2026-08-22', '2026-08-20') === 2. */
export function diffDayKeys(a: string, b: string): number {
  return Math.round((keyToUtcNoon(a) - keyToUtcNoon(b)) / 86_400_000);
}

/**
 * T39: epoch ms of the start of the LOCAL day after `now` (device timezone,
 * same convention as `localDateKey` in the stats repo). A card buried at
 * 23:59 comes back at the next midnight, not 24 h later.
 */
export function startOfNextLocalDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

/**
 * T34: the epoch-ms window [start, end) of a LOCAL day key in the device's
 * current timezone — the same convention as `localDateKey`. Counters that
 * ask "what happened today" (quests) filter on it.
 */
export function localDayWindow(key: string): { start: number; end: number } {
  const [y, m, d] = key.split('-').map(Number);
  return {
    start: new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime(),
    end: new Date(y!, m! - 1, d! + 1, 0, 0, 0, 0).getTime(),
  };
}
