import { repos } from '@/db';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { deleteRunDir, listRunDirs } from './paths';
import { planPrune, type PruneCandidate } from './prune-core';
import { getRecordingsSettings } from './recordings-settings';

/**
 * The exam-root prune (T73, TORFL §8.5): `recordings/exam/<attemptId>/`
 * dirs are treated like scenario runs by the SAME planner — unpinned
 * attempts older than `pruneDays` go first, then oldest unpinned finished
 * attempts until the folder fits `capBytes`; pinned attempts are never
 * planned. The rows stay (transcript, points, grading); only the speaking
 * answers' `recordingPath` flips to null. A dir with no attempt row is
 * deleted outright. `protectUnbundled` is off until T74 ships exam media
 * bundles (there is nothing to protect yet). Never throws.
 */
export interface ExamPruneResult {
  attempts: number;
  bytes: number;
}

export async function pruneExamRecordings(
  reason: 'start' | 'post-run' | 'manual',
): Promise<ExamPruneResult> {
  const empty: ExamPruneResult = { attempts: 0, bytes: 0 };
  try {
    const dirs = listRunDirs('exam');
    const withFiles = new Set(dirs.filter((d) => d.bytes > 0).map((d) => d.runId));
    await reconcileMissingExamMedia(withFiles);
    if (dirs.length === 0) return empty;
    const settings = await getRecordingsSettings();
    const rows = await repos.exams.getAttemptsByIds(dirs.map((d) => d.runId));
    const byId = new Map(rows.map((r) => [r.id, r]));
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
          bundleState: null,
        };
      });
    const plan = planPrune(candidates, {
      pruneDays: settings.pruneDays,
      capBytes: settings.capBytes,
      protectUnbundled: false,
    });
    let bytes = 0;
    for (const o of orphans) if (deleteRunDir(o.runId, 'exam')) bytes += o.bytes;
    const sizeOf = new Map(dirs.map((d) => [d.runId, d.bytes]));
    const pruned: string[] = [];
    for (const id of plan.prune) {
      if (deleteRunDir(id, 'exam')) {
        pruned.push(id);
        bytes += sizeOf.get(id) ?? 0;
      }
    }
    if (pruned.length > 0) await repos.exams.markRecordingsPruned(pruned);
    if (pruned.length > 0 || orphans.length > 0) {
      track('recordings_pruned', {
        runs: pruned.length,
        bytes,
        orphans: orphans.length,
        reason,
        protectedCount: 0,
        root: 'exam',
      });
    }
    return { attempts: pruned.length, bytes };
  } catch (err) {
    logError('manual', err);
    return empty;
  }
}

/** Speaking answers that point at files which are gone flip to `recordingPath: null`. */
async function reconcileMissingExamMedia(attemptIdsWithFiles: Set<string>): Promise<number> {
  const believers = await repos.exams.listAttemptsWithRecordings();
  const missing = believers.filter((a) => !attemptIdsWithFiles.has(a.id)).map((a) => a.id);
  if (missing.length > 0) await repos.exams.markRecordingsPruned(missing);
  return missing.length;
}

/** Total bytes under `recordings/exam/` (the Settings row, T74). */
export function examRecordingsTotalBytes(): number {
  return listRunDirs('exam').reduce((s, d) => s + d.bytes, 0);
}
