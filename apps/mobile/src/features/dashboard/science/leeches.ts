/**
 * Leech detection (T38, V2 §7.7) — pure.
 *
 * DEFINITION (recorded): a card is a leech when at least `LEECH_AGAIN_MIN`
 * of its last `LEECH_WINDOW` review_log rows are `Again` (rating 1).
 * Every direction counts (a listening card can be a leech too); rows are
 * ordered by `reviewedAt`.
 *
 * DISMISSAL (recorded): a dismissed leech stays suppressed until it earns an
 * `Again` reviewed strictly AFTER `dismissedAt` — then it reappears if it
 * still meets the rule. Re-dismissing overwrites the stamp.
 */

export const LEECH_WINDOW = 10;
export const LEECH_AGAIN_MIN = 4;
export const RATING_AGAIN = 1;

export interface ReviewEvent {
  rating: number;
  reviewedAt: number;
}

export interface LeechStat {
  againCount: number;
  windowSize: number;
  lastReviewedAt: number;
  /** reviewedAt of the newest Again in the window (null when none). */
  lastAgainAt: number | null;
}

/** `history` in any order; only the newest LEECH_WINDOW rows count. */
export function leechStat(history: readonly ReviewEvent[]): LeechStat | null {
  if (history.length === 0) return null;
  const recent = [...history].sort((a, b) => b.reviewedAt - a.reviewedAt).slice(0, LEECH_WINDOW);
  const agains = recent.filter((r) => r.rating === RATING_AGAIN);
  return {
    againCount: agains.length,
    windowSize: recent.length,
    lastReviewedAt: recent[0]!.reviewedAt,
    lastAgainAt: agains[0]?.reviewedAt ?? null,
  };
}

export function isLeech(stat: LeechStat | null): boolean {
  return stat != null && stat.againCount >= LEECH_AGAIN_MIN;
}

/** Visible in the inbox = a leech not covered by a dismissal. */
export function isVisibleLeech(stat: LeechStat | null, dismissedAt: number | null): boolean {
  if (!isLeech(stat)) return false;
  if (dismissedAt == null) return true;
  return stat!.lastAgainAt != null && stat!.lastAgainAt > dismissedAt;
}
