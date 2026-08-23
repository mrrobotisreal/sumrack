import type { BackupEnvelope } from '@sumrak/schema';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

import { db } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { localDateKey } from '@/db/repositories/stats';
import { isOnline } from '@/features/ai/connectivity';
import { getPat, getRepoConfig } from '@/features/sync/config';
import { GithubContentClient } from '@/features/sync/github-client';
import { bytesToBase64 } from '@/lib/base64';
import { track } from '@/services/analytics';

import { getBackupKey, getBackupPrefs, getKdfConfig, getLastBackup, setLastBackup } from './config';
import { encryptBackupPayload, GCM_IV_BYTES } from './crypto';
import { BackupError, friendlyBackupMessage, toBackupError } from './errors';
import { exportUserData } from './export-core';
import { backupFileName } from './naming';
import { planRetention } from './retention';
import {
  useBackupStatus,
  type BackupRunSummary,
  type BackupTargetId,
  type BackupTrigger,
  type TargetOutcome,
} from './store';
import { SyncdClient } from './syncd-client';
import { getSyncdConfig, getSyncdToken } from './syncd-config';
import { reportSyncdReachability } from './syncd-status';

/**
 * The backup orchestrator (T20, extended by T21): export user tables →
 * gzip+encrypt ONCE → push the same sealed snapshot to every enabled
 * target — GitHub `backups/` (T07 client) and/or syncd on the home server —
 * each succeeding or failing independently, then retention. Backup failures
 * never affect app usability: every trigger treats problems as a recorded
 * summary, not a thrown crash (design §3.1), and an unreachable tailnet
 * host never blocks the GitHub target (or anything else).
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
 * Shared export+encrypt step for every target (GitHub, syncd, SAF export):
 * one snapshot pipeline, three transports.
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

/** Entry point for every remote-target backup trigger; concurrent calls join. */
export function runBackup(opts: RunBackupOptions): Promise<BackupRunSummary> {
  if (backupInFlight) return backupInFlight;
  backupInFlight = doRunBackup(opts).finally(() => {
    backupInFlight = null;
  });
  return backupInFlight;
}

const LAST_BACKUP_KEY = {
  github: SETTING_KEYS.lastBackupGithub,
  syncd: SETTING_KEYS.lastBackupSyncd,
} as const satisfies Record<BackupTargetId, string>;

/** A target is fresh when its last successful snapshot is from today (local). */
async function targetFreshToday(target: BackupTargetId): Promise<boolean> {
  const last = await getLastBackup(LAST_BACKUP_KEY[target]);
  return last !== null && localDateKey(new Date(last.at)) === localDateKey();
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
  if (!prefs.githubEnabled && !prefs.syncdEnabled) return skip('target-disabled');

  // Resolve each enabled target's config; enabled-but-unconfigured is that
  // target's own failure, never a reason to hold up the other.
  const github = prefs.githubEnabled
    ? { config: await getRepoConfig(), pat: await getPat() }
    : null;
  const syncd = prefs.syncdEnabled
    ? { config: await getSyncdConfig(), token: await getSyncdToken() }
    : null;
  const githubReady = !!(github?.config && github.pat);
  const syncdReady = !!(syncd?.config && syncd.token);
  if (!githubReady && !syncdReady) {
    return trigger === 'manual'
      ? fail(new BackupError('not-configured', 'no backup target is fully configured'))
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

    const targets: Partial<Record<BackupTargetId, TargetOutcome>> = {};
    summary.targets = targets;

    const runTarget = async (
      target: BackupTargetId,
      ready: boolean,
      upload: () => Promise<number>,
    ): Promise<void> => {
      if (!ready) {
        targets[target] = { ok: false, error: 'Not configured — add it in Settings → Backup.' };
        track('backup_target_result', { target, trigger, ok: false, code: 'not-configured' });
        return;
      }
      // The daily auto trigger tops up only the targets that missed today
      // (e.g. syncd was unreachable this morning, GitHub already ran).
      if (trigger === 'daily-auto' && (await targetFreshToday(target))) {
        targets[target] = { ok: true, skippedFresh: true };
        return;
      }
      try {
        const pruned = await upload();
        await setLastBackup(LAST_BACKUP_KEY[target], {
          at: sealed.createdAt.getTime(),
          name: sealed.name,
        });
        targets[target] = { ok: true, pruned };
        track('backup_target_result', { target, trigger, ok: true, pruned });
      } catch (err) {
        const e = toBackupError(err);
        targets[target] = { ok: false, error: friendlyBackupMessage(e) };
        console.warn(`[backup] ${target} target failed: ${e.code}`);
        track('backup_target_result', { target, trigger, ok: false, code: e.code });
      }
    };

    await runTarget('github', githubReady, async () => {
      const client = new GithubContentClient(github!.config!, github!.pat!);
      await client.putFile(
        `${BACKUPS_DIR}/${sealed.name}`,
        bytesToBase64(utf8Bytes(sealed.json)),
        `Backup ${sealed.name}`,
      );
      // Retention prune — a failure here never fails the backup itself.
      useBackupStatus.getState().setPhase('pruning');
      try {
        return await pruneGithubBackups(client);
      } catch (err) {
        console.warn(`[backup] prune failed: ${toBackupError(err).code}`);
        return 0;
      }
    });

    await runTarget('syncd', syncdReady, async () => {
      const client = new SyncdClient(syncd!.config!.host, syncd!.token!);
      try {
        // syncd applies retention server-side on every upload.
        const result = await client.putBackup(sealed.name, sealed.json);
        reportSyncdReachability(true);
        return result.pruned;
      } catch (err) {
        reportSyncdReachability(toBackupError(err).code !== 'syncd-unreachable');
        throw err;
      }
    });

    const attempted = Object.values(targets).filter((t) => !t.skippedFresh);
    const failures = attempted.filter((t) => !t.ok);
    summary.name = sealed.name;
    if (failures.length > 0) {
      summary.outcome = 'error';
      summary.error = failures[0]!.error;
      track('backup_failed', { trigger, code: 'target-failed', failed: failures.length });
    } else {
      track('backup_succeeded', {
        trigger,
        bytes: sealed.json.length,
        targets: Object.keys(targets).join(','),
        secretsDropped: sealed.secretsDropped,
      });
    }
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
