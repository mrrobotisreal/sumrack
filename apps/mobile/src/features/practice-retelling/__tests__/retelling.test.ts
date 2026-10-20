import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '@/db/__tests__/helpers';
import { createLearningSessionsRepo } from '@/db/repositories/learning-sessions';
import { exportUserData } from '@/features/backup/export-core';
import { restoreUserData } from '@/features/backup/restore-core';
import { decryptBackupBytes, encryptBackupBytes } from '@/features/backup/crypto';
import { packMediaBundle, unpackMediaBundle } from '@/features/scenario/recordings/media-bundle';
import { FakeServer } from '@/features/account-sync/__tests__/fake-server';
import { makePhone } from '@/features/account-sync/__tests__/phones';
import { CASE_FILES } from '@/features/story-case-files/catalog';
import { AiError } from '@/features/ai/errors';
import { createPracticeStore } from '../store';
import { createPracticeMedia, validatePracticeBundle } from '../media-core';
import {
  assertConfirmedTranscript,
  confirmedTranscript,
  feedbackStatus,
  keptMedia,
  PRACTICE_QUOTA_BYTES,
  RUBRIC_VERSION,
  type FeedbackRequest,
  type FeedbackResult,
  type PracticeContext,
  type PracticeEvent,
  type PracticeTranscript,
} from '../model';
import {
  buildRetellingMessages,
  createRetellingQueue,
  parseRetellingResult,
} from '../feedback-core';
import { createPracticeAudioOwner } from '../audio-owner';

const context: PracticeContext = {
  kind: 'case-file',
  contextId: CASE_FILES[0]!.id,
  attemptId: 'attempt-1',
  stage: 'story',
  helped: false,
  repeated: false,
};
const request: FeedbackRequest = {
  v: 1,
  id: 'request-1',
  requestId: 'request-1',
  kind: 'feedback-request',
  at: 100,
  context,
  caseRevision: 1,
  packId: 'a1-no-end-house-001',
  packVersion: 3,
  ownerDeviceId: 'owner-a',
  input: 'Питер написал Дэвиду.',
  inputKind: 'typed',
  transcriptId: null,
  model: 'fixture-model',
  rubric: RUBRIC_VERSION,
  supersedes: null,
};
const completion = {
  model: 'fixture-model',
  content: JSON.stringify({
    facts: [{ comment: 'The message is supported by the excerpt.', evidenceIds: ['nea1p1-s16'] }],
    links: [],
    ownWords: 'You gave the central event in a short sentence.',
    grammar: [],
    nextStep: 'Add what David decided to do next.',
    assessmentBasis: 'text-only',
  }),
};
function memoryStore() {
  const events = new Map<string, PracticeEvent>();
  return {
    events,
    store: {
      async list() {
        return [...events.values()];
      },
      async append(e: PracticeEvent) {
        const old = events.get(e.id);
        if (old && JSON.stringify(old) !== JSON.stringify(e)) throw Error('immutable conflict');
        events.set(e.id, e);
      },
    },
  };
}
function filesFixture() {
  const data = new Map<string, Uint8Array>([
    ['cache', new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])],
  ]);
  let used = 0;
  return {
    data,
    setUsed: (n: number) => {
      used = n;
    },
    files: {
      async read(uri: string) {
        const bytes = data.get(uri);
        if (!bytes) throw Error('missing');
        return bytes;
      },
      async write(id: string, bytes: Uint8Array) {
        data.set(id, bytes.slice());
      },
      async remove(id: string) {
        data.delete(id);
      },
      async usedBytes() {
        return used;
      },
    },
  };
}

