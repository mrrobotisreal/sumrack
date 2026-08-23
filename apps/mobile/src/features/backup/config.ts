import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { base64ToBytes, bytesToBase64 } from '@/lib/base64';

import { deriveBackupKey, KDF_ITERATIONS_DEFAULT, KDF_SALT_BYTES } from './crypto';

/**
 * Backup configuration (T20). Split by sensitivity, same rule as the T07
 * PAT: KDF parameters (salt, iterations — NOT secret) live in the settings
 * table and ride inside every envelope; the passphrase-derived key lives in
 * expo-secure-store (Android Keystore-backed) ONLY. The raw passphrase is
 * never stored anywhere — it exists transiently in the setup/restore forms.
 */
const KEY_STORE_KEY = 'sumrak.backup.key';

const KdfConfigSchema = z.strictObject({
  saltB64: z.string().min(1),
  iterations: z.number().int().min(1),
  createdAt: z.number().int(),
});
export type KdfConfig = z.infer<typeof KdfConfigSchema>;

const BackupPrefsSchema = z.strictObject({
  githubEnabled: z.boolean(),
  autoEnabled: z.boolean(),
  // T21 addition — `.default` keeps prefs stored before T21 parsing cleanly.
  syncdEnabled: z.boolean().default(false),
});
export type BackupPrefs = z.infer<typeof BackupPrefsSchema>;
export const DEFAULT_BACKUP_PREFS: BackupPrefs = {
  githubEnabled: true,
  autoEnabled: true,
  syncdEnabled: false,
};

const LastBackupSchema = z.strictObject({
  at: z.number().int(),
  name: z.string().min(1),
});
export type LastBackup = z.infer<typeof LastBackupSchema>;

export async function getKdfConfig(): Promise<KdfConfig | null> {
  const raw = await repos.settings.get<unknown>(SETTING_KEYS.backupKdf);
  const parsed = KdfConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function getBackupPrefs(): Promise<BackupPrefs> {
  const raw = await repos.settings.get<unknown>(SETTING_KEYS.backupPrefs);
  const parsed = BackupPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_BACKUP_PREFS;
}

export async function setBackupPrefs(prefs: BackupPrefs): Promise<void> {
  await repos.settings.set(SETTING_KEYS.backupPrefs, prefs);
}

type LastBackupKey =
  | typeof SETTING_KEYS.lastBackupGithub
  | typeof SETTING_KEYS.lastBackupSyncd
  | typeof SETTING_KEYS.lastBackupLocal;

export async function getLastBackup(key: LastBackupKey): Promise<LastBackup | null> {
  const raw = await repos.settings.get<unknown>(key);
  const parsed = LastBackupSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function setLastBackup(key: LastBackupKey, value: LastBackup): Promise<void> {
  await repos.settings.set(key, value);
}

/** The cached derived key, or null when not set up (or Keystore lost it). */
export async function getBackupKey(): Promise<Uint8Array | null> {
  const b64 = await SecureStore.getItemAsync(KEY_STORE_KEY);
  if (!b64) return null;
  try {
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

/** Persist an already-derived key + its KDF params (setup, re-entry, and post-restore). */
export async function storeBackupKey(key: Uint8Array, kdf: KdfConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY_STORE_KEY, bytesToBase64(key));
  await repos.settings.set(SETTING_KEYS.backupKdf, kdf);
}

/**
 * First-time setup or passphrase change: fresh random salt, derive, store.
 * A passphrase CHANGE only affects future snapshots — old ones still need
 * the old passphrase (each envelope is self-describing), which the UI says
 * out loud. Derivation is deliberately slow (PBKDF2); callers show progress.
 */
export async function setupPassphrase(passphrase: string): Promise<void> {
  const salt = Crypto.getRandomBytes(KDF_SALT_BYTES);
  const kdf: KdfConfig = {
    saltB64: bytesToBase64(new Uint8Array(salt)),
    iterations: KDF_ITERATIONS_DEFAULT,
    createdAt: Date.now(),
  };
  const key = await deriveBackupKey(passphrase, kdf.saltB64, kdf.iterations);
  await storeBackupKey(key, kdf);
}

/** Configured = KDF params present AND the derived key is in the Keystore. */
export async function isBackupConfigured(): Promise<boolean> {
  return (await getKdfConfig()) !== null && (await getBackupKey()) !== null;
}
