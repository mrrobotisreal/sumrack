import { z } from 'zod';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';

import { ModelSchema } from './config';

/**
 * The AI run profile (M16/T51, WORD_FORMS §4, ADR-0018 decision 3): the ONE
 * place that turns (provider, quality, effort) into an OpenRouter request —
 * a model id from the editable model table plus the per-provider request
 * extras (`verbosity` for Anthropic adaptive-thinking models, `reasoning.effort`
 * for OpenAI models, `usage.include` for cost accounting).
 *
 * Scope (decision 6): only the «Grammar & word forms» preset and the
 * Generate sheet use this. The five legacy AI features keep `ai.model`.
 * Prices are never hardcoded here — the estimate derives from receipts.
 */

// --- §4.1 Types and tables --------------------------------------------------

export type AiProvider = 'anthropic' | 'openai';
export type AiQuality = 'fastest' | 'fast' | 'normal' | 'best';
export type AiEffort = 'low' | 'medium' | 'high' | 'ultra';
export const PROVIDER_ORDER: readonly AiProvider[] = ['anthropic', 'openai'];
export const QUALITY_ORDER: readonly AiQuality[] = ['fastest', 'fast', 'normal', 'best'];
export const EFFORT_ORDER: readonly AiEffort[] = ['low', 'medium', 'high', 'ultra'];
export const QUALITY_LABELS: Record<AiQuality, string> = {
  fastest: 'Fastest',
  fast: 'Fast',
  normal: 'Normal',
  best: 'Best',
};
export const EFFORT_LABELS: Record<AiEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};
export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export interface AiRunProfile {
  provider: AiProvider;
  quality: AiQuality;
  effort: AiEffort;
}
export const DEFAULT_GRAMMAR_PRESET: AiRunProfile = {
  provider: 'anthropic',
  quality: 'normal',
  effort: 'high',
};

export type ModelTable = Record<AiProvider, Record<AiQuality, string>>;
/** Decision 3 ladders. Editable in Settings because slugs drift; the table is the only place slugs live. */
export const DEFAULT_MODEL_TABLE: ModelTable = {
  anthropic: {
    fastest: 'anthropic/claude-haiku-4.5',
    fast: 'anthropic/claude-sonnet-5',
    normal: 'anthropic/claude-opus-5.5',
    best: 'anthropic/claude-fable-5.1',
  },
  openai: {
    fastest: 'openai/gpt-6-luna',
    fast: 'openai/gpt-6-sol',
    normal: 'openai/gpt-6-sol-pro',
    best: 'openai/gpt-6-astra',
  },
};
/** Human hints shown under each notch (model display names; prices are NOT hardcoded — they drift). */
export const MODEL_HINTS: Record<AiProvider, Record<AiQuality, string>> = {
  anthropic: {
    fastest: 'Claude Haiku 4.5',
    fast: 'Claude Sonnet 5',
    normal: 'Claude Opus 5.5',
    best: 'Claude Fable 5.1',
  },
  openai: {
    fastest: 'GPT-6 Luna',
    fast: 'GPT-6 Sol',
    normal: 'GPT-6 Sol Pro',
    best: 'GPT-6 Astra',
  },
};
/** Hint under the Effort slider (§4.5). */
export const EFFORT_HINT = 'Ultra = extra-high thinking — slowest, most expensive';

// --- §4.2 Resolution → request ---------------------------------------------

/**
 * OpenRouter effort values (verified against the OpenRouter docs 2026-09-24):
 * Anthropic adaptive-thinking models take effort through the top-level
 * `verbosity` field (`reasoning.effort` is accepted but ignored for them);
 * OpenAI models through `reasoning.effort`; `xhigh` is the shared "extra high".
 */
export const EFFORT_TO_ANTHROPIC: Record<AiEffort, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  ultra: 'xhigh',
};
export const EFFORT_TO_OPENAI: Record<AiEffort, string> = EFFORT_TO_ANTHROPIC;

/** The extras every run keeps even after the §4.4 effort-param fallback. */
export const USAGE_EXTRAS: Record<string, unknown> = { usage: { include: true } };

export interface ResolvedRun {
  profile: AiRunProfile;
  model: string;
  /** Merged into the OpenRouter JSON body after the standard fields (client.ts). */
  extras: Record<string, unknown>;
}

