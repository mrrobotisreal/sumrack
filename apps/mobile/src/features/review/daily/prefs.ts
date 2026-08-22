import { z } from 'zod';

/**
 * Daily-session composition preferences (T14): how long a session is and
 * the relative frequency of each game mode. Stored as one settings row
 * (SETTING_KEYS.dailySessionPrefs), Zod-validated on read — corrupt or
 * outdated values fall back to defaults, never crash (T13 prefs pattern).
 */

export const DAILY_MODES = ['flashcard', 'mc', 'cloze', 'sentence-builder', 'listening'] as const;
export type DailyMode = (typeof DAILY_MODES)[number];

/** 0 = never serve this mode; 5 = five times the frequency of a 1. */
const WeightSchema = z.number().int().min(0).max(5);

export const DailyWeightsSchema = z.strictObject({
  flashcard: WeightSchema,
  mc: WeightSchema,
  cloze: WeightSchema,
  sentenceBuilder: WeightSchema,
  listening: WeightSchema,
});
export type DailyWeights = z.infer<typeof DailyWeightsSchema>;

export const DailyPrefsSchema = z.strictObject({
  length: z.number().int().min(5).max(50),
  weights: DailyWeightsSchema,
});
export type DailyPrefs = z.infer<typeof DailyPrefsSchema>;

/** Session-length choices offered in Settings (any 5–50 value validates). */
export const DAILY_LENGTH_OPTIONS = [10, 15, 20, 30] as const;

/** Roughly even mix across modes (ticket default), 20 items (§7.7 goal default). */
export const DEFAULT_DAILY_PREFS: DailyPrefs = {
  length: 20,
  weights: { flashcard: 1, mc: 1, cloze: 1, sentenceBuilder: 1, listening: 1 },
};

export function parseDailyPrefs(raw: unknown): DailyPrefs {
  const parsed = DailyPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_DAILY_PREFS;
}

/** Stored-weight key per mode id (storage uses camelCase, modes use kebab). */
export function weightForMode(weights: DailyWeights, mode: DailyMode): number {
  return mode === 'sentence-builder' ? weights.sentenceBuilder : weights[mode];
}
