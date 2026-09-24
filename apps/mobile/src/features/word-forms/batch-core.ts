import { z } from 'zod';

import type { AiEffort, AiProvider, AiQuality } from '@/db/schema/user';
import { AiError, isRetriable, toAiError } from '@/features/ai/errors';
import type { AnalyticsEvent, AnalyticsProps } from '@/services/analytics';

import { profileKeyFor, type ProfileKey } from './profile-core';

/**
 * Pure state machine for the durable word-forms batch (M16/T55, WORD_FORMS
 * §2.4 + §7.5) — the `queue-core.ts` precedent: no DB, network or store
 * imports, so vitest drives the exact production logic against fakes.
 * Wiring (settings row, `generateProfile`, zustand, events) lives in
 * batch-service.ts.
 *
 * The durable state IS the `grammar.batch` settings row. The worker keeps
 * the row honest at every step: it is saved BEFORE a request goes out and
 * an item is removed only AFTER its profile is stored, so a kill loses at
 * most one paid run and never a stored profile.
 *
 * Retry rules (the one deviation from `isRetriable`, ticket technical
 * note): an `invalid-response` that survived the service's own correction
 * round is TERMINAL for that word — otherwise a word the model cannot
 * profile would be re-run on every pump forever. Transport errors get the
 * 2 s / 8 s ladder inside a pass and a per-item `attempts` counter (max 3
 * across pumps) before they, too, become `failed`.
 */

export const MAX_ATTEMPTS = 3;
/** Transient-failure retries within one pass (then the item waits for the next pump). */
export const BATCH_RETRY_DELAYS_MS = [2_000, 8_000];

export interface BatchPreset {
  provider: AiProvider;
  quality: AiQuality;
  effort: AiEffort;
}

export interface BatchPendingItem extends ProfileKey {
  bankItemId: string;
  headword: string;
  /** Pumps in which the transport ladder was exhausted for this item. */
  attempts: number;
}

export interface BatchFailure extends ProfileKey {
  bankItemId: string;
  headword: string;
  /** An `AiErrorCode`, or `missing` when the bank row vanished mid-batch. */
  code: string;
}

export interface BatchState {
  v: 1;
  startedAt: number;
  preset: BatchPreset;
  /** Items still to run, in bank order (order met). */
  pending: BatchPendingItem[];
  done: number;
  failed: BatchFailure[];
  /** `pending.length + done + failed.length` at start — the honesty invariant. */
  count: number;
  /** Sum of the receipts of every finished run (USD, OpenRouter usage accounting). */
  costUsd: number;
  /** Set the first time pending hits zero; cleared by retry. */
  finishedAt?: number;
}

const PresetSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  quality: z.enum(['fastest', 'fast', 'normal', 'best']),
  effort: z.enum(['low', 'medium', 'high', 'ultra']),
});
const KeyedSchema = {
  bankItemId: z.string().min(1),
  lemmaNorm: z.string().min(1),
  kind: z.enum(['word', 'phrase']),
  headword: z.string().min(1),
};
export const BatchStateSchema = z.object({
  v: z.literal(1),
  startedAt: z.number().nonnegative(),
  preset: PresetSchema,
  pending: z.array(z.object({ ...KeyedSchema, attempts: z.number().int().nonnegative() })),
  done: z.number().int().nonnegative(),
  failed: z.array(z.object({ ...KeyedSchema, code: z.string().min(1) })),
  count: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  finishedAt: z.number().nonnegative().optional(),
});

