import { localDateKey } from './forecast';

/**
 * Year activity heatmap (T38, V2 §7.7) — pure layout over `daily_activity`.
 *
 * INTENSITY FORMULA (recorded): a day's intensity is its XP (`daily_activity.xp`,
 * T19) — the one number that already composites reviews (1–4 per grade),
 * reading (1 per minute), stories, journal, dialogues, scenarios and exams
 * through the XP table. Days with XP 0 but any raw activity (reviews_done,
 * reading_ms, stories_finished — e.g. rows from before T19's XP column)
 * fall back to `reviews + reading minutes + 15·stories`, the XP table's own
 * weights. Level 0 = no activity; levels 1–4 are quartile-free FIXED XP
 * thresholds so a day's colour never shifts when another day is added:
 *   1: 1–19 · 2: 20–49 · 3: 50–99 · 4: ≥ 100 XP.
 *
 * Grid: GitHub-style columns = weeks (Monday-first, the Russian convention),
 * rows = weekdays; the last column holds today; 53 columns cover a full
 * year plus the partial current week. Cells after today are `future`.
 */

export interface ActivityRow {
  date: string;
  xp: number;
  reviewsDone: number;
  readingMs: number;
  storiesFinished: number;
}

export const HEATMAP_THRESHOLDS = [1, 20, 50, 100] as const;
export const HEATMAP_WEEKS = 53;

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatCell {
  date: string;
  value: number;
  level: HeatLevel;
  future: boolean;
}

export interface HeatmapLayout {
  /** weeks[col][row], row 0 = Monday. */
  weeks: HeatCell[][];
  /** Month label at the first column whose Monday-row falls in a new month. */
  monthLabels: { col: number; label: string }[];
  activeDays: number;
  totalXp: number;
  /** Best day in the window. */
  max: { date: string; value: number } | null;
}

const RU_MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

export function dayIntensity(r: Omit<ActivityRow, 'date'>): number {
  if (r.xp > 0) return r.xp;
  return r.reviewsDone + Math.floor(r.readingMs / 60_000) + 15 * r.storiesFinished;
}

export function heatLevel(value: number): HeatLevel {
  let level: HeatLevel = 0;
  HEATMAP_THRESHOLDS.forEach((t, i) => {
    if (value >= t) level = (i + 1) as HeatLevel;
  });
  return level;
}

export function buildHeatmap(
  rows: readonly ActivityRow[],
  now: Date = new Date(),
  weeks: number = HEATMAP_WEEKS,
): HeatmapLayout {
  const byDate = new Map(rows.map((r) => [r.date, dayIntensity(r)]));
  const todayKey = localDateKey(now);
  // Monday of the current week (getDay: 0 = Sunday).
  const mondayOffset = (now.getDay() + 6) % 7;
  const firstMonday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - mondayOffset - (weeks - 1) * 7,
  );

  const out: HeatCell[][] = [];
  const monthLabels: HeatmapLayout['monthLabels'] = [];
  let activeDays = 0;
  let totalXp = 0;
  let max: HeatmapLayout['max'] = null;
  let lastMonth = -1;
  for (let col = 0; col < weeks; col++) {
    const week: HeatCell[] = [];
    for (let row = 0; row < 7; row++) {
      const d = new Date(
        firstMonday.getFullYear(),
        firstMonday.getMonth(),
        firstMonday.getDate() + col * 7 + row,
      );
      const date = localDateKey(d);
      const future = date > todayKey;
      const value = future ? 0 : (byDate.get(date) ?? 0);
      if (value > 0) {
        activeDays += 1;
        totalXp += value;
        if (!max || value > max.value) max = { date, value };
      }
      week.push({ date, value, level: future ? 0 : heatLevel(value), future });
      if (row === 0 && d.getMonth() !== lastMonth) {
        // skip a label on the first column when that month barely shows
        if (!(col === 0 && d.getDate() > 21)) {
          monthLabels.push({ col, label: RU_MONTHS_SHORT[d.getMonth()]! });
        }
        lastMonth = d.getMonth();
      }
    }
    out.push(week);
  }
  return { weeks: out, monthLabels, activeDays, totalXp, max };
}
