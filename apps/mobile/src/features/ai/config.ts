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

/** Claude by default (design §12 decision #12). Ids are OpenRouter's. */
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5';

/** Curated picker options — a custom id can be typed in Settings. */
export const MODEL_OPTIONS: { id: string; label: string; hint: string }[] = [
  {
    id: 'anthropic/claude-sonnet-5',
    label: 'Claude Sonnet 5',
    hint: 'Default — fast and thorough',
  },
  {
    id: 'anthropic/claude-opus-5',
    label: 'Claude Opus 5',
    hint: 'Deepest feedback, slower + pricier',
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    hint: 'Cheapest, fine for enrichment',
  },
];

/** Anything that plausibly looks like an OpenRouter model id. */
const ModelSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[\w.:-]+\/[\w.:-]+$/);

export async function getModel(): Promise<string> {
  const stored = await repos.settings.get<string>(SETTING_KEYS.aiModel);
  const parsed = ModelSchema.safeParse(stored ?? '');
  return parsed.success ? parsed.data : DEFAULT_MODEL;
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
