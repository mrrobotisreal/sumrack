/**
 * Due-load forecast (T38, V2 §7.7) — pure. Buckets every active card's
 * `due` into local calendar days for the next `days` days ASSUMING NO
 * REVIEWS HAPPEN (simple + honest: the UI says «если не заниматься»).
 * Everything already due — today's backlog, including overdue — lands in
 * day 0, so day 0 equals the review queue's due count at end of today.
 *
 * Rule (recorded): a card counts on the local day whose [00:00, 24:00)
 * contains its `dueAt`; overdue cards count on day 0; cards due beyond the
 * window are summarized as `later`.
 */

export interface ForecastCard {
  dueAt: number;
  direction: string;
}

export interface ForecastDay {
  /** 'YYYY-MM-DD', device-local. */
  date: string;
  /** 0 = today. */
  offset: number;
  total: number;
  /** Per card direction (ru-en / en-ru / listening / production). */
  byDirection: Record<string, number>;
}

export interface Forecast {
  days: ForecastDay[];
  /** Cards due before `now` (strictly overdue) — the backlog inside day 0. */
  overdue: number;
  /** Cards due after the window. */
  later: number;
  /** Peak day total (for chart scaling). */
  peak: number;
}

export const FORECAST_DAYS = 30;

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Start of the local day `offset` days after `now`'s day (DST-safe via setDate). */
function dayStart(now: Date, offset: number): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return d.getTime();
}

export function computeForecast(
  cards: readonly ForecastCard[],
  now: Date = new Date(),
  days: number = FORECAST_DAYS,
): Forecast {
  const starts: number[] = [];
  for (let i = 0; i <= days; i++) starts.push(dayStart(now, i));
  const out: ForecastDay[] = starts.slice(0, days).map((s, offset) => ({
    date: localDateKey(new Date(s)),
    offset,
    total: 0,
    byDirection: {},
  }));
  let overdue = 0;
  let later = 0;
  const nowMs = now.getTime();
  for (const c of cards) {
    if (c.dueAt < nowMs) overdue += 1;
    let idx: number;
    if (c.dueAt < starts[1]!) idx = 0;
    else if (c.dueAt >= starts[days]!) {
      later += 1;
      continue;
    } else {
      // binary search the day bucket
      let lo = 1;
      let hi = days - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= c.dueAt) lo = mid;
        else hi = mid - 1;
      }
      idx = lo;
    }
    const day = out[idx]!;
    day.total += 1;
    day.byDirection[c.direction] = (day.byDirection[c.direction] ?? 0) + 1;
  }
  return { days: out, overdue, later, peak: Math.max(0, ...out.map((d) => d.total)) };
}
