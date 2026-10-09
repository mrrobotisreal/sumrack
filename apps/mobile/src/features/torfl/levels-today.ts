import { TORFL_LEVELS, type TorflLevel } from './level-profile';

/**
 * The TORFL level ordering for the Today rows and the daily `torfl` segment
 * (T75, TORFL_A2 §3, §8) — PURE. THE LEVEL RULE: every level-scoped surface
 * takes its level from here, never from a hard-coded A1.
 */

/** Exam dates per level ('YYYY-MM-DD' | null). */
export type ExamDates = Record<TorflLevel, string | null>;

/**
 * A level is ACTIVE on Today (TORFL_A2 §3) when its exam date is set OR its deck has due items.
 */
export function isLevelActive(date: string | null, deckDue: number): boolean {
  return date !== null || deckDue > 0;
}

/**
 * Order the levels for the daily segment and the Today rows (TORFL_A2 §3, §8, Mitch 2026-10-09):
 * levels WITH a date first, nearest date first (a past date counts as nearest — it's overdue);
 * ties and levels without a date keep the fixed order A1 → A2 («no date → A1 first, then A2»).
 */
export function levelOrder(dates: ExamDates): TorflLevel[] {
  const dated = TORFL_LEVELS.filter((l) => dates[l] !== null);
  const undated = TORFL_LEVELS.filter((l) => dates[l] === null);
  // Array.prototype.sort is stable, so equal dates keep the A1 → A2 order.
  dated.sort((a, b) => (dates[a]! < dates[b]! ? -1 : dates[a]! > dates[b]! ? 1 : 0));
  return [...dated, ...undated];
}

/** The daily `torfl` segment's default (auto) state: on iff ANY level has an exam date. */
export function anyExamDate(dates: ExamDates): boolean {
  return TORFL_LEVELS.some((l) => dates[l] !== null);
}
