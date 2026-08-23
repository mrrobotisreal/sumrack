import type { BackupEnvelope } from '@sumrak/schema';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

import { db } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { isOnline } from '@/features/ai/connectivity';
import { getPat, getRepoConfig } from '@/features/sync/config';
import { GithubContentClient } from '@/features/sync/github-client';
import { bytesToBase64 } from '@/lib/base64';
import { track } from '@/services/analytics';

import { getBackupKey, getBackupPrefs, getKdfConfig, setLastBackup } from './config';
import { encryptBackupPayload, GCM_IV_BYTES } from './crypto';
import { BackupError, friendlyBackupMessage, toBackupError } from './errors';
import { exportUserData } from './export-core';
import { backupFileName } from './naming';
import { planRetention } from './retention';
import { useBackupStatus, type BackupRunSummary, type BackupTrigger } from './store';

/**
 * The T20 backup orchestrator: export user tables → gzip+encrypt → push to
 * `sumrak-content/backups/` (T07's GitHub client) → apply ring-buffer
 * retention. Backup failures never affect app usability — every trigger
 * treats problems as a recorded summary, not a thrown crash (design §3.1).
 */

export const BACKUPS_DIR = 'backups';

let backupInFlight: Promise<BackupRunSummary> | null = null;

export interface SealedBackup {
  envelope: BackupEnvelope;
  json: string;
  name: string;
  createdAt: Date;
  secretsDropped: number;
}

/**
 * Shared export+encrypt step for every target (GitHub now, SAF export, and
 * T21's syncd later): one snapshot pipeline, three transports.
 */
export async function createSealedBackup(): Promise<SealedBackup> {
  const kdf = await getKdfConfig();
  if (!kdf) throw new BackupError('not-configured', 'no passphrase configured');
  const key = await getBackupKey();
  if (!key) throw new BackupError('no-key', 'derived key missing from Keystore');

  const createdAt = new Date();
  const { payload, secretsDropped } = await exportUserData(db, {
    appVersion: Constants.expoConfig?.version,
    now: createdAt,
  });
  const envelope = encryptBackupPayload(JSON.stringify(payload), key, {
    saltB64: kdf.saltB64,
    iterations: kdf.iterations,
    iv: new Uint8Array(Crypto.getRandomBytes(GCM_IV_BYTES)),
    createdAt,
    appVersion: Constants.expoConfig?.version,
  });
  return {
    envelope,
    json: JSON.stringify(envelope),
    name: backupFileName(createdAt),
    createdAt,
    secretsDropped,
  };
}

export interface RunBackupOptions {
  /** 'manual' surfaces every outcome; auto triggers skip quietly. */
  trigger: BackupTrigger;
}

/** Entry point for every GitHub-target backup trigger; concurrent calls join. */
export function runBackup(opts: RunBackupOptions): Promise<BackupRunSummary> {
  if (backupInFlight) return backupInFlight;
  backupInFlight = doRunBackup(opts).finally(() => {
    backupInFlight = null;
  });
  return backupInFlight;
}

async function doRunBackup({ trigger }: RunBackupOptions): Promise<BackupRunSummary> {
  const status = useBackupStatus.getState();
  const summary: BackupRunSummary = { at: Date.now(), trigger, outcome: 'ok' };

  const skip = (reason: NonNullable<BackupRunSummary['skipReason']>): BackupRunSummary => {
    summary.outcome = 'skipped';
    summary.skipReason = reason;
    status.finishRun(summary);
    return summary;
  };
  const fail = (err: unknown): BackupRunSummary => {
    summary.outcome = 'error';
    summary.error = friendlyBackupMessage(err);
    const code = toBackupError(err).code;
    console.warn(`[backup] run failed: ${code}`);
    track('backup_failed', { trigger, code });
    status.finishRun(summary);
    return summary;
  };

  // Gates. Auto triggers stay silent; a manual run surfaces the reason.
  const kdf = await getKdfConfig();
  const key = kdf ? await getBackupKey() : null;
  if (!kdf || !key) {
    return trigger === 'manual'
      ? fail(new BackupError(kdf ? 'no-key' : 'not-configured', 'backup not set up'))
      : skip('not-configured');
  }
  const prefs = await getBackupPrefs();
  if (!prefs.githubEnabled) return skip('target-disabled');
  const config = await getRepoConfig();
  const pat = await getPat();
  if (!config || !pat) {
    return trigger === 'manual'
      ? fail(new BackupError('github', 'content repo or token not configured'))
      : skip('not-configured');
  }
  if (!(await isOnline())) {
    return trigger === 'manual' ? fail(new BackupError('offline', 'offline')) : skip('offline');
  }

  status.startRun();
  track('backup_started', { trigger });

  try {
    const sealed = await createSealedBackup();
    useBackupStatus.getState().setPhase('uploading');

    const client = new GithubContentClient(config, pat);
    const path = `${BACKUPS_DIR}/${sealed.name}`;
    await client.putFile(path, bytesToBase64(utf8Bytes(sealed.json)), `Backup ${sealed.name}`);
    await setLastBackup(SETTING_KEYS.lastBackupGithub, {
      at: sealed.createdAt.getTime(),
      name: sealed.name,
    });

    // Retention prune — a failure here never fails the backup itself.
    useBackupStatus.getState().setPhase('pruning');
    let pruned = 0;
    try {
      pruned = await pruneGithubBackups(client);
    } catch (err) {
      console.warn(`[backup] prune failed: ${toBackupError(err).code}`);
    }

    summary.name = sealed.name;
    summary.pruned = pruned;
    track('backup_succeeded', {
      trigger,
      bytes: sealed.json.length,
      pruned,
      secretsDropped: sealed.secretsDropped,
    });
    useBackupStatus.getState().finishRun(summary);
    return summary;
  } catch (err) {
    return fail(err);
  }
}

/** Apply the §9 ring buffer to `backups/`; returns how many files were deleted. */
async function pruneGithubBackups(client: GithubContentClient): Promise<number> {
  const entries = await client.listDirectory(BACKUPS_DIR);
  const files = entries.filter((e) => e.type === 'file');
  const plan = planRetention(files.map((f) => f.name));
  const byName = new Map(files.map((f) => [f.name, f]));
  let pruned = 0;
  for (const name of plan.prune) {
    const entry = byName.get(name);
    if (!entry) continue;
    await client.deleteFile(entry.path, entry.sha, `Prune backup ${name} (retention)`);
    pruned += 1;
  }
  if (pruned > 0) track('backup_pruned', { pruned, kept: plan.keep.length });
  return pruned;
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
