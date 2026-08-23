import { StorageAccessFramework as SAF } from 'expo-file-system/legacy';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

import { setLastBackup } from './config';
import { BackupError, toBackupError } from './errors';
import { parseBackupFileName } from './naming';
import { createSealedBackup } from './service';

/**
 * Local-file backup target (ticket item 4): the same encrypted envelope the
 * GitHub target uploads, written into a user-chosen folder via Android's
 * Storage Access Framework. Fully offline — this is the manual, off-repo
 * fallback (and the restore source that needs no PAT on a fresh install).
 *
 * The granted directory uri persists in settings; Android keeps the
 * permission grant until app data is cleared, so a revoked/missing grant
 * simply re-prompts.
 */

export async function getSavedSafDir(): Promise<string | null> {
  return repos.settings.get<string>(SETTING_KEYS.backupSafDir);
}

/** Returns the folder uri, prompting the system folder picker if needed. */
export async function ensureSafDir(): Promise<string> {
  const saved = await getSavedSafDir();
  if (saved) {
    // Cheap validity probe — a revoked grant throws, then we re-prompt.
    try {
      await SAF.readDirectoryAsync(saved);
      return saved;
    } catch {
      // fall through to re-prompt
    }
  }
  const perm = await SAF.requestDirectoryPermissionsAsync();
  if (!perm.granted) throw new BackupError('saf-denied', 'folder permission not granted');
  await repos.settings.set(SETTING_KEYS.backupSafDir, perm.directoryUri);
  return perm.directoryUri;
}

/** File name from a SAF document uri (last segment is percent-encoded). */
export function safFileName(uri: string): string {
  const last = uri.split('/').pop() ?? uri;
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  // Document ids look like "primary:SumrakBackups/sumrak-backup-…json".
  const slash = decoded.lastIndexOf('/');
  return slash >= 0 ? decoded.slice(slash + 1) : decoded;
}

export interface LocalExportResult {
  name: string;
  uri: string;
}

/** Export one encrypted snapshot into the chosen folder. Offline-safe. */
export async function exportBackupToLocalFile(): Promise<LocalExportResult> {
  const dirUri = await ensureSafDir();
  const sealed = await createSealedBackup();
  try {
    // createFileAsync wants the name WITHOUT extension; the json mime adds it.
    const fileUri = await SAF.createFileAsync(
      dirUri,
      sealed.name.replace(/\.json$/, ''),
      'application/json',
    );
    await SAF.writeAsStringAsync(fileUri, sealed.json);
    await setLastBackup(SETTING_KEYS.lastBackupLocal, {
      at: sealed.createdAt.getTime(),
      name: sealed.name,
    });
    track('backup_local_exported', { bytes: sealed.json.length });
    return { name: sealed.name, uri: fileUri };
  } catch (err) {
    track('backup_local_export_failed', { code: toBackupError(err).code });
    if (err instanceof BackupError) throw err;
    throw new BackupError('file-error', err instanceof Error ? err.message : 'write failed');
  }
}

export interface LocalBackupFile {
  name: string;
  uri: string;
}

/** Backup files (by naming convention) in the chosen folder, newest first. */
export async function listLocalBackups(): Promise<LocalBackupFile[]> {
  const dirUri = await ensureSafDir();
  let uris: string[];
  try {
    uris = await SAF.readDirectoryAsync(dirUri);
  } catch (err) {
    throw new BackupError('file-error', err instanceof Error ? err.message : 'cannot list folder');
  }
  return uris
    .map((uri) => ({ uri, name: safFileName(uri) }))
    .filter((f) => parseBackupFileName(f.name) !== null)
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Read one backup file's text (envelope JSON) for the restore flow. */
export async function readLocalBackup(uri: string): Promise<string> {
  try {
    return await SAF.readAsStringAsync(uri);
  } catch (err) {
    throw new BackupError('file-error', err instanceof Error ? err.message : 'cannot read file');
  }
}
