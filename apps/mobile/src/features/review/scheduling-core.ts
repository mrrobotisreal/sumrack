import type { StoredFsrsParams } from './fsrs-settings';

/**
 * T39 Scheduling UI — pure helpers (no React, no DB, no SAF). Kept apart from
 * the section component so the copy rules and the export shape are unit-tested.
 */

export const REVIEW_LOG_KIND = 'sumrak-review-log' as const;
export const REVIEW_LOG_VERSION = 1 as const;

/** «Optimized · 2026-10-09 · 1234 reviews» or the default-parameters line. */
export function formatOptimizerSubtitle(params: StoredFsrsParams | null): string {
  if (params === null) return 'Default parameters (FSRS-6)';
  return `Optimized · ${params.fittedAt.slice(0, 10)} · ${params.reviewCount} reviews`;
}

/** 0.9 → «90 %». Rounds to a whole percent. */
export function formatRetentionPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

/** Whether the «Default 90 %» reset link should show. */
export function retentionIsDefault(value: number, defaultValue = 0.9): boolean {
  return Math.round(value * 100) === Math.round(defaultValue * 100);
}

/** The 21 weights as a compact monospace block, 2 decimals each, 7 per line. */
export function formatWeights(w: readonly number[]): string {
  const rows: string[] = [];
  for (let i = 0; i < w.length; i += 7) {
    rows.push(
      w
        .slice(i, i + 7)
        .map((x) => x.toFixed(2).padStart(7, ' '))
        .join(' '),
    );
  }
  return rows.join('\n');
}

export interface ReviewLogExportInputRow {
  cardId: string;
  direction: string;
  rating: number;
  state: number;
  reviewedAt: number;
  durationMs: number | null;
}

export interface ReviewLogExport {
  v: typeof REVIEW_LOG_VERSION;
  kind: typeof REVIEW_LOG_KIND;
  exportedAt: string;
  timezone: string;
  rows: ReviewLogExportInputRow[];
}

/**
 * The `sumrak-review-log` v1 file body (the shape `fsrs-optimize-core.mjs`
 * parses). Only the six documented columns — no lemma, no text.
 */
export function buildReviewLogExport(
  rows: readonly ReviewLogExportInputRow[],
  now: Date,
  timezone: string,
): ReviewLogExport {
  return {
    v: REVIEW_LOG_VERSION,
    kind: REVIEW_LOG_KIND,
    exportedAt: now.toISOString(),
    timezone,
    rows: rows.map((r) => ({
      cardId: r.cardId,
      direction: r.direction,
      rating: r.rating,
      state: r.state,
      reviewedAt: r.reviewedAt,
      durationMs: r.durationMs,
    })),
  };
}

/** `sumrak-review-log-<YYYY-MM-DD>.json` from the local calendar date of `now`. */
export function reviewLogFileName(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `sumrak-review-log-${y}-${m}-${d}.json`;
}

/** Result copy for the export row. */
export function exportResultMessage(rows: number, fileName: string): string {
  return `Saved ${rows} ${rows === 1 ? 'review' : 'reviews'} to ${fileName}`;
}

/** Retention/bury/suspend copy: the due-date text for a buried card. */
export function isBuried(buriedUntil: number | null | undefined, now: number): boolean {
  return buriedUntil != null && buriedUntil > now;
}
