import { describe, expect, it, vi } from 'vitest';

import { AiError } from '@/features/ai/errors';

import {
  applyResult,
  BatchStateSchema,
  cancelBatch,
  isBatchFinished,
  isTerminal,
  MAX_ATTEMPTS,
  parseBatchState,
  planBatch,
  processBatch,
  progressOf,
  retryFailed,
  stopsPass,
  type BatchDeps,
  type BatchPendingItem,
  type BatchPreset,
  type BatchProgress,
  type BatchState,
  type PlanInput,
} from '../batch-core';

const PRESET: BatchPreset = { provider: 'anthropic', quality: 'normal', effort: 'high' };

function word(id: string, lemma: string | null = id): PlanInput {
  return { id, kind: 'word', lemmaNorm: lemma, normalized: id, lemma, surface: `${id}-surface` };
}
function phrase(id: string): PlanInput {
  return {
    id,
    kind: 'phrase',
    lemmaNorm: null,
    normalized: `${id}-norm`,
    lemma: null,
    surface: `${id} фраза`,
  };
}

function planned(items: PlanInput[] = [word('a'), word('b'), word('c')]): BatchState {
  return planBatch(items, PRESET, 1_000).state!;
}

describe('planBatch', () => {
  it('keys words by lemma and phrases by normalized, skipping needs-lemma words', () => {
    const { state, skipped } = planBatch(
      [word('a'), word('nolemma', null), phrase('p')],
      PRESET,
      5,
    );
    expect(skipped).toBe(1);
    expect(state).toMatchObject({
      v: 1,
      startedAt: 5,
      preset: PRESET,
      done: 0,
      failed: [],
      count: 2,
      costUsd: 0,
    });
    expect(state!.pending).toEqual([
      { bankItemId: 'a', lemmaNorm: 'a', kind: 'word', headword: 'a', attempts: 0 },
      { bankItemId: 'p', lemmaNorm: 'p-norm', kind: 'phrase', headword: 'p фраза', attempts: 0 },
    ]);
    expect(BatchStateSchema.safeParse(state).success).toBe(true);
  });

  it('returns no state when only needs-lemma words are given', () => {
    const { state, skipped } = planBatch([word('x', null), word('y', null)], PRESET, 5);
    expect(state).toBeNull();
    expect(skipped).toBe(2);
  });

  it('parseBatchState heals a malformed row to absent', () => {
    expect(parseBatchState(null)).toBeNull();
    expect(parseBatchState({ v: 2 })).toBeNull();
    expect(parseBatchState({ v: 1, pending: 'nope' })).toBeNull();
    const ok = planned();
    expect(parseBatchState(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
  });
});

describe('applyResult', () => {
  it('done removes the item, bumps done and folds the cost', () => {
    const s = applyResult(planned(), 'b', { type: 'done', costUsd: 0.12 });
    expect(s.pending.map((p) => p.bankItemId)).toEqual(['a', 'c']);
    expect(s.done).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.12);
    expect(s.done + s.failed.length + s.pending.length).toBe(s.count);
  });

  it('failed moves the item to failed with its code and no attempts field', () => {
    const s = applyResult(planned(), 'a', { type: 'failed', code: 'invalid-response' });
    expect(s.pending.map((p) => p.bankItemId)).toEqual(['b', 'c']);
    expect(s.failed).toEqual([
      { bankItemId: 'a', lemmaNorm: 'a', kind: 'word', headword: 'a', code: 'invalid-response' },
    ]);
  });

  it('retry keeps the item in place and counts attempts, failing at the cap', () => {
    let s = planned();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      s = applyResult(s, 'a', { type: 'retry', code: 'network' });
      expect(s.pending[0]).toMatchObject({ bankItemId: 'a', attempts: i });
      expect(s.failed).toEqual([]);
    }
    s = applyResult(s, 'a', { type: 'retry', code: 'network' });
    expect(s.pending.map((p) => p.bankItemId)).toEqual(['b', 'c']);
    expect(s.failed[0]).toMatchObject({ bankItemId: 'a', code: 'network' });
  });

  it('an unknown id is a no-op (a run finishing after Cancel)', () => {
    const s = planned();
    expect(applyResult(s, 'zzz', { type: 'done' })).toBe(s);
  });
});

