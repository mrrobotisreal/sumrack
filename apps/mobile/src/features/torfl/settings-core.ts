import { z } from 'zod';

import type { AiRunProfile } from '@/features/ai/run-profile';

/**
 * The pure half of the three «ТРКИ» settings keys (T68, TORFL_EXAM_PREP §4.4):
 * types, defaults, strict schemas and field-by-field healers. No DB/React
 * imports, so the healing tests run in Node (the scenario-prefs-core split).
 * A malformed stored value never resets the fields that are still valid.
 */

// --- torfl.prefs -----------------------------------------------------------------

export const DRILL_TIMERS = ['off', 'exam-pace'] as const;
export type DrillTimer = (typeof DRILL_TIMERS)[number];

export interface TorflPrefs {
  v: 1;
  /** EN under the official RU instruction screens. */
  showEnglishInstructions: boolean;
  /** Drills untimed ('off') or with the 34 s/item exam pace bar. */
  drillTimer: DrillTimer;
  /** The optional break screen between subtests of a full mock. */
  breakBetweenSubtests: boolean;
  /** Tap lookup in mock reading (the official dictionary rule); off = harder. */
  allowLookupInMockReading: boolean;
}

export const DEFAULT_TORFL_PREFS: TorflPrefs = {
  v: 1,
  showEnglishInstructions: true,
  drillTimer: 'off',
  breakBetweenSubtests: true,
  allowLookupInMockReading: true,
};

const PrefFieldSchemas = {
  showEnglishInstructions: z.boolean(),
  drillTimer: z.enum(DRILL_TIMERS),
  breakBetweenSubtests: z.boolean(),
  allowLookupInMockReading: z.boolean(),
} as const;

export const TorflPrefsSchema = z.strictObject({ v: z.literal(1), ...PrefFieldSchemas });

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function parseTorflPrefs(raw: unknown): TorflPrefs {
  const whole = TorflPrefsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const value = asRecord(raw);
  const pick = <K extends keyof typeof PrefFieldSchemas>(key: K): TorflPrefs[K] => {
    const parsed = PrefFieldSchemas[key].safeParse(value[key]);
    return (parsed.success ? parsed.data : DEFAULT_TORFL_PREFS[key]) as TorflPrefs[K];
  };
  return {
    v: 1,
    showEnglishInstructions: pick('showEnglishInstructions'),
    drillTimer: pick('drillTimer'),
    breakBetweenSubtests: pick('breakBetweenSubtests'),
    allowLookupInMockReading: pick('allowLookupInMockReading'),
  };
}

// --- torfl.examDate ---------------------------------------------------------------

/** A real calendar date 'YYYY-MM-DD' (rejects 2026-02-30). */
export const ExamDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'not a calendar date');

/** Stored exam date or null; anything malformed heals to null (no countdown). */
export function parseExamDate(raw: unknown): string | null {
  const parsed = ExamDateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// --- torfl.gradingPreset ------------------------------------------------------------

const ProviderSchema = z.enum(['anthropic', 'openai']);
const QualitySchema = z.enum(['fastest', 'fast', 'normal', 'best']);
const EffortSchema = z.enum(['low', 'medium', 'high', 'ultra']);

/** ADR-0020 decision 10 (Mitch 2026-10-05): Anthropic · normal (Opus 5.5) · effort HIGH. */
export const DEFAULT_EXAM_GRADING_PRESET: AiRunProfile = {
  provider: 'anthropic',
  quality: 'normal',
  effort: 'high',
};

/** Strict shape of a stored `torfl.gradingPreset` row (what the setter writes). */
export const ExamGradingPresetSchema = z.strictObject({
  v: z.literal(1),
  provider: ProviderSchema,
  quality: QualitySchema,
  effort: EffortSchema,
});

/**
 * Heal a stored grading preset field-by-field. `fallback` is the default
 * triple — the accessor passes `{ provider: <grammar preset provider>,
 * quality: 'normal', effort: 'high' }` (T68 ticket §5: the provider follows
 * the grammar preset until Mitch sets one here).
 */
export function sanitizeExamGradingPreset(
  raw: unknown,
  fallback: AiRunProfile = DEFAULT_EXAM_GRADING_PRESET,
): AiRunProfile {
  const obj = asRecord(raw);
  const provider = ProviderSchema.safeParse(obj.provider);
  const quality = QualitySchema.safeParse(obj.quality);
  const effort = EffortSchema.safeParse(obj.effort);
  return {
    provider: provider.success ? provider.data : fallback.provider,
    quality: quality.success ? quality.data : fallback.quality,
    effort: effort.success ? effort.data : fallback.effort,
  };
}
