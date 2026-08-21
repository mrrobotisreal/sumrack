import * as SecureStore from 'expo-secure-store';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';

import type { GithubRepoConfig } from './github-client';

/**
 * Content-sync configuration (T07). Split storage by sensitivity:
 * - repo owner/name/branch + Wi-Fi toggle → settings table (plain, backed up);
 * - the fine-grained PAT → expo-secure-store (Android Keystore-backed),
 *   NEVER the settings table, logs, or analytics props.
 */
const PAT_KEY = 'sumrak.sync.github.pat';

/** Prefill for the single known content repo — editable in Settings, not secret. */
export const DEFAULT_REPO: GithubRepoConfig = {
  owner: 'mrrobotisreal',
  repo: 'sumrack-content',
  branch: 'main',
};

export async function getRepoConfig(): Promise<GithubRepoConfig | null> {
  const stored = await repos.settings.get<GithubRepoConfig>(SETTING_KEYS.contentRepo);
  if (!stored || !stored.owner?.trim() || !stored.repo?.trim()) return null;
  return { owner: stored.owner.trim(), repo: stored.repo.trim(), branch: stored.branch?.trim() };
}

export async function setRepoConfig(config: GithubRepoConfig): Promise<void> {
  await repos.settings.set(SETTING_KEYS.contentRepo, config);
}

export async function getWifiOnlyAudio(): Promise<boolean> {
  const stored = await repos.settings.get<boolean>(SETTING_KEYS.wifiOnlyAudio);
  return stored ?? true; // default on: narration audio waits for Wi-Fi
}

export async function setWifiOnlyAudio(value: boolean): Promise<void> {
  await repos.settings.set(SETTING_KEYS.wifiOnlyAudio, value);
}

export async function getPat(): Promise<string | null> {
  return SecureStore.getItemAsync(PAT_KEY);
}

export async function setPat(token: string): Promise<void> {
  // Android-only app: SecureStore backs this with the Keystore; the iOS
  // keychainAccessible option is irrelevant here.
  await SecureStore.setItemAsync(PAT_KEY, token);
}

export async function clearPat(): Promise<void> {
  await SecureStore.deleteItemAsync(PAT_KEY);
}

export async function hasPat(): Promise<boolean> {
  return (await getPat()) != null;
}
