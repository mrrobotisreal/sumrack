import { CLAMP_PARAMETERS, default_w, W17_W18_Ceiling } from 'ts-fsrs';
import { z } from 'zod';

/**
 * T39 FSRS control — pure settings logic (no DB, no React). Desired retention
 * (the 0.8–0.95 band) and the imported optimizer parameter file, both
 * validated here so the store, the settings UI and the tests share one rule.
 */

export const RETENTION_MIN = 0.8;
export const RETENTION_MAX = 0.95;
export const RETENTION_DEFAULT = 0.9;

export const RetentionSchema = z.number().min(RETENTION_MIN).max(RETENTION_MAX);

/** Any stored/entered value → a valid retention, rounded to 2 decimals; invalid → 0.9. */
export function parseRetention(raw: unknown): number {
  const parsed = RetentionSchema.safeParse(raw);
  if (!parsed.success) return RETENTION_DEFAULT;
  return Math.round(parsed.data * 100) / 100;
}

/** ts-fsrs default FSRS-5 weights, exported for UI display. */
export const DEFAULT_W = default_w;

export const W_COUNT = 21;

/** Per-weight bounds ts-fsrs itself clamps to (no fuzz, short-term enabled). */
const WEIGHT_BOUNDS: [number, number][] = CLAMP_PARAMETERS(W17_W18_Ceiling, true).map(
  (b) => [b[0], b[1]] as [number, number],
);

/** Optimizer file format (exact — written by the desktop optimizer script). */
export const OptimizerFileSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('sumrak-fsrs-params'),
    w: z.array(z.number()).length(W_COUNT),
    fittedAt: z.string(),
    reviewCount: z.number().int(),
    cardCount: z.number().int(),
    logLoss: z.number().optional(),
    rmse: z.number().optional(),
    defaultLogLoss: z.number().optional(),
    defaultRmse: z.number().optional(),
    warning: z.string().optional(),
  })
  .passthrough();
export type OptimizerFile = z.infer<typeof OptimizerFileSchema>;

export type ParseOptimizerResult =
  { ok: true; value: OptimizerFile } | { ok: false; reason: string };

function fmt(n: number): string {
  return String(Number(n.toPrecision(6)));
}

/**
 * Parse + validate an optimizer params file. Rejections carry a short human
 * reason for the import sheet. Weights must be finite and inside ts-fsrs's
 * own clamp bounds, so a file the scheduler would silently clamp is refused.
 */
export function parseOptimizerFile(text: string): ParseOptimizerResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: 'not a params file' };
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== 'sumrak-fsrs-params')
    return { ok: false, reason: 'not a Sumrak FSRS params file' };
  if (obj.v !== 1) return { ok: false, reason: `unsupported version ${String(obj.v)}` };
  if (!Array.isArray(obj.w)) return { ok: false, reason: 'missing weights (w)' };
  if (obj.w.length !== W_COUNT) {
    return { ok: false, reason: `expected ${W_COUNT} weights, got ${obj.w.length}` };
  }
  for (let i = 0; i < W_COUNT; i++) {
    const x = obj.w[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      return { ok: false, reason: `weight ${i} is not a finite number` };
    }
    const [lo, hi] = WEIGHT_BOUNDS[i] ?? [0, 0];
    if (x < lo || x > hi) {
      return { ok: false, reason: `weight ${i} is ${fmt(x)}, outside ${fmt(lo)}–${fmt(hi)}` };
    }
  }
  if (
    typeof obj.reviewCount !== 'number' ||
    !Number.isFinite(obj.reviewCount) ||
    obj.reviewCount < 1
  ) {
    return { ok: false, reason: 'reviewCount must be at least 1' };
  }
  const parsed = OptimizerFileSchema.safeParse(obj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: first ? `${first.path.join('.')}: ${first.message}` : 'invalid file',
    };
  }
  return { ok: true, value: parsed.data };
}

/** The params persisted in settings (SETTING_KEYS.fsrsParams). */
export interface StoredFsrsParams {
  v: 1;
  w: number[];
  fittedAt: string;
  importedAt: number;
  reviewCount: number;
  cardCount: number;
  logLoss?: number;
  rmse?: number;
}

const StoredParamsSchema = z
  .object({
    v: z.literal(1),
    w: z.array(z.number()).length(W_COUNT),
    fittedAt: z.string(),
    importedAt: z.number(),
    reviewCount: z.number(),
    cardCount: z.number(),
    logLoss: z.number().optional(),
    rmse: z.number().optional(),
  })
  .passthrough();

/**
 * Read the stored params row. Anything malformed — or a weight vector that
 * fails the same bounds check as an import — returns null (defaults).
 */
export function parseStoredParams(raw: unknown): StoredFsrsParams | null {
  const parsed = StoredParamsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const inBounds = d.w.every((x, i) => {
    const [lo, hi] = WEIGHT_BOUNDS[i] ?? [0, 0];
    return Number.isFinite(x) && x >= lo && x <= hi;
  });
  if (!inBounds) return null;
  const out: StoredFsrsParams = {
    v: 1,
    w: d.w,
    fittedAt: d.fittedAt,
    importedAt: d.importedAt,
    reviewCount: d.reviewCount,
    cardCount: d.cardCount,
  };
  if (d.logLoss !== undefined) out.logLoss = d.logLoss;
  if (d.rmse !== undefined) out.rmse = d.rmse;
  return out;
}