describe('isTerminal / stopsPass', () => {
  it('invalid-response is terminal even though isRetriable says otherwise', () => {
    expect(isTerminal(new AiError('invalid-response', 'twice'))).toBe(true);
    expect(isTerminal(new AiError('http-client', '400', 400))).toBe(true);
    expect(isTerminal(new AiError('unknown', '?'))).toBe(true);
  });
  it('transport errors are not terminal', () => {
    for (const code of ['network', 'timeout', 'http-rate', 'http-server'] as const) {
      expect(isTerminal(new AiError(code, code))).toBe(false);
    }
  });
  it('key and offline errors stop the pass', () => {
    expect(stopsPass(new AiError('no-key', ''))).toBe(true);
    expect(stopsPass(new AiError('http-auth', '', 401))).toBe(true);
    expect(stopsPass(new AiError('offline', ''))).toBe(true);
    expect(stopsPass(new AiError('network', ''))).toBe(false);
  });
});

describe('retryFailed / cancelBatch', () => {
  it('retryFailed re-queues failures behind pending with attempts reset', () => {
    let s = applyResult(planned(), 'a', { type: 'failed', code: 'invalid-response' });
    s = applyResult(s, 'b', { type: 'done' });
    s = applyResult(s, 'c', { type: 'done' });
    s = { ...s, finishedAt: 9 };
    const r = retryFailed(s);
    expect(r.finishedAt).toBeUndefined();
    expect(r.failed).toEqual([]);
    expect(r.pending).toEqual([
      { bankItemId: 'a', lemmaNorm: 'a', kind: 'word', headword: 'a', attempts: 0 },
    ]);
    expect(r.done).toBe(2);
    const none = planned();
    expect(retryFailed(none)).toBe(none); // no failures ⇒ the same object
  });

  it('cancelBatch clears pending and keeps done; null when nothing failed', () => {
    const s = applyResult(planned(), 'a', { type: 'done' });
    expect(cancelBatch(s, 50)).toBeNull();
    const f = applyResult(s, 'b', { type: 'failed', code: 'network' });
    const c = cancelBatch(f, 50)!;
    expect(c.pending).toEqual([]);
    expect(c.done).toBe(1);
    expect(c.failed).toHaveLength(1);
    expect(c.finishedAt).toBe(50);
    expect(isBatchFinished(c)).toBe(true);
  });
});

// --- processBatch ----------------------------------------------------------------

function makeDeps(initial: BatchState | null, overrides: Partial<BatchDeps> = {}) {
  let row: BatchState | null = initial;
  const saves: BatchState[] = [];
  const progress: BatchProgress[] = [];
  const events: { event: string; props?: Record<string, unknown> }[] = [];
  let removed = 0;
  const deps: BatchDeps = {
    load: async () => (row ? JSON.parse(JSON.stringify(row)) : null),
    save: async (s) => {
      row = JSON.parse(JSON.stringify(s));
      saves.push(s);
    },
    remove: async () => {
      row = null;
      removed++;
    },
    generate: async () => ({ costUsd: 0.1 }),
    isOnline: async () => true,
    sleep: async () => {},
    onProgress: (p) => progress.push(p),
    track: (event, props) => events.push({ event, props }),
    now: () => 2_000,
    retryDelaysMs: [1, 1],
    ...overrides,
  };
  return {
    deps,
    saves,
    progress,
    events,
    row: () => row,
    removed: () => removed,
  };
}