export function resolveRun(profile: AiRunProfile, table: ModelTable): ResolvedRun {
  const model = table[profile.provider][profile.quality];
  const extras: Record<string, unknown> =
    profile.provider === 'anthropic'
      ? {
          verbosity: EFFORT_TO_ANTHROPIC[profile.effort],
          // `exclude: true` keeps thinking text out of the body — we never render it.
          reasoning: { enabled: true, exclude: true },
          ...USAGE_EXTRAS,
        }
      : {
          reasoning: { effort: EFFORT_TO_OPENAI[profile.effort], exclude: true },
          ...USAGE_EXTRAS,
        };
  return { profile: { ...profile }, model, extras };
}

/** Reasoning + visible output share the budget on most providers (§4.3). */
export const PROFILE_MAX_TOKENS = 16_384;
export const LESSON_MAX_TOKENS = 12_288;
const SLOW_TIMEOUT_MS = 240_000;
const NORMAL_TIMEOUT_MS = 150_000;

/** Client deadline for a generation run: Best or Ultra get the long one. */
export function timeoutFor(profile: AiRunProfile): number {
  return profile.quality === 'best' || profile.effort === 'ultra'
    ? SLOW_TIMEOUT_MS
    : NORMAL_TIMEOUT_MS;
}

// --- §2.4 Settings rows (Zod on read, field-by-field healing) ---------------

const ProviderSchema = z.enum(['anthropic', 'openai']);
const QualitySchema = z.enum(['fastest', 'fast', 'normal', 'best']);
const EffortSchema = z.enum(['low', 'medium', 'high', 'ultra']);

/** Strict shape of a stored `ai.grammarPreset` row (what `setGrammarPreset` writes). */
export const AiRunProfileSchema = z.object({
  v: z.literal(1),
  provider: ProviderSchema,
  quality: QualitySchema,
  effort: EffortSchema,
});

/** Strict shape of a stored `ai.modelTable` row — every id must satisfy `ModelSchema`. */
const ModelRowSchema = z.object({
  fastest: ModelSchema,
  fast: ModelSchema,
  normal: ModelSchema,
  best: ModelSchema,
});
export const ModelTableSchema = z.object({
  v: z.literal(1),
  anthropic: ModelRowSchema,
  openai: ModelRowSchema,
});

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/**
 * Heal a stored preset field-by-field (the `library-prefs` sanitize rule):
 * one bad field falls back to its default, the others survive.
 */
export function sanitizeProfile(raw: unknown): AiRunProfile {
  const obj = asRecord(raw);
  const provider = ProviderSchema.safeParse(obj.provider);
  const quality = QualitySchema.safeParse(obj.quality);
  const effort = EffortSchema.safeParse(obj.effort);
  return {
    provider: provider.success ? provider.data : DEFAULT_GRAMMAR_PRESET.provider,
    quality: quality.success ? quality.data : DEFAULT_GRAMMAR_PRESET.quality,
    effort: effort.success ? effort.data : DEFAULT_GRAMMAR_PRESET.effort,
  };
}

/** Heal a stored model table slug-by-slug: only a malformed slug reverts to its own default. */
export function sanitizeModelTable(raw: unknown): ModelTable {
  const obj = asRecord(raw);
  const table = {} as ModelTable;
  for (const provider of PROVIDER_ORDER) {
    const row = asRecord(obj[provider]);
    const healed = {} as Record<AiQuality, string>;
    for (const quality of QUALITY_ORDER) {
      const parsed = ModelSchema.safeParse(row[quality]);
      healed[quality] = parsed.success ? parsed.data : DEFAULT_MODEL_TABLE[provider][quality];
    }
    table[provider] = healed;
  }
  return table;
}

export async function getGrammarPreset(): Promise<AiRunProfile> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.aiGrammarPreset);
  return stored == null ? { ...DEFAULT_GRAMMAR_PRESET } : sanitizeProfile(stored);
}

export async function setGrammarPreset(profile: AiRunProfile): Promise<void> {
  const clean = sanitizeProfile(profile);
  await repos.settings.set(SETTING_KEYS.aiGrammarPreset, { v: 1, ...clean });
}

export async function getModelTable(): Promise<ModelTable> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.aiModelTable);
  return stored == null ? structuredClone(DEFAULT_MODEL_TABLE) : sanitizeModelTable(stored);
}

/**
 * Persist the table; returns false (and writes nothing) when any slug fails
 * `ModelSchema` — the Settings inputs validate on blur before calling this.
 */
