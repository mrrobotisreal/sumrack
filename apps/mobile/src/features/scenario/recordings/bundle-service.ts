import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { repos } from '@/db';
import { isOnline } from '@/features/ai/connectivity';
import { getBackupKey, getBackupPrefs, getKdfConfig } from '@/features/backup/config';
import {
  decryptBackupBytes,
  encryptBackupBytes,
  envelopeKind,
  GCM_IV_BYTES,
  parseEnvelopeText,
} from '@/features/backup/crypto';
import { BackupError, toBackupError } from '@/features/backup/errors';
import { mediaFileName } from '@/features/backup/naming';
import { githubBackupPath, MEDIA_DIR, utf8Bytes } from '@/features/backup/service';
import type { BackupTargetId } from '@/features/backup/store';
import { SyncdClient } from '@/features/backup/syncd-client';
import { getSyncdConfig, getSyncdToken } from '@/features/backup/syncd-config';
import { reportSyncdReachability } from '@/features/backup/syncd-status';
import { getPat, getRepoConfig } from '@/features/sync/config';
import { SyncError } from '@/features/sync/errors';
import { GithubContentClient } from '@/features/sync/github-client';
import { bytesToBase64 } from '@/lib/base64';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { packMediaBundle, unpackMediaBundle, type BundleInput } from './media-bundle';
import { attemptFile, attemptStem, ensureRunDir, runDir } from './paths';
import { transcodeQueue } from './transcode-queue';

/**
 * Media bundles (T63, SPEAKING_SCENARIOS §10.3): after a run finishes and
 * its transcodes are done, `bundleRun(runId)` packs the run dir into one
 * `SMB1` blob, seals it with the T20 key (`kind: 'media'`), names it
 * `sumrak-media-<runId>.json` and uploads it to every enabled target —
 * GitHub under `backups/media/`, syncd through `putBackup` (the server
 * accepts the media name since the paired SumrakAPI change). State on the
 * run row: `null → pending → uploaded | failed`; the pump (`pumpBundles`)
 * retries `pending` + `failed` runs from the auto-backup trigger points and
 * picks up never-bundled finished runs (a kill before scheduling). Bundles
 * are immutable: a target that already has the name counts as uploaded.
 *
 * Lazy restore: `downloadBundle(runId)` fetches from whichever target has
 * it, decrypts, verifies every sha, writes the files back into the run dir
 * and flips `mediaLocal`. Nothing here ever blocks a screen.
 */

export type BundleState = 'pending' | 'uploaded' | 'failed';

/** Bundles are only worth it while a target exists; without one, recordings stay local (§12). */
async function bundlingPossible(): Promise<boolean> {
  const kdf = await getKdfConfig();
  if (!kdf) return false;
  const prefs = await getBackupPrefs();
  return prefs.githubEnabled || prefs.syncdEnabled;
}

let warnedWav = false;

async function readRunFiles(runId: string): Promise<{ files: BundleInput[]; wavCount: number }> {
  const attempts = await repos.scenarios.listAttemptsWithAudio(runId);
  const files: BundleInput[] = [];
  let wavCount = 0;
  const seen = new Set<string>();
  for (const a of attempts) {
    const name = a.audioFile!;
    if (seen.has(name)) continue;
    seen.add(name);
    const f = attemptFile(runId, name);
    if (!f.exists) continue;
    if (name.endsWith('.wav')) wavCount += 1;
    files.push({ name, data: await f.bytes() });
  }
  return { files, wavCount };
}

interface Targets {
  github: { client: GithubContentClient } | null;
  syncd: { client: SyncdClient } | null;
}

async function enabledTargets(): Promise<Targets> {
  const prefs = await getBackupPrefs();
  let github: Targets['github'] = null;
  let syncd: Targets['syncd'] = null;
  if (prefs.githubEnabled) {
    const config = await getRepoConfig();
    const pat = await getPat();
    if (config && pat) github = { client: new GithubContentClient(config, pat) };
  }
  if (prefs.syncdEnabled) {
    const config = await getSyncdConfig();
    const token = await getSyncdToken();
    if (config && token) syncd = { client: new SyncdClient(config.host, token) };
  }
  return { github, syncd };
}

/** `true` when the target already holds `name` (immutable ⇒ counts as uploaded). */
function isAlreadyThere(err: unknown): boolean {
  if (err instanceof SyncError) return err.code === 'http' && err.status === 422;
  const e = toBackupError(err);
  return e.code === 'syncd' && /409/.test(e.message);
}

const uploading = new Set<string>();

/**
 * Pack + seal + upload one finished run. Resolves with the resulting state;
 * never throws. `pending` means every target is unreachable right now (the
 * pump retries); `failed` means a target rejected the file for a
 * non-transient reason.
 */