/** Zod-validated read of the settings row; a malformed row is treated as absent. */
export function parseBatchState(raw: unknown): BatchState | null {
  if (raw == null) return null;
  const parsed = BatchStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface PlanInput {
  id: string;
  kind: 'word' | 'phrase';
  lemmaNorm: string | null;
  normalized: string;
  lemma: string | null;
  surface: string;
}

export interface BatchPlan {
  /** Null when nothing is runnable. */
  state: BatchState | null;
  /** Needs-lemma words left out («{k} skipped — no lemma yet»). */
  skipped: number;
}

/** Headword the way every M16 surface names an item. */
export function headwordFor(item: Pick<PlanInput, 'kind' | 'lemma' | 'surface'>): string {
  return item.kind === 'word' ? (item.lemma ?? item.surface) : item.surface;
}

/**
 * Words with a profile key only (§5.4); needs-lemma items are excluded and
 * counted as skipped. The caller passes items that have no current profile.
 */
export function planBatch(items: PlanInput[], preset: BatchPreset, now: number): BatchPlan {
  const pending: BatchPendingItem[] = [];
  let skipped = 0;
  for (const item of items) {
    const key = profileKeyFor(item);
    if (!key) {
      skipped++;
      continue;
    }
    pending.push({ ...key, bankItemId: item.id, headword: headwordFor(item), attempts: 0 });
  }
  if (pending.length === 0) return { state: null, skipped };
  return {
    state: {
      v: 1,
      startedAt: now,
      preset,
      pending,
      done: 0,
      failed: [],
      count: pending.length,
      costUsd: 0,
    },
    skipped,
  };
}

export type BatchOutcome =
  | { type: 'done'; costUsd?: number }
  | { type: 'failed'; code: string }
  /** Transport ladder exhausted this pass: bump `attempts`, keep pending (or fail at the cap). */
  | { type: 'retry'; code: string };

/**
 * Fold one item's outcome into the state. Unknown ids (an in-flight run
 * finishing after Cancel) leave the state untouched — the profile it
 * stored is kept, the counters were already reported by the cancel event.
 */
export function applyResult(
  state: BatchState,
  bankItemId: string,
  outcome: BatchOutcome,
): BatchState {
  const idx = state.pending.findIndex((p) => p.bankItemId === bankItemId);
  if (idx === -1) return state;
  const item = state.pending[idx]!;
  const rest = state.pending.filter((_, i) => i !== idx);
  switch (outcome.type) {
    case 'done':
      return {
        ...state,
        pending: rest,
        done: state.done + 1,
        costUsd: state.costUsd + Math.max(0, outcome.costUsd ?? 0),
      };
    case 'failed':
      return { ...state, pending: rest, failed: [...state.failed, toFailure(item, outcome.code)] };
    case 'retry': {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        return {
          ...state,
          pending: rest,
          failed: [...state.failed, toFailure(item, outcome.code)],
        };
      }
      // Keep its place in the queue so the order stays "order met".
      const pending = state.pending.slice();
      pending[idx] = { ...item, attempts };
      return { ...state, pending };
    }
  }
}

function toFailure(item: BatchPendingItem, code: string): BatchFailure {
  const { attempts: _attempts, ...keyed } = item;
  return { ...keyed, code };
}

/**
 * Is this error final for the word? Everything `isRetriable` rejects is,
 * plus `invalid-response` (the service already spent its one correction
 * round — see the module comment).
 */
export function isTerminal(err: unknown): boolean {
  const e = toAiError(err);
  return !isRetriable(e) || e.code === 'invalid-response';
}

/** Codes that stop the whole pass instead of judging one item (T16 rules). */
export function stopsPass(err: unknown): boolean {
  const e = toAiError(err);
  return e.code === 'no-key' || e.code === 'http-auth' || e.code === 'offline';
}

/** Re-queue every failed item (attempts reset) behind whatever is still pending. */
export function retryFailed(state: BatchState): BatchState {
  if (state.failed.length === 0) return state;
  const requeued: BatchPendingItem[] = state.failed.map(({ code: _code, ...keyed }) => ({
    ...keyed,
    attempts: 0,
  }));
  const { finishedAt: _finishedAt, ...rest } = state;
  return { ...rest, pending: [...state.pending, ...requeued], failed: [] };
}

/** Cancel: clear pending, keep what finished. Null when nothing is left to show. */
export function cancelBatch(state: BatchState, now: number): BatchState | null {
  if (state.failed.length === 0) return null;
  return { ...state, pending: [], finishedAt: state.finishedAt ?? now };
}

/** True when every item has been resolved (done or failed). */
export function isBatchFinished(state: BatchState): boolean {
  return state.pending.length === 0;
}

export function remainingOf(state: BatchState): number {
  return state.pending.length;
}

// --- the worker pass ----------------------------------------------------------

export type BatchPhase = 'idle' | 'running' | 'paused';
export type BatchPauseReason = 'offline' | 'no-key' | 'http-auth' | 'transport';

export interface BatchProgress {
  phase: BatchPhase;
  done: number;
  failed: number;
  remaining: number;
  count: number;
  currentHeadword: string | null;
  /** Why the last pass stopped short (phase 'paused'). */
  pauseReason: BatchPauseReason | null;
}

export function progressOf(
  state: BatchState | null,
  phase: BatchPhase,
  currentHeadword: string | null = null,
  pauseReason: BatchPauseReason | null = null,
): BatchProgress {
  return {
    phase,
    done: state?.done ?? 0,
    failed: state?.failed.length ?? 0,
    remaining: state?.pending.length ?? 0,
    count: state?.count ?? 0,
    currentHeadword,
    pauseReason,
  };
}

export interface GenerateOutcome {
  costUsd?: number;
  /** The bank row is gone — counted as `failed` with code `missing`. */
  missing?: boolean;
}

