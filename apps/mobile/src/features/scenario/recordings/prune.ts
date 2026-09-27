import { repos } from '@/db';
import { isBackupConfigured } from '@/features/backup/config';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { attemptFile, deleteRunDir, listRunDirs } from './paths';
import { planPrune, type PruneCandidate } from './prune-core';
import { getRecordingsSettings, setRecordingsSettings } from './recordings-settings';

/**
 * The prune service (T63, §10.1): at app start and after every finished
 * run. Reads the policy, lists the run dirs actually on disk, joins the DB
 * rows, plans through `prune-core`, deletes the losers' directories, flips
 * `mediaLocal` on their rows (attempt rows keep duration + words — only
 * `audioFile` goes). A run dir with no DB row (a wiped DB, a crash between
 * dir creation and the row) is deleted outright. Never throws.
 */

export interface PruneResult {
  runs: number;
  bytes: number;
  protectedCount: number;
}

let inFlight: Promise<PruneResult> | null = null;

export function pruneRecordings(reason: 'start' | 'post-run' | 'manual'): Promise<PruneResult> {
  if (inFlight) return inFlight;
  inFlight = doPrune(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doPrune(reason: 'start' | 'post-run' | 'manual'): Promise<PruneResult> {
  const empty: PruneResult = { runs: 0, bytes: 0, protectedCount: 0 };
  try {
    if (reason === 'start') await repos.scenarios.clearLegacyAudioFiles();
    const settings = await getRecordingsSettings();
    const dirs = listRunDirs();
    if (dirs.length === 0) {
      await reconcileMissingMedia(new Set());
      await setRecordingsSettings({ lastPruneAt: Date.now() });
      return empty;
    }
    const rows = await repos.scenarios.getRunsByIds(dirs.map((d) => d.runId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    await reconcileMissingMedia(new Set(dirs.filter((d) => d.bytes > 0).map((d) => d.runId)));

    const orphans = dirs.filter((d) => !byId.has(d.runId));
    const candidates: PruneCandidate[] = dirs
      .filter((d) => byId.has(d.runId))
      .map((d) => {
        const r = byId.get(d.runId)!;
        return {
          runId: r.id,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          pinned: r.pinned,
          bytes: d.bytes,
          bundleState: r.mediaBundleState as PruneCandidate['bundleState'],
        };
      });

    const plan = planPrune(candidates, {
      pruneDays: settings.pruneDays,
      capBytes: settings.capBytes,
      protectUnbundled: await isBackupConfigured(),
    });

    let bytes = 0;
    const pruned: string[] = [];
    for (const o of orphans) {
      if (deleteRunDir(o.runId)) bytes += o.bytes;
    }
    const sizeOf = new Map(dirs.map((d) => [d.runId, d.bytes]));
    for (const runId of plan.prune) {
      if (deleteRunDir(runId)) {
        pruned.push(runId);
        bytes += sizeOf.get(runId) ?? 0;
      }
    }
    if (pruned.length > 0) await repos.scenarios.markMediaPruned(pruned);
    await setRecordingsSettings({ lastPruneAt: Date.now() });
    if (pruned.length > 0 || orphans.length > 0) {
      track('recordings_pruned', {
        runs: pruned.length,
        bytes,
        orphans: orphans.length,
        reason,
        protectedCount: plan.protectedCount,
      });
    }
    return { runs: pruned.length, bytes, protectedCount: plan.protectedCount };
  } catch (err) {
    logError('manual', err);
    return empty;
  }
}

/**
 * Rows that say `mediaLocal` but have no files on disk (a folder removed
 * outside the app, a crash between dir creation and the row) flip to
 * pruned so the debrief offers Download / says «deleted» instead of a dead ▶.
 */
async function reconcileMissingMedia(runIdsWithFiles: Set<string>): Promise<number> {
  const believers = await repos.scenarios.listRunsWithLocalMedia();
  const missing = believers.filter((r) => !runIdsWithFiles.has(r.id)).map((r) => r.id);
  if (missing.length > 0) await repos.scenarios.markMediaPruned(missing);
  return missing.length;
}

/** The debrief's open-time check for ONE run: files gone ⇒ the row says so. Returns the truth. */
export async function reconcileRunMedia(runId: string): Promise<boolean> {
  const run = await repos.scenarios.getRun(runId);
  if (!run || !run.mediaLocal) return false;
  const attempts = await repos.scenarios.listAttemptsWithAudio(runId);
  const anyFile = attempts.some((a) => attemptFile(runId, a.audioFile!).exists);
  if (anyFile) return true;
  await repos.scenarios.markMediaPruned([runId]);
  return false;
}

/** Settings → «Delete all recordings»: every run dir, rows kept. */
export async function deleteAllRecordings(): Promise<PruneResult> {
  const dirs = listRunDirs();
  let bytes = 0;
  const pruned: string[] = [];
  for (const d of dirs) {
    if (deleteRunDir(d.runId)) {
      pruned.push(d.runId);
      bytes += d.bytes;
    }
  }
  const known = new Set((await repos.scenarios.getRunsByIds(pruned)).map((r) => r.id));
  const knownIds = pruned.filter((id) => known.has(id));
  if (knownIds.length > 0) await repos.scenarios.markMediaPruned(knownIds);
  track('recordings_pruned', { runs: knownIds.length, bytes, reason: 'delete-all' });
  return { runs: knownIds.length, bytes, protectedCount: 0 };
}

/** Total bytes of every run dir (the Settings row). */
export function recordingsTotalBytes(): number {
  return listRunDirs().reduce((s, d) => s + d.bytes, 0);
}