export async function bundleRun(runId: string): Promise<BundleState | null> {
  if (uploading.has(runId)) return null;
  uploading.add(runId);
  try {
    const run = await repos.scenarios.getRun(runId);
    if (!run || run.finishedAt === null) return null;
    if (run.mediaBundleState === 'uploaded') return 'uploaded';
    if (!run.mediaLocal) return run.mediaBundleState as BundleState | null;
    if (!(await bundlingPossible())) return null;
    const key = await getBackupKey();
    if (!key) return null;
    const kdf = (await getKdfConfig())!;

    await transcodeQueue().whenIdle(runId);
    const { files, wavCount } = await readRunFiles(runId);
    if (files.length === 0) return null;
    if (wavCount > 0 && !warnedWav) {
      warnedWav = true;
      console.warn('[media-bundle] bundling WAV recordings (no Opus encoder) — ~10× larger');
      track('media_bundle_wav_warning', { files: wavCount });
    }

    const name = mediaFileName(runId);
    await repos.scenarios.setMediaBundle(runId, 'pending', name);

    const blob = packMediaBundle(runId, files);
    const envelope = encryptBackupBytes(blob, key, {
      saltB64: kdf.saltB64,
      iterations: kdf.iterations,
      iv: new Uint8Array(Crypto.getRandomBytes(GCM_IV_BYTES)),
      createdAt: new Date(),
      appVersion: Constants.expoConfig?.version,
      kind: 'media',
    });
    const json = JSON.stringify(envelope);

    if (!(await isOnline())) return 'pending';
    const targets = await enabledTargets();
    if (!targets.github && !targets.syncd) return 'pending';

    let anyOk = false;
    let anyTransient = false;
    let anyHard = false;
    const attempt = async (target: BackupTargetId, put: () => Promise<void>) => {
      try {
        await put();
        anyOk = true;
        track('media_bundle_uploaded', { bytes: json.length, target, files: files.length });
      } catch (err) {
        if (isAlreadyThere(err)) {
          anyOk = true;
          track('media_bundle_uploaded', {
            bytes: json.length,
            target,
            files: files.length,
            dup: true,
          });
          return;
        }
        const e = toBackupError(err);
        const transient =
          e.code === 'offline' ||
          e.code === 'syncd-unreachable' ||
          (err instanceof SyncError && (err.code === 'network' || err.code === 'rate-limited'));
        if (transient) anyTransient = true;
        else anyHard = true;
        console.warn(`[media-bundle] ${target} failed: ${e.code}`);
        track('media_bundle_failed', { bytes: json.length, target, code: e.code, transient });
      }
    };
    if (targets.github)
      await attempt('github', () =>
        targets.github!.client.putFile(
          githubBackupPath(MEDIA_DIR, name),
          bytesToBase64(utf8Bytes(json)),
          `Media bundle ${name}`,
        ),
      );
    if (targets.syncd)
      await attempt('syncd', async () => {
        try {
          await targets.syncd!.client.putBackup(name, json);
          reportSyncdReachability(true);
        } catch (err) {
          reportSyncdReachability(toBackupError(err).code !== 'syncd-unreachable');
          throw err;
        }
      });

    // Every enabled target that answered took it ⇒ uploaded; an unreachable
    // target with the other one fine still counts as uploaded (the file is
    // safe somewhere; T21 targets are independent). A hard rejection with
    // no success ⇒ failed; only transient trouble ⇒ pending.
    const state: BundleState = anyOk ? 'uploaded' : anyHard && !anyTransient ? 'failed' : 'pending';
    await repos.scenarios.setMediaBundle(runId, state, name);
    return state;
  } catch (err) {
    logError('manual', err);
    return null;
  } finally {
    uploading.delete(runId);
  }
}

/**
 * Fire-and-forget after FINISH: waits for the transcodes, then bundles.
 * Never awaited by the executor.
 */
export function scheduleBundle(runId: string): void {
  void bundleRun(runId);
}

let pumpInFlight: Promise<void> | null = null;

/**
 * The retry pump — joined to `use-auto-backup.ts`'s trigger points: every
 * `pending` / `failed` run, then finished runs that were never bundled
 * (killed before scheduling), a few per call, oldest first.
 */