export interface BatchDeps {
  load: () => Promise<BatchState | null>;
  save: (state: BatchState) => Promise<void>;
  remove: () => Promise<void>;
  /** One profile generation; throws `AiError` (transport codes pass through). */
  generate: (item: BatchPendingItem, preset: BatchPreset) => Promise<GenerateOutcome>;
  isOnline: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  onProgress: (progress: BatchProgress) => void;
  track: (event: AnalyticsEvent, props?: AnalyticsProps) => void;
  now: () => number;
  /** Set by Cancel while a request is in flight; checked between items. */
  cancelRequested?: () => boolean;
  retryDelaysMs?: number[];
}

export type BatchPassOutcome =
  | 'empty' // no row, or a finished row (nothing to run)
  | 'finished' // pending reached zero this pass
  | 'stopped' // pass ended early (offline / key / transport ladder exhausted)
  | 'cancelled';

export interface BatchPassResult {
  outcome: BatchPassOutcome;
  reason: BatchPauseReason | null;
  /** Items resolved (done or failed) by this pass. */
  processed: number;
}

/**
 * Drain the batch SEQUENTIALLY — one request in flight, ever (Ultra runs
 * are slow and the receipts must stay honest). Every step re-reads the row
 * it is about to mutate so a concurrent Cancel wins.
 */
export async function processBatch(deps: BatchDeps): Promise<BatchPassResult> {
  const delays = deps.retryDelaysMs ?? BATCH_RETRY_DELAYS_MS;
  let state = await deps.load();
  if (!state) {
    deps.onProgress(progressOf(null, 'idle'));
    return { outcome: 'empty', reason: null, processed: 0 };
  }
  if (isBatchFinished(state)) {
    deps.onProgress(progressOf(state, 'idle'));
    return { outcome: 'empty', reason: null, processed: 0 };
  }

  let processed = 0;
  let stopReason: BatchPauseReason | null = null;

  while (state && !isBatchFinished(state)) {
    if (deps.cancelRequested?.()) {
      deps.onProgress(progressOf(await deps.load(), 'idle'));
      return { outcome: 'cancelled', reason: null, processed };
    }
    if (!(await deps.isOnline())) {
      stopReason = 'offline';
      break;
    }
    const item = state.pending[0]!;
    deps.onProgress(progressOf(state, 'running', item.headword));

    let outcome: BatchOutcome | null = null;
    let passStopper: AiError | null = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const result = await deps.generate(item, state.preset);
        outcome = result.missing
          ? { type: 'failed', code: 'missing' }
          : { type: 'done', costUsd: result.costUsd };
        break;
      } catch (err) {
        const e = toAiError(err);
        if (stopsPass(e)) {
          passStopper = e;
          break;
        }
        if (isTerminal(e)) {
          outcome = { type: 'failed', code: e.code };
          break;
        }
        if (attempt === delays.length) {
          outcome = { type: 'retry', code: e.code };
          break;
        }
        await deps.sleep(delays[attempt]!);
      }
    }

    if (passStopper) {
      stopReason =
        passStopper.code === 'offline' ? 'offline' : (passStopper.code as 'no-key' | 'http-auth');
      break;
    }

    // Re-read before writing: a Cancel during the request must win.
    const fresh = await deps.load();
    if (!fresh) {
      deps.onProgress(progressOf(null, 'idle'));
      return { outcome: 'cancelled', reason: null, processed };
    }
    const before = fresh.pending.length;
    state = applyResult(fresh, item.bankItemId, outcome!);
    const resolved = state.pending.length < before;
    if (resolved) {
      processed++;
      deps.track('profile_batch_progress', {
        done: state.done,
        failed: state.failed.length,
        remaining: state.pending.length,
      });
    }
    if (isBatchFinished(state) && state.finishedAt === undefined) {
      state = { ...state, finishedAt: deps.now() };
      deps.track('profile_batch_finished', {
        done: state.done,
        failed: state.failed.length,
        ms: state.finishedAt - state.startedAt,
        costUsd: Math.round(state.costUsd * 1000) / 1000,
      });
    }
    if (isBatchFinished(state) && state.failed.length === 0) {
      await deps.remove();
      deps.onProgress(progressOf(null, 'idle'));
      return { outcome: 'finished', reason: null, processed };
    }
    await deps.save(state);
    if (outcome!.type === 'retry' && !resolved) {
      // The transport ladder ran dry on this item: wait for the next pump
      // rather than hammering the same request in a loop.
      stopReason = 'transport';
      break;
    }
  }

  if (state && isBatchFinished(state)) {
    // Finished with failures: the row stays so «n failed · Retry» can re-queue them.
    deps.onProgress(progressOf(state, 'idle'));
    return { outcome: 'finished', reason: null, processed };
  }
  deps.onProgress(progressOf(state, 'paused', null, stopReason));
  return { outcome: 'stopped', reason: stopReason, processed };
}