describe('explicit retained recordings', () => {
  it('keeps exact original once under concurrent taps, survives restart, and never deletes the cache source', async () => {
    const db = createTestDb(),
      store = createPracticeStore(createLearningSessionsRepo(db)),
      f = filesFixture(),
      media = createPracticeMedia(store, f.files);
    const input = {
      mediaId: 'practice-fixture-1',
      uri: 'cache',
      durationMs: 1000,
      context,
      at: 100,
    };
    const [a, b] = await Promise.all([media.keep(input), media.keep(input)]);
    expect(a).toEqual(b);
    expect((await store.list()).length).toBe(1);
    expect(f.data.get('cache')).toEqual(f.data.get(input.mediaId));
    expect(keptMedia(await createPracticeStore(createLearningSessionsRepo(db)).list())).toEqual([
      a,
    ]);
    expect(db.all(sql`SELECT * FROM cards`)).toEqual([]);
    expect(db.all(sql`SELECT * FROM review_log`)).toEqual([]);
  });
  it('enforces the storage cap before writing and rolls back a failed metadata save', async () => {
    const m = memoryStore(),
      f = filesFixture();
    f.setUsed(PRACTICE_QUOTA_BYTES);
    const media = createPracticeMedia(m.store, f.files),
      input = { mediaId: 'practice-fixture-1', uri: 'cache', durationMs: 1000, context, at: 100 };
    await expect(media.keep(input)).rejects.toThrow('limit');
    expect(f.data.has(input.mediaId)).toBe(false);
    expect(m.events.size).toBe(0);
    f.setUsed(0);
    const failing = createPracticeMedia(
      {
        ...m.store,
        append: async () => {
          throw Error('disk');
        },
      },
      f.files,
    );
    await expect(failing.keep(input)).rejects.toThrow('disk');
    expect(f.data.has(input.mediaId)).toBe(false);
    expect(f.data.has('cache')).toBe(true);
  });
  it('separates local eviction from deletion and refuses to resurrect a deleted take', async () => {
    const m = memoryStore(),
      f = filesFixture(),
      media = createPracticeMedia(m.store, f.files),
      input = { mediaId: 'practice-fixture-1', uri: 'cache', durationMs: 1000, context, at: 100 };
    const kept = await media.keep(input);
    await media.removeLocal(input.mediaId);
    expect(keptMedia(await m.store.list())).toEqual([kept]);
    await media.delete(input.mediaId, 200);
    await media.delete(input.mediaId, 300);
    expect(keptMedia(await m.store.list())).toEqual([]);
    await expect(media.keep(input)).rejects.toThrow('deleted');
    expect(f.data.has('cache')).toBe(true);
  });
  it('round-trips real SMB1 and encrypted backup bytes; checks restored bytes against immutable provenance', async () => {
    const m = memoryStore(),
      f = filesFixture(),
      media = createPracticeMedia(m.store, f.files);
    const kept = await media.keep({
      mediaId: 'practice-fixture-1',
      uri: 'cache',
      durationMs: 1000,
      context,
      at: 100,
    });
    const bytes = packMediaBundle(kept.mediaId, [
      { name: kept.file, data: f.data.get(kept.mediaId)! },
    ]);
    const key = new Uint8Array(32).fill(7);
    const envelope = encryptBackupBytes(bytes, key, {
      saltB64: 'AAAAAAAAAAAAAAAAAAAAAA==',
      iterations: 100000,
      iv: new Uint8Array(12).fill(3),
      createdAt: new Date(100),
      kind: 'media',
    });
    const restored = unpackMediaBundle(
      decryptBackupBytes(JSON.parse(JSON.stringify(envelope)), key),
    );
    validatePracticeBundle(kept, restored.files, 0);
    expect(restored.files[0]!.data).toEqual(f.data.get('cache'));
    expect(() => validatePracticeBundle(undefined, restored.files, 0)).toThrow('deleted');
    expect(() =>
      validatePracticeBundle(kept, [{ name: '../bad.wav', data: restored.files[0]!.data }], 0),
    ).toThrow('match');
    expect(() =>
      validatePracticeBundle(kept, [{ name: 'original.wav', data: new Uint8Array(8) }], 0),
    ).toThrow('match');
    expect(() => validatePracticeBundle(kept, restored.files, PRACTICE_QUOTA_BYTES)).toThrow(
      'limit',
    );
  });
  it('keeps media metadata, original transcript and corrected versions through backup/restore and existing sync', async () => {
    const server = new FakeServer(),
      a = await makePhone('fixture-A', 'a', server.client()),
      b = await makePhone('fixture-B', 'b', server.client());
    const store = createPracticeStore(a.repos.learningSessions),
      f = filesFixture(),
      media = createPracticeMedia(store, f.files);
    const kept = await media.keep({
      mediaId: 'practice-fixture-1',
      uri: 'cache',
      durationMs: 1000,
      context,
      at: 100,
    });
    const original: PracticeTranscript = {
      v: 1,
      id: 'asr-1',
      kind: 'transcript',
      at: 110,
      mediaId: kept.mediaId,
      text: 'Питер написал.',
      source: 'asr-original',
      originalId: null,
      model: 'fixture-asr',
    };
    const confirmed = confirmedTranscript(original, 'Питер написал Дэвиду.', 'confirmed-1', 120);
    await store.append(original);
    await store.append(confirmed);
    await store.append(request);
    await store.append(parseRetellingResult(request, completion, 150));
    const { payload } = await exportUserData(a.db);
    const restored = createTestDb();
    await restoreUserData(restored, JSON.parse(JSON.stringify(payload)));
    expect(await createPracticeStore(createLearningSessionsRepo(restored)).list()).toEqual(
      await store.list(),
    );
    await a.sync();
    await b.sync();
    expect(await createPracticeStore(b.repos.learningSessions).list()).toEqual(await store.list());
    expect(original.text).toBe('Питер написал.');
    expect(confirmed.originalId).toBe(original.id);
    expect(() => assertConfirmedTranscript([original], original.id)).toThrow('confirm');
    expect(assertConfirmedTranscript([original, confirmed], confirmed.id).text).toBe(
      'Питер написал Дэвиду.',
    );
  });
});