describe('processBatch', () => {
  it('empty: no row ⇒ nothing happens, progress goes idle', async () => {
    const generate = vi.fn();
    const h = makeDeps(null, { generate });
    expect(await processBatch(h.deps)).toEqual({ outcome: 'empty', reason: null, processed: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(h.progress.at(-1)).toMatchObject({ phase: 'idle', remaining: 0 });
  });

  it('runs every pending item sequentially, saves after each, removes the row at the end', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const h = makeDeps(planned(), {
      generate: async (item) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(item.bankItemId);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { costUsd: 0.05 };
      },
    });
    const r = await processBatch(h.deps);
    expect(r).toEqual({ outcome: 'finished', reason: null, processed: 3 });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxInFlight).toBe(1);
    // saved after a and b; c finished the batch ⇒ removed instead of saved
    expect(h.saves.map((s) => s.pending.length)).toEqual([2, 1]);
    expect(h.row()).toBeNull();
    expect(h.removed()).toBe(1);
    const finished = h.events.find((e) => e.event === 'profile_batch_finished')!;
    expect(finished.props).toEqual({ done: 3, failed: 0, ms: 1_000, costUsd: 0.15 });
    const progressEvents = h.events.filter((e) => e.event === 'profile_batch_progress');
    expect(progressEvents).toHaveLength(3);
    expect(progressEvents.at(-1)!.props).toEqual({ done: 3, failed: 0, remaining: 0 });
    // the running progress named the headword
    expect(h.progress.find((p) => p.phase === 'running')).toMatchObject({
      currentHeadword: 'a',
      count: 3,
    });
    expect(h.progress.at(-1)).toMatchObject({ phase: 'idle', remaining: 0 });
  });

  it('offline stops the pass before any request; row untouched', async () => {
    const generate = vi.fn();
    const h = makeDeps(planned(), { isOnline: async () => false, generate });
    const r = await processBatch(h.deps);
    expect(r).toEqual({ outcome: 'stopped', reason: 'offline', processed: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(h.saves).toEqual([]);
    expect(h.row()!.pending).toHaveLength(3);
    expect(h.progress.at(-1)).toMatchObject({
      phase: 'paused',
      pauseReason: 'offline',
      remaining: 3,
    });
  });

  it('an offline error thrown mid-pass keeps the item pending and pauses', async () => {
    let calls = 0;
    const h = makeDeps(planned(), {
      generate: async () => {
        calls++;
        if (calls === 2) throw new AiError('offline', 'gone');
        return {};
      },
    });
    const r = await processBatch(h.deps);
    expect(r).toEqual({ outcome: 'stopped', reason: 'offline', processed: 1 });
    expect(h.row()!.pending.map((p) => p.bankItemId)).toEqual(['b', 'c']);
    expect(h.row()!.pending[0]!.attempts).toBe(0);
    expect(h.row()!.done).toBe(1);
  });

  it('no-key / http-auth stop the pass without judging the item', async () => {
    for (const code of ['no-key', 'http-auth'] as const) {
      const generate = vi.fn(async () => {
        throw new AiError(code, 'key', code === 'http-auth' ? 401 : undefined);
      });
      const h = makeDeps(planned(), { generate });
      const r = await processBatch(h.deps);
      expect(r).toEqual({ outcome: 'stopped', reason: code, processed: 0 });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(h.row()!.pending).toHaveLength(3);
      expect(h.row()!.failed).toEqual([]);
    }
  });

  it('invalid-response is terminal for the word: failed, no ladder, batch continues', async () => {
    const generate = vi.fn(async (item: BatchPendingItem) => {
      if (item.bankItemId === 'b') throw new AiError('invalid-response', 'twice');
      return { costUsd: 0.2 };
    });
    const h = makeDeps(planned(), { generate });
    const r = await processBatch(h.deps);
    expect(r).toEqual({ outcome: 'finished', reason: null, processed: 3 });
    expect(generate).toHaveBeenCalledTimes(3);
    // finished with a failure ⇒ the row stays for Retry
    expect(h.removed()).toBe(0);
    expect(h.row()).toMatchObject({ done: 2, pending: [], finishedAt: 2_000 });
    expect(h.row()!.failed).toEqual([
      { bankItemId: 'b', lemmaNorm: 'b', kind: 'word', headword: 'b', code: 'invalid-response' },
    ]);
    const finished = h.events.find((e) => e.event === 'profile_batch_finished')!;
    expect(finished.props).toMatchObject({ done: 2, failed: 1, costUsd: 0.4 });
    expect(h.progress.at(-1)).toMatchObject({ phase: 'idle', done: 2, failed: 1, remaining: 0 });
  });

  it('transport errors: 2-step ladder inside the pass, then attempts++ and the pass pauses', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const h = makeDeps(planned(), {
      generate: async () => {
        calls++;
        throw new AiError('http-server', '502', 502);
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      retryDelaysMs: [5, 9],
    });
    const r = await processBatch(h.deps);
    expect(r).toEqual({ outcome: 'stopped', reason: 'transport', processed: 0 });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([5, 9]);
    expect(h.row()!.pending[0]).toMatchObject({ bankItemId: 'a', attempts: 1 });
    expect(h.events.filter((e) => e.event === 'profile_batch_progress')).toHaveLength(0);
    expect(h.progress.at(-1)).toMatchObject({ phase: 'paused', pauseReason: 'transport' });
  });

  it('a transport retry that succeeds on the ladder stores the profile normally', async () => {
    let calls = 0;
    const h = makeDeps(planned([word('a')]), {
      generate: async () => {
        calls++;
        if (calls < 3) throw new AiError('timeout', 'slow');
        return { costUsd: 0.01 };
      },
    });
    expect(await processBatch(h.deps)).toEqual({ outcome: 'finished', reason: null, processed: 1 });
    expect(calls).toBe(3);
    expect(h.row()).toBeNull();
  });

  it('attempts cap across pumps: the third exhausted ladder fails the item', async () => {
    const s = planned([word('a'), word('b')]);
    s.pending[0]!.attempts = MAX_ATTEMPTS - 1;
    let calls = 0;
    const h = makeDeps(s, {
      generate: async (item) => {
        calls++;
        if (item.bankItemId === 'a') throw new AiError('network', 'down');
        return {};
      },
      retryDelaysMs: [],
    });
    const r = await processBatch(h.deps);
    // a fails at the cap (resolved) and the pass continues to b
    expect(r).toEqual({ outcome: 'finished', reason: null, processed: 2 });
    expect(calls).toBe(2);
    expect(h.row()!.failed).toEqual([
      { bankItemId: 'a', lemmaNorm: 'a', kind: 'word', headword: 'a', code: 'network' },
    ]);
    expect(h.row()!.done).toBe(1);
  });

  it('a vanished bank row counts as failed with code missing', async () => {
    const h = makeDeps(planned([word('a')]), { generate: async () => ({ missing: true }) });
    await processBatch(h.deps);
    expect(h.row()!.failed[0]).toMatchObject({ bankItemId: 'a', code: 'missing' });
  });

  it('cancel during a request wins: the finished profile is kept, the state is not resurrected', async () => {
    let cancelled = false;
    const h = makeDeps(planned(), {
      generate: async () => {
        // Cancel arrives while the first request is in flight.
        cancelled = true;
        await h.deps.remove();
        return { costUsd: 0.3 };
      },
      cancelRequested: () => cancelled,
    });
    const r = await processBatch(h.deps);
    expect(r).toEqual({ outcome: 'cancelled', reason: null, processed: 0 });
    expect(h.row()).toBeNull();
    expect(h.events.filter((e) => e.event === 'profile_batch_finished')).toEqual([]);
    expect(h.progress.at(-1)).toMatchObject({ phase: 'idle' });
  });

  it('cancel between items stops before the next request', async () => {
    let calls = 0;
    let cancelled = false;
    const h = makeDeps(planned(), {
      generate: async () => {
        calls++;
        cancelled = true;
        return {};
      },
      cancelRequested: () => cancelled,
    });
    const r = await processBatch(h.deps);
    expect(r).toEqual({ outcome: 'cancelled', reason: null, processed: 1 });
    expect(calls).toBe(1);
    expect(h.row()!.done).toBe(1); // the service's cancelBatch clears pending separately
  });

  it('a finished-with-failures row is a no-op until Retry re-queues it', async () => {
    const s: BatchState = {
      ...applyResult(planned([word('a')]), 'a', { type: 'failed', code: 'network' }),
      finishedAt: 1,
    };
    const generate = vi.fn();
    const h = makeDeps(s, { generate });
    expect(await processBatch(h.deps)).toEqual({ outcome: 'empty', reason: null, processed: 0 });
    expect(generate).not.toHaveBeenCalled();
    const again = makeDeps(retryFailed(s), { generate: vi.fn(async () => ({})) });
    expect(await processBatch(again.deps)).toEqual({
      outcome: 'finished',
      reason: null,
      processed: 1,
    });
    expect(again.row()).toBeNull();
  });

  it('progressOf reports the honesty invariant fields', () => {
    const s = applyResult(planned(), 'a', { type: 'done' });
    expect(progressOf(s, 'running', 'b')).toEqual({
      phase: 'running',
      done: 1,
      failed: 0,
      remaining: 2,
      count: 3,
      currentHeadword: 'b',
      pauseReason: null,
    });
  });
});
