import { describe, expect, it, vi } from 'vitest';

import { AiError } from '../errors';
import {
  processFeedbackQueue,
  type EntryFeedbackState,
  type FeedbackQueueDeps,
} from '../queue-core';

const GOOD_COMPLETION = JSON.stringify({
  corrected: 'Я иду домой.',
  changes: [{ before: 'идти', after: 'иду', explanation: 'Conjugation.' }],
  summary: 'Nice.',
});

function makeDeps(overrides: Partial<FeedbackQueueDeps> = {}) {
  const saved: Record<string, string> = {};
  const phases: Record<string, (EntryFeedbackState | null)[]> = {};
  const deps: FeedbackQueueDeps = {
    listQueued: async () => [{ id: 'e1', ru: 'Я идти домой.' }],
    saveDone: async (id, json) => {
      saved[id] = json;
    },
    chat: async () => ({ content: GOOD_COMPLETION, model: 'test-model' }),
    isOnline: async () => true,
    sleep: async () => {},
    onPhase: (id, state) => {
      (phases[id] ??= []).push(state);
    },
    now: () => 123,
    retryDelaysMs: [1, 1],
    ...overrides,
  };
  return { deps, saved, phases };
}

describe('processFeedbackQueue', () => {
  it('sends a queued entry and persists the stored envelope', async () => {
    const { deps, saved, phases } = makeDeps();
    const done = await processFeedbackQueue(deps);
    expect(done).toBe(1);
    const stored = JSON.parse(saved.e1!);
    expect(stored).toMatchObject({
      v: 1,
      sourceRu: 'Я идти домой.',
      corrected: 'Я иду домой.',
      model: 'test-model',
      createdAt: 123,
    });
    // sending → cleared (null) once done
    expect(phases.e1).toEqual([{ phase: 'sending' }, null]);
  });

  it('does nothing quietly when the queue is empty', async () => {
    const chat = vi.fn();
    const { deps } = makeDeps({ listQueued: async () => [], chat });
    expect(await processFeedbackQueue(deps)).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it('offline: leaves rows queued without a single chat call', async () => {
    const chat = vi.fn();
    const { deps, phases, saved } = makeDeps({ isOnline: async () => false, chat });
    expect(await processFeedbackQueue(deps)).toBe(0);
    expect(chat).not.toHaveBeenCalled();
    expect(saved).toEqual({});
    expect(phases.e1).toEqual([{ phase: 'queued' }]);
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const { deps, saved } = makeDeps({
      chat: async () => {
        calls++;
        if (calls < 3) throw new AiError('http-server', 'boom', 500);
        return { content: GOOD_COMPLETION, model: 'test-model' };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      retryDelaysMs: [5, 9],
    });
    expect(await processFeedbackQueue(deps)).toBe(1);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([5, 9]);
    expect(saved.e1).toBeDefined();
  });

  it('exhausted retries → error phase, row still queued (never dropped)', async () => {
    const { deps, saved, phases } = makeDeps({
      chat: async () => {
        throw new AiError('timeout', 'slow');
      },
    });
    expect(await processFeedbackQueue(deps)).toBe(0);
    expect(saved).toEqual({});
    const last = phases.e1!.at(-1);
    expect(last).toMatchObject({ phase: 'error' });
    expect(last!.message).toBeTruthy();
  });

  it('non-retriable auth failure stops the pass for remaining entries', async () => {
    const chat = vi.fn(async () => {
      throw new AiError('http-auth', 'bad key', 401);
    });
    const { deps, phases } = makeDeps({
      listQueued: async () => [
        { id: 'e1', ru: 'раз' },
        { id: 'e2', ru: 'два' },
      ],
      chat,
    });
    expect(await processFeedbackQueue(deps)).toBe(0);
    expect(chat).toHaveBeenCalledTimes(1); // no retry, no second entry
    expect(phases.e1!.at(-1)).toMatchObject({ phase: 'error' });
    expect(phases.e2).toBeUndefined();
  });

  it('an unparseable completion is retried, then surfaces as error', async () => {
    let calls = 0;
    const { deps, phases } = makeDeps({
      chat: async () => {
        calls++;
        return { content: 'sorry, no JSON today', model: 'test-model' };
      },
      retryDelaysMs: [1],
    });
    expect(await processFeedbackQueue(deps)).toBe(0);
    expect(calls).toBe(2);
    expect(phases.e1!.at(-1)).toMatchObject({ phase: 'error' });
  });

  it('processes multiple queued entries in order', async () => {
    const order: string[] = [];
    const { deps, saved } = makeDeps({
      listQueued: async () => [
        { id: 'e1', ru: 'раз' },
        { id: 'e2', ru: 'два' },
      ],
      chat: async (req) => {
        order.push(req.messages.at(-1)!.content);
        return { content: GOOD_COMPLETION, model: 'm' };
      },
    });
    expect(await processFeedbackQueue(deps)).toBe(2);
    expect(Object.keys(saved)).toEqual(['e1', 'e2']);
    expect(order[0]).toContain('раз');
    expect(order[1]).toContain('два');
  });
});