function queueFixture() {
  const m = memoryStore(),
    cache = new Map<string, FeedbackResult>();
  let time = 200;
  const deps = {
    store: m.store,
    ownerDeviceId: async () => 'owner-a',
    isOnline: async () => true,
    configured: async () => true,
    chat: vi.fn(async () => completion),
    readCached: async (id: string) => cache.get(id) ?? null,
    cache: async (r: FeedbackResult) => {
      cache.set(r.requestId, r);
    },
    clearCached: async (id: string) => {
      cache.delete(id);
    },
    now: () => time++,
    changed: vi.fn(),
  };
  return { m, cache, deps, queue: createRetellingQueue(deps) };
}
describe('optional feedback dispatch', () => {
  it('waits offline or without a key and coalesces concurrent pumps into exactly one paid call/result', async () => {
    const f = queueFixture();
    await f.m.store.append(request);
    f.deps.isOnline = async () => false;
    await f.queue.pump();
    expect(f.deps.chat).not.toHaveBeenCalled();
    f.deps.isOnline = async () => true;
    f.deps.configured = async () => false;
    await f.queue.pump();
    expect(f.deps.chat).not.toHaveBeenCalled();
    f.deps.configured = async () => true;
    await Promise.all([f.queue.pump(), f.queue.pump()]);
    await f.queue.pump();
    expect(f.deps.chat).toHaveBeenCalledTimes(1);
    expect(feedbackStatus(await f.m.store.list(), request.requestId)).toBe('done');
    expect((await f.m.store.list()).filter((e) => e.kind === 'feedback-result')).toHaveLength(1);
  });
  it('never dispatches another device’s requests or automatically resends an interrupted/failed send', async () => {
    const f = queueFixture();
    await f.m.store.append({ ...request, ownerDeviceId: 'other' });
    await f.queue.pump();
    expect(f.deps.chat).not.toHaveBeenCalled();
    f.m.events.set(request.id, request);
    f.deps.chat.mockRejectedValue(new AiError('network', 'connection lost'));
    await f.queue.pump();
    await f.queue.pump();
    await createRetellingQueue(f.deps).pump();
    expect(f.deps.chat).toHaveBeenCalledTimes(1);
    expect(feedbackStatus(await f.m.store.list(), request.requestId)).toBe('failed');
  });
  it('cancels queued work without a call, and ignores a late completion from a cancelled send', async () => {
    const first = queueFixture();
    await first.m.store.append(request);
    await first.queue.cancel(request.requestId);
    await first.queue.pump();
    expect(first.deps.chat).not.toHaveBeenCalled();
    const f = queueFixture();
    await f.m.store.append(request);
    let resolve!: (value: typeof completion) => void;
    f.deps.chat.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const running = f.queue.pump();
    await vi.waitFor(() => expect(f.deps.chat).toHaveBeenCalledTimes(1));
    await f.queue.cancel(request.requestId);
    resolve(completion);
    await running;
    expect(feedbackStatus(await f.m.store.list(), request.requestId)).toBe('cancelled');
    expect((await f.m.store.list()).some((e) => e.kind === 'feedback-result')).toBe(false);
  });
  it('retries saving a cached completion after restart without another network charge', async () => {
    const f = queueFixture();
    await f.m.store.append(request);
    await f.m.store.append({
      v: 1,
      id: 'request-1:started',
      kind: 'feedback-started',
      requestId: request.requestId,
      at: 101,
    });
    f.cache.set(request.requestId, parseRetellingResult(request, completion, 102));
    await createRetellingQueue(f.deps).pump();
    expect(f.deps.chat).not.toHaveBeenCalled();
    expect(feedbackStatus(await f.m.store.list(), request.requestId)).toBe('done');
    expect(f.cache.size).toBe(0);
  });
  it('preserves older feedback when the user explicitly requests a new review', async () => {
    const f = queueFixture();
    await f.m.store.append(request);
    await f.queue.pump();
    const first = (await f.m.store.list()).find((e) => e.kind === 'feedback-result');
    await f.m.store.append({
      ...request,
      id: 'request-2',
      requestId: 'request-2',
      at: 300,
      supersedes: request.requestId,
    });
    await f.queue.pump();
    expect(f.deps.chat).toHaveBeenCalledTimes(2);
    expect((await f.m.store.list()).filter((e) => e.kind === 'feedback-result')).toHaveLength(2);
    expect(f.m.events.get('request-1:result')).toEqual(first);
  });
  it('allows only the authored story/transfer evidence and rejects unsupported phonetics or invented corrections', () => {
    expect(buildRetellingMessages(request)[0]!.content).toContain('TEXT ONLY');
    expect(() =>
      buildRetellingMessages({
        ...request,
        context: { ...context, contextId: 'room-13-mock-004' },
      }),
    ).toThrow();
    expect(() =>
      buildRetellingMessages({ ...request, context: { ...context, kind: 'listening-lab' } }),
    ).toThrow();
    const transfer = buildRetellingMessages({
      ...request,
      context: { ...context, stage: 'transfer' },
    })[1]!.content;
    expect(transfer).toContain('t1-s1');
    expect(transfer).not.toContain('nea1p1');
    const raw = JSON.parse(completion.content);
    raw.ownWords = 'Your pronunciation is clear.';
    expect(() =>
      parseRetellingResult(request, { ...completion, content: JSON.stringify(raw) }, 200),
    ).toThrow('audio judgment');
    raw.ownWords = 'A short retelling.';
    raw.grammar = [{ original: 'not in input', suggestion: 'x', explanation: 'x' }];
    expect(() =>
      parseRetellingResult(request, { ...completion, content: JSON.stringify(raw) }, 200),
    ).toThrow('source response');
    raw.grammar = [];
    raw.facts[0].evidenceIds = ['held-out'];
    expect(() =>
      parseRetellingResult(request, { ...completion, content: JSON.stringify(raw) }, 200),
    ).toThrow('unavailable evidence');
  });
  it('stops the previous practice audio owner before another player or recorder proceeds', async () => {
    const owner = createPracticeAudioOwner(),
      a = Symbol(),
      b = Symbol(),
      stop = vi.fn(async () => {});
    await owner.claim(a, stop);
    await owner.claim(b, async () => {});
    expect(stop).toHaveBeenCalledTimes(1);
    owner.release(a);
    await owner.claim(b, async () => {});
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
