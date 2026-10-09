/** Type declarations for fsrs-optimize-core.mjs (T39), so TypeScript tests can import it. */

export const REVLOG_KIND: 'sumrak-review-log';
export const PARAMS_KIND: 'sumrak-fsrs-params';
export const FORMAT_VERSION: 1;
export const LOW_REVIEW_THRESHOLD: number;
export const DEFAULT_NEXT_DAY_HOUR: number;
export const CSV_HEADER: string;

export type ErrorCode = 'NOT_ENOUGH_DATA' | 'INVALID_INPUT' | 'OUT_OF_BOUNDS';

export class FsrsOptimizeError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode);
}

export interface ReviewRow {
  cardId: string;
  direction: string;
  rating: number;
  state: number;
  reviewedAt: number;
  durationMs: number | null;
}

export function normalizeRows(rawRows: unknown): ReviewRow[];
export function parseExportJson(text: string): { timezone: string | null; rows: ReviewRow[] };
export function isSqliteBytes(bytes: Uint8Array): boolean;
export function resolveTimezone(
  explicit: string | null | undefined,
  exported: string | null | undefined,
): string;
export function tzOffsetMinutes(ms: number, timeZone: string): number;
export function buildRevlogCsv(rows: ReviewRow[]): {
  csv: string;
  reviewCount: number;
  cardCount: number;
  firstReviewedAt: number | null;
  lastReviewedAt: number | null;
};
export function roundWeights(w: number[]): number[];
export function validateWeights(w: number[]): void;
export function lowReviewWarning(reviewCount: number): string | undefined;

export interface ParamsFile {
  v: 1;
  kind: 'sumrak-fsrs-params';
  w: number[];
  fittedAt: string;
  reviewCount: number;
  cardCount: number;
  logLoss: number;
  rmse: number;
  defaultLogLoss: number;
  defaultRmse: number;
  warning?: string;
}

export function buildParamsFile(input: Omit<ParamsFile, 'v' | 'kind'>): ParamsFile;

export function optimize(options: {
  rows: ReviewRow[];
  timezone: string;
  nextDayHour?: number;
  now?: Date;
  progress?: (current: number, total: number) => boolean | undefined | void;
}): Promise<{
  params: ParamsFile;
  summary: {
    reviewCount: number;
    cardCount: number;
    firstReviewedAt: number | null;
    lastReviewedAt: number | null;
    timezone: string;
    warning: string | undefined;
  };
}>;
