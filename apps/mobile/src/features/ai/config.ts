import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';

/**
 * AI configuration (T16), following the T07 split by sensitivity:
 * - model choice → settings table (plain, backed up);
 * - the OpenRouter API key → expo-secure-store (Android Keystore-backed),
 *   NEVER the settings table, logs, analytics, or error messages.
 *
 * The key is write-only from the UI: stored, replaced, or cleared — never
 * read back into a text field, and no function here returns it to anything
 * but the request layer.
 */
const OPENROUTER_KEY = 'sumrak.ai.openrouter.key';

/**
 * Claude by default (design §12 decision #12). Ids are OpenRouter's.
 * Opus 5.5 since 2026-10-05 (Mitch): close to Fable quality, far cheaper
 * than Opus 5 — Sonnet 5.5 / Haiku 4.5 stay one tap away for speed.
 */
export const DEFAULT_MODEL = 'anthropic/claude-opus-5.5';

/** Curated picker options — a custom id can be typed in Settings. */
export const MODEL_OPTIONS: { id: string; label: string; hint: string }[] = [
  {
    id: 'anthropic/claude-opus-5.5',
    label: 'Claude Opus 5.5',
    hint: 'Default — deepest, most accurate feedback',
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    label: 'Claude Sonnet 5.5',
    hint: 'Much faster, may be less thorough',
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    hint: 'Extremely fast + cheap, quality not the point',
  },
];

/**
 * Retired curated ids → their replacement (2026-10-05). Settings «Save»
 * always writes the selected id, so devices carry the old default as a
 * stored row; reading through this map keeps them on a curated option
 * instead of a stale "custom" id. The old default (Sonnet 5) follows the
 * default change to Opus 5.5.
 */
export const RETIRED_MODEL_IDS: Readonly<Record<string, string>> = {
  'anthropic/claude-sonnet-5': DEFAULT_MODEL,
  'anthropic/claude-opus-5': 'anthropic/claude-opus-5.5',
};

/**
 * Anything that plausibly looks like an OpenRouter model id. Exported since
 * T51: the run-profile model table validates its eight slugs with it too.
 */
export const ModelSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[\w.:-]+\/[\w.:-]+$/);

export async function getModel(): Promise<string> {
  const stored = await repos.settings.get<string>(SETTING_KEYS.aiModel);
  const parsed = ModelSchema.safeParse(stored ?? '');
  if (!parsed.success) return DEFAULT_MODEL;
  return RETIRED_MODEL_IDS[parsed.data] ?? parsed.data;
}

export async function setModel(model: string): Promise<boolean> {
  const parsed = ModelSchema.safeParse(model);
  if (!parsed.success) return false;
  await repos.settings.set(SETTING_KEYS.aiModel, parsed.data);
  return true;
}

export async function getApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(OPENROUTER_KEY);
}

export async function setApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(OPENROUTER_KEY, key);
}

export async function clearApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(OPENROUTER_KEY);
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) != null;
}
