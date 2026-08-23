import { db } from '@/db';
import { hydrateTtsFromDb } from '@/features/tts/service';
import { DEFAULT_REPO, getPat, getRepoConfig } from '@/features/sync/config';
import { GithubContentClient } from '@/features/sync/github-client';
import { runSync } from '@/features/sync/sync-service';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';
import { hydrateDailyPrefsFromDb } from '@/store/daily-prefs';
import { hydrateGamePrefsFromDb } from '@/store/game-prefs';
import { hydrateGoalPrefsFromDb } from '@/store/goal-prefs';
import { hydrateLookupPrefsFromDb } from '@/store/lookup-prefs';
import { hydrateNotificationPrefsFromDb } from '@/store/notification-prefs';
import { hydrateReaderPrefsFromDb } from '@/store/reader-prefs';
import { hydrateThemeFromDb } from '@/store/theme';

import { storeBackupKey } from './config';
import { decryptBackupEnvelope, deriveBackupKey, parseEnvelopeText } from './crypto';
import { BackupError, toBackupError } from './errors';
import { parseBackupFileName } from './naming';
import { restoreUserData, type RestoreResult } from './restore-core';
import { BACKUPS_DIR } from './service';

/**
 * Restore flow (ticket item 8): source → envelope text → passphrase-derived
 * key (parameters from the envelope itself, so a fresh install needs only
 * the passphrase) → decrypt → Zod-validate → replace-import → re-hydrate
 * every settings-backed store → kick a content sync so packs line back up
 * with the restored `sync_state`.
 *
 * Failure ordering is the safety story: decrypt failures (wrong passphrase)
 * and validation failures both throw BEFORE restore-core opens its
 * transaction — the live DB is untouched on every error path.
 */

export interface RemoteBackupListing {
  name: string;
  path: string;
  size: number;
  timestamp: number;
}

/**
 * Repo config for restore: fall back to the single known content repo when
 * settings are empty (fresh install — the whole point of this screen). The
 * PAT is still required; there is no default for a secret.
 */
async function restoreRepoConfig() {
  return (await getRepoConfig()) ?? DEFAULT_REPO;
}

/** Backups available in the GitHub repo, newest first. Requires a PAT. */
export async function listGithubBackups(): Promise<RemoteBackupListing[]> {
  const config = await restoreRepoConfig();
  const pat = await getPat();
  if (!pat) {
    throw new BackupError('github', 'GitHub token not configured');
  }
  const client = new GithubContentClient(config, pat);
  const entries = await client.listDirectory(BACKUPS_DIR);
  return entries
    .filter((e) => e.type === 'file')
    .map((e) => ({ entry: e, parsed: parseBackupFileName(e.name) }))
    .filter((x): x is typeof x & { parsed: NonNullable<typeof x.parsed> } => x.parsed !== null)
    .map(({ entry, parsed }) => ({
      name: entry.name,
      path: entry.path,
      size: entry.size,
      timestamp: parsed.timestamp,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Download one backup envelope's text from GitHub. */
export async function fetchGithubBackup(path: string): Promise<string> {
  const config = await restoreRepoConfig();
  const pat = await getPat();
  if (!pat) {
    throw new BackupError('github', 'GitHub token not configured');
  }
  const client = new GithubContentClient(config, pat);
  const bytes = await client.fetchRawFile(path);
  return new TextDecoder('utf-8').decode(bytes);
}

export interface RestoreOutcome extends RestoreResult {
  /** Whether the post-restore content sync could start (repo+PAT present). */
  syncStarted: boolean;
}

/**
 * The whole restore, given envelope text from either source. Progress is
 * reported via `onPhase` (derivation is deliberately slow — PBKDF2).
 */
export async function restoreFromEnvelopeText(
  text: string,
  passphrase: string,
  opts: { source: 'github' | 'local-file'; onPhase?: (phase: RestorePhase) => void } = {
    source: 'local-file',
  },
): Promise<RestoreOutcome> {
  const { source, onPhase } = opts;
  track('restore_started', { source });
  try {
    const envelope = parseEnvelopeText(text);

    onPhase?.('deriving-key');
    const key = await deriveBackupKey(
      passphrase,
      envelope.cipher.saltB64,
      envelope.cipher.iterations,
    );

    onPhase?.('decrypting');
    const payloadJson = decryptBackupEnvelope(envelope, key);
    let payloadRaw: unknown;
    try {
      payloadRaw = JSON.parse(payloadJson);
    } catch {
      throw new BackupError('invalid-payload', 'decrypted payload is not JSON');
    }

    onPhase?.('importing');
    const result = await restoreUserData(db, payloadRaw);

    // The typed passphrase provably decrypts this snapshot — cache the key
    // (with the envelope's KDF params) so future backups on this device
    // work without re-setup.
    await storeBackupKey(key, {
      saltB64: envelope.cipher.saltB64,
      iterations: envelope.cipher.iterations,
      createdAt: Date.now(),
    });

    onPhase?.('refreshing');
    await rehydrateAfterRestore();

    // Content re-download from the reconciled sync_state (design §9). Quiet
    // best-effort: without a PAT (post-wipe) the user re-enters it and syncs.
    const syncStarted = !!((await getRepoConfig()) && (await getPat()));
    if (syncStarted) void runSync({ trigger: 'manual' }).catch(() => {});

    track('restore_succeeded', {
      source,
      totalRows: result.totalRows,
      packsToRedownload: result.packsToRedownload.length,
    });
    return { ...result, syncStarted };
  } catch (err) {
    track('restore_failed', { source, code: toBackupError(err).code });
    throw err;
  }
}

export type RestorePhase = 'deriving-key' | 'decrypting' | 'importing' | 'refreshing';

/**
 * Restored settings replace whatever was live — re-hydrate every
 * settings-backed zustand store (the DbProvider boot list) and drop all
 * query caches. Boot-time-only steps (achievement sweep, notification
 * replan, ASR/voice re-scan) run on the next app start; the restore UI
 * recommends a restart.
 */
async function rehydrateAfterRestore(): Promise<void> {
  await hydrateThemeFromDb();
  await hydrateReaderPrefsFromDb();
  await hydrateLookupPrefsFromDb();
  await hydrateGamePrefsFromDb();
  await hydrateDailyPrefsFromDb();
  await hydrateGoalPrefsFromDb();
  await hydrateNotificationPrefsFromDb();
  await hydrateTtsFromDb();
  queryClient.clear();
}