export async function setModelTable(table: ModelTable): Promise<boolean> {
  const parsed = ModelTableSchema.safeParse({ v: 1, ...table });
  if (!parsed.success) return false;
  await repos.settings.set(SETTING_KEYS.aiModelTable, parsed.data);
  return true;
}

// --- §2.4 `grammar.stats` receipts + estimate --------------------------------

export type RunPurpose = 'profile' | 'lesson';

/** What one successful generation reports back (T52/T54 services build it from `ChatResult`). */
export interface RunReceipt {
  ms: number;
  costUsd?: number;
  completionTokens?: number;
}

export interface RunStatsBucket {
  n: number;
  totalMs: number;
  totalCostUsd: number;
  totalCompletionTokens: number;
}

export interface GrammarStats {
  v: 1;
  runs: Record<string, RunStatsBucket>;
}

export const EMPTY_GRAMMAR_STATS: GrammarStats = { v: 1, runs: {} };

const nonNegative = z.number().nonnegative();
const BucketSchema = z.object({
  n: z.number().int().nonnegative(),
  totalMs: nonNegative,
  totalCostUsd: nonNegative,
  totalCompletionTokens: nonNegative,
});
export const GrammarStatsSchema = z.object({
  v: z.literal(1),
  runs: z.record(z.string(), BucketSchema),
});

/** `${provider}:${quality}:${effort}:${purpose}` — the bucket key of §2.4. */
export function statsKey(purpose: RunPurpose, profile: AiRunProfile): string {
  return `${profile.provider}:${profile.quality}:${profile.effort}:${purpose}`;
}

/** Heal a stored stats row bucket-by-bucket: a malformed bucket is dropped, the rest survive. */
export function sanitizeStats(raw: unknown): GrammarStats {
  const runs = asRecord(asRecord(raw).runs);
  const clean: Record<string, RunStatsBucket> = {};
  for (const [key, bucket] of Object.entries(runs)) {
    const parsed = BucketSchema.safeParse(bucket);
    if (parsed.success) clean[key] = parsed.data;
  }
  return { v: 1, runs: clean };
}

/** Pure merge: returns a new stats object with the receipt folded into its bucket. */
export function recordRunReceipt(
  stats: GrammarStats,
  purpose: RunPurpose,
  profile: AiRunProfile,
  receipt: RunReceipt,
): GrammarStats {
  const key = statsKey(purpose, profile);
  const prev = stats.runs[key] ?? { n: 0, totalMs: 0, totalCostUsd: 0, totalCompletionTokens: 0 };
  const next: RunStatsBucket = {
    n: prev.n + 1,
    totalMs: prev.totalMs + Math.max(0, receipt.ms),
    totalCostUsd: prev.totalCostUsd + Math.max(0, receipt.costUsd ?? 0),
    totalCompletionTokens: prev.totalCompletionTokens + Math.max(0, receipt.completionTokens ?? 0),
  };
  return { v: 1, runs: { ...stats.runs, [key]: next } };
}

export interface RunEstimate {
  /** Mean duration of one run. */
  ms: number;
  /** Mean cost of one run (USD, from OpenRouter usage accounting). */
  costUsd: number;
  /** How many receipts the average rests on (never 0 — null is returned instead). */
  n: number;
}

/** Pure: the per-run averages for one bucket, or null when nothing was measured yet. */
export function estimateFromStats(
  stats: GrammarStats,
  purpose: RunPurpose,
  profile: AiRunProfile,
): RunEstimate | null {
  const bucket = stats.runs[statsKey(purpose, profile)];
  if (!bucket || bucket.n === 0) return null;
  return { ms: bucket.totalMs / bucket.n, costUsd: bucket.totalCostUsd / bucket.n, n: bucket.n };
}

export async function getGrammarStats(): Promise<GrammarStats> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.grammarStats);
  return stored == null ? { v: 1, runs: {} } : sanitizeStats(stored);
}

export async function setGrammarStats(stats: GrammarStats): Promise<void> {
  await repos.settings.set(SETTING_KEYS.grammarStats, sanitizeStats(stats));
}

/**
 * Read `grammar.stats` and average the selected notch. Null when there are
 * no receipts — the sheet then shows «No data for this setting yet…» and
 * never a number (estimate-line honesty).
 */
export async function estimateRun(
  purpose: RunPurpose,
  profile: AiRunProfile,
): Promise<RunEstimate | null> {
  return estimateFromStats(await getGrammarStats(), purpose, profile);
}
