import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';

/**
 * syncd target configuration (T21). Split by sensitivity, the T07/T20 rule:
 * the tailnet host URL (not secret) lives in the settings table and is
 * backed up; the bearer token lives in expo-secure-store ONLY — never the
 * settings table, logs, analytics, or backup payloads. Note the consequence
 * (same as the PAT): after a full wipe the restored settings bring the host
 * back but the token must be re-entered.
 */
const TOKEN_STORE_KEY = 'sumrak.backup.syncd.token';

const SyncdConfigSchema = z.strictObject({
  /** Base URL of the service on the tailnet, e.g. "http://homeserver:8787". */
  host: z.string().min(1),
});
export type SyncdConfig = z.infer<typeof SyncdConfigSchema>;

export { normalizeSyncdHost } from './syncd-client';

export async function getSyncdConfig(): Promise<SyncdConfig | null> {
  const raw = await repos.settings.get<unknown>(SETTING_KEYS.syncdConfig);
  const parsed = SyncdConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function setSyncdConfig(config: SyncdConfig | null): Promise<void> {
  await repos.settings.set(SETTING_KEYS.syncdConfig, config);
}

export async function getSyncdToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_STORE_KEY);
}

export async function setSyncdToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_STORE_KEY, token);
}

export async function clearSyncdToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_STORE_KEY);
}

export async function hasSyncdToken(): Promise<boolean> {
  return (await getSyncdToken()) != null;
}

/** Host + token both present — the bar for attempting any syncd request. */
export async function isSyncdConfigured(): Promise<boolean> {
  return (await getSyncdConfig()) !== null && (await hasSyncdToken());
}
