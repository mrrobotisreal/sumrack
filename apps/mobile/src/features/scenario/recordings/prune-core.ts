/**
 * The pure prune planner (T63, SPEAKING_SCENARIOS §10.1). Given every run
 * that still has local media, decide whose files go: unpinned runs older
 * than `pruneDays`, then — if what remains is still over `capBytes` —
 * unpinned finished runs oldest-first until it fits. Pinned runs are never
 * planned; rows are never touched here (the service flips `mediaLocal`).
 *
 * `protectUnbundled` (set by the service when a backup target is
 * configured): a run whose media bundle has not been uploaded yet is
 * exempt from the AGE rule — deleting it would lose the only copy while an
 * upload is merely late — but not from the CAP rule, so a target that keeps
 * failing cannot grow the recordings folder without bound. Without a
 * configured target nothing is protected (§12: «prune still applies»).
 */

export interface PruneCandidate {
  runId: string;
  startedAt: number;
  finishedAt: number | null;
  pinned: boolean;
  bytes: number;
  /** `scenario_runs.mediaBundleState` — null (not bundled) · pending · uploaded · failed. */
  bundleState: 'pending' | 'uploaded' | 'failed' | null;
}

export interface PrunePolicy {
  pruneDays: number;
  capBytes: number;
  protectUnbundled?: boolean;
}

export interface PrunePlan {
  /** Run ids whose files should be deleted, in deletion order. */
  prune: string[];
  bytesFreed: number;
  /** Bytes still on disk after the plan (pinned included). */
  keptBytes: number;
  /** Count of runs the age rule would have taken but `protectUnbundled` kept. */
  protectedCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ageAnchor(run: PruneCandidate): number {
  return run.finishedAt ?? run.startedAt;
}

export function planPrune(
  runs: readonly PruneCandidate[],
  policy: PrunePolicy,
  now = Date.now(),
): PrunePlan {
  const cutoff = now - Math.max(0, policy.pruneDays) * DAY_MS;
  const prune: string[] = [];
  const pruned = new Set<string>();
  let protectedCount = 0;

  const withMedia = runs.filter((r) => r.bytes > 0);

  // Rule 1 — age.
  for (const run of withMedia) {
    if (run.pinned) continue;
    if (ageAnchor(run) > cutoff) continue;
    if (policy.protectUnbundled && run.bundleState !== 'uploaded') {
      protectedCount += 1;
      continue;
    }
    prune.push(run.runId);
    pruned.add(run.runId);
  }

  // Rule 2 — cap, oldest finished unpinned first.
  let total = withMedia.filter((r) => !pruned.has(r.runId)).reduce((s, r) => s + r.bytes, 0);
  if (total > policy.capBytes) {
    const order = withMedia
      .filter((r) => !pruned.has(r.runId) && !r.pinned && r.finishedAt !== null)
      .sort((a, b) => ageAnchor(a) - ageAnchor(b));
    for (const run of order) {
      if (total <= policy.capBytes) break;
      prune.push(run.runId);
      pruned.add(run.runId);
      total -= run.bytes;
    }
  }

  const bytesFreed = withMedia.filter((r) => pruned.has(r.runId)).reduce((s, r) => s + r.bytes, 0);
  return { prune, bytesFreed, keptBytes: total, protectedCount };
}