export function pumpBundles(): Promise<void> {
  if (pumpInFlight) return pumpInFlight;
  pumpInFlight = (async () => {
    try {
      if (!(await bundlingPossible())) return;
      if (!(await isOnline())) return;
      const batch = [
        ...(await repos.scenarios.listRunsByBundleState('pending', { limit: 10 })),
        ...(await repos.scenarios.listRunsByBundleState('failed', { limit: 5 })),
        ...(await repos.scenarios.listRunsByBundleState(null, { limit: 10 })),
      ].filter((r) => r.mediaLocal);
      for (const run of batch) await bundleRun(run.id);
    } catch (err) {
      logError('manual', err);
    }
  })().finally(() => {
    pumpInFlight = null;
  });
  return pumpInFlight;
}

export interface DownloadResult {
  files: number;
  bytes: number;
  target: BackupTargetId;
}

/**
 * Lazy restore for one run (the debrief's Download): try syncd first (fast
 * on the tailnet), then GitHub; decrypt with the T20 key; verify; write the
 * files back; point the attempt rows at them; flip `mediaLocal`.
 */
export async function downloadBundle(runId: string): Promise<DownloadResult> {
  const run = await repos.scenarios.getRun(runId);
  if (!run) throw new BackupError('unknown', 'run not found');
  const name = run.mediaBundleName ?? mediaFileName(runId);
  const key = await getBackupKey();
  if (!key) {
    throw new BackupError(
      (await getKdfConfig()) ? 'no-key' : 'not-configured',
      'backup not set up',
    );
  }
  if (!(await isOnline())) throw new BackupError('offline', 'offline');

  const targets = await enabledTargets();
  let text: string | null = null;
  let from: BackupTargetId | null = null;
  let lastErr: unknown = new BackupError('not-configured', 'no backup target is configured');
  if (targets.syncd) {
    try {
      text = await targets.syncd.client.fetchBackup(name);
      from = 'syncd';
      reportSyncdReachability(true);
    } catch (err) {
      reportSyncdReachability(toBackupError(err).code !== 'syncd-unreachable');
      lastErr = err;
    }
  }
  if (!text && targets.github) {
    try {
      const bytes = await targets.github.client.fetchRawFile(githubBackupPath(MEDIA_DIR, name));
      text = new TextDecoder('utf-8').decode(bytes);
      from = 'github';
    } catch (err) {
      lastErr = err;
    }
  }
  if (!text || !from) throw toBackupError(lastErr);

  const envelope = parseEnvelopeText(text);
  if (envelopeKind(envelope) !== 'media') {
    throw new BackupError('invalid-envelope', 'that file is a snapshot, not a media bundle');
  }
  const blob = decryptBackupBytes(envelope, key);
  const { header, files } = unpackMediaBundle(blob);
  if (header.runId !== runId) {
    throw new BackupError('invalid-envelope', 'bundle belongs to a different run');
  }

  ensureRunDir(runId);
  let bytes = 0;
  for (const f of files) {
    const dest = new File(runDir(runId), f.name);
    if (dest.exists) dest.delete();
    dest.write(f.data);
    bytes += f.data.length;
  }
  // Re-point the attempts (the prune nulled `audioFile`): an attempt row
  // knows its turn + attemptNo, the file stem is `tNN-aM` with NN = the
  // turn's orderIdx — rebuilt from the scenario's turn table.
  const debrief = await repos.scenarios.getRunDebrief(runId);
  const byStem = new Map(files.map((f) => [f.name.replace(/\.(wav|ogg)$/, ''), f.name]));
  const orders = await repos.scenarios.getTurnOrders(run.packId, run.scenarioId);
  const updates: { attemptId: string; name: string }[] = [];
  for (const turn of debrief?.turns ?? []) {
    const orderIdx = orders.get(turn.turnId);
    if (orderIdx === undefined) continue;
    for (const a of turn.attempts) {
      const file = byStem.get(attemptStem(orderIdx, a.attemptNo));
      if (file) updates.push({ attemptId: a.id, name: file });
    }
  }
  await repos.scenarios.markMediaRestored(runId, updates);
  track('media_bundle_downloaded', { bytes, target: from, files: files.length });
  return { files: files.length, bytes, target: from };
}

/** Names of media bundles on every enabled target (the RUNBOOK/dev listing; the Backup card counts DB rows). */
export async function listRemoteBundles(): Promise<Record<BackupTargetId, string[] | null>> {
  const targets = await enabledTargets();
  const out: Record<BackupTargetId, string[] | null> = { github: null, syncd: null };
  if (targets.github) {
    try {
      const entries = await targets.github.client.listDirectory(MEDIA_DIR);
      out.github = entries.filter((e) => e.type === 'file').map((e) => e.name);
    } catch {
      out.github = null;
    }
  }
  if (targets.syncd) {
    try {
      out.syncd = (await targets.syncd.client.listMediaBundles()).map((b) => b.name);
    } catch {
      out.syncd = null;
    }
  }
  return out;
}
