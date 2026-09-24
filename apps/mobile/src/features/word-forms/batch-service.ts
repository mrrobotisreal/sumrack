import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { isOnline } from '@/features/ai/connectivity';
import type { AiRunProfile } from '@/features/ai/run-profile';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';

import {
  cancelBatch as cancelState,
  parseBatchState,
  planBatch,
  processBatch,
  progressOf,
  retryFailed as retryState,
  type BatchPendingItem,
  type BatchPlan,
  type BatchState,
} from './batch-core';
import { generateProfile } from './profile-service';
import { useWordFormsBatch } from './use-word-forms-batch';

/**
 * Durable word-forms batch (M16/T55, WORD_FORMS §7.5): production wiring
 * of the pure pass in batch-core.ts. The durable queue is the
 * `grammar.batch` settings row; ephemeral progress is the zustand store.
 *
 * The pump runs on app start, on foreground and on connectivity regained
 * (use-ai-queue.ts — the T16 worker), plus right after Start / Retry.
 * Concurrent triggers join the in-flight pass, so ONE request is ever in
 * flight for the batch (Ultra runs are slow; receipts must stay honest).
 */

/** Upper bound on one batch; the Словарь count is the real N below it. */
export const BATCH_MAX_ITEMS = 500;

async function loadState(): Promise<BatchState | null> {
  return parseBatchState(await repos.settings.get<unknown>(SETTING_KEYS.grammarBatch));
}
async function saveState(state: BatchState): Promise<void> {
  await repos.settings.set(SETTING_KEYS.grammarBatch, state);
}
async function removeState(): Promise<void> {
  await repos.settings.remove(SETTING_KEYS.grammarBatch);
}

function publish(state: BatchState | null, phase: 'idle' | 'paused' = 'idle') {
  useWordFormsBatch.getState().setProgress(progressOf(state, state ? phase : 'idle'));
}

/** Every reader of profiles / the «N words without forms» count refreshes. */
function invalidateProfiles(item?: BatchPendingItem) {
  if (item) {
    void queryClient.invalidateQueries({ queryKey: ['word-profile', item.lemmaNorm, item.kind] });
    void queryClient.invalidateQueries({ queryKey: ['lesson-counts', item.lemmaNorm, item.kind] });
  }
  void queryClient.invalidateQueries({ queryKey: ['profile-coverage'] });
}

let pumpInFlight: Promise<void> | null = null;
let cancelRequested = false;

/** Drain the batch; concurrent triggers join the in-flight pass (T07/T16 pattern). */
export function pumpWordFormsBatch(): Promise<void> {
  if (pumpInFlight) return pumpInFlight;
  cancelRequested = false;
  pumpInFlight = processBatch({
    load: loadState,
    save: saveState,
    remove: removeState,
    generate: async (item, preset) => {
      const row = await repos.bank.getItem(item.bankItemId);
      if (!row) return { missing: true };
      const result = await generateProfile(row, preset, { regenerate: false });
      invalidateProfiles(item);
      return { costUsd: result.row.costUsd ?? undefined };
    },
    isOnline,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onProgress: (progress) => useWordFormsBatch.getState().setProgress(progress),
    track,
    now: () => Date.now(),
    cancelRequested: () => cancelRequested,
  })
    .then(() => undefined)
    .catch((err: unknown) => {
      // The pass itself never throws for AI errors (they are outcomes); a
      // DB failure here must not take the worker down. Surface as paused.
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[word-forms batch]', err);
      track('app_error', { scope: 'word-forms-batch', fatal: false });
      void loadState().then((s) => publish(s, 'paused'));
    })
    .finally(() => {
      pumpInFlight = null;
    });
  return pumpInFlight;
}

/** Read the row once (app start / Словарь mount) so the row's UI is right before any pump. */
export async function hydrateWordFormsBatch(): Promise<void> {
  if (pumpInFlight) return;
  publish(await loadState(), 'paused');
}

export interface StartBatchResult extends BatchPlan {
  /** False when a batch is already running/pending — nothing was started. */
  started: boolean;
}

/**
 * Plan a batch over every bank item without a current profile and write
 * the row (§2.4) BEFORE the first request; `profile_batch_started`; then pump.
 */
export async function startBatch(run: AiRunProfile): Promise<StartBatchResult> {
  const existing = await loadState();
  if (existing && existing.pending.length > 0) {
    return { started: false, state: existing, skipped: 0 };
  }
  const items = await repos.wordForms.listItemsWithoutProfile(BATCH_MAX_ITEMS);
  const preset = { provider: run.provider, quality: run.quality, effort: run.effort };
  const plan = planBatch(items, preset, Date.now());
  if (!plan.state) return { started: false, ...plan };
  await saveState(plan.state);
  track('profile_batch_started', { count: plan.state.count, ...preset });
  publish(plan.state, 'paused');
  void pumpWordFormsBatch();
  return { started: true, ...plan };
}

/**
 * Cancel: clear pending, keep what finished. The in-flight request (if any)
 * completes and its profile is kept — the pass re-reads the row before it
 * writes, so the cancelled state is never resurrected.
 */
export async function cancelWordFormsBatch(): Promise<void> {
  cancelRequested = true;
  const state = await loadState();
  if (!state) return;
  track('profile_batch_cancelled', { done: state.done, remaining: state.pending.length });
  const next = cancelState(state, Date.now());
  if (next) await saveState(next);
  else await removeState();
  publish(next);
  invalidateProfiles();
}

/** Re-queue every failed item and pump. */
export async function retryWordFormsBatch(): Promise<void> {
  const state = await loadState();
  if (!state || state.failed.length === 0) return;
  const next = retryState(state);
  await saveState(next);
  publish(next, 'paused');
  void pumpWordFormsBatch();
}

/** Dismiss a finished-with-failures row without retrying (clears it). */
export async function dismissWordFormsBatch(): Promise<void> {
  const state = await loadState();
  if (!state || state.pending.length > 0) return;
  await removeState();
  publish(null);
}
