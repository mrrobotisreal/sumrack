import { ExamSchema, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialAttemptState, type ExamAttemptState } from '@/features/torfl/model';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { ExamAttemptActiveError, ExamRating } from '../repositories/exams';
import { State } from '../repositories/reviews';
import { cards, examAttempts, examItemCards, examResponses, reviewLog } from '../schema';
import type { SumrakDB } from '../types';
import { createTestDb } from './helpers';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track: trackMock }));

/**
 * T68: `repos.exams` (TORFL §4.3) — every method on better-sqlite3 against
 * the real migrations: content reads, the single-active-attempt rule, the
 * response upsert, finish/abandon, topicStats math (incl. a removed item),
 * the grading queue, and the exam deck on the `reviews` FSRS scheduler.
 */

const PACK = examPackJson as unknown as Pack;
const PACK_ID = PACK.id;
const MOCK = 'a1-mock-fx';
const DRILL = 'a1-drill-fx';
const T0 = 1_790_000_000_000;
const MIN = 60_000;
const DAY = 86_400_000;

let db: SumrakDB;
let repos: ReturnType<typeof createRepositories>;

function mockState(): ExamAttemptState {
  const exam = ExamSchema.parse(PACK.exams!.find((e) => e.id === MOCK));
  return initialAttemptState(exam.subtests);
}

async function startMock(opts: { replace?: boolean; now?: number } = {}) {
  return repos.exams.startAttempt(
    {
      packId: PACK_ID,
      examId: MOCK,
      scope: 'full',
      subtestIds: ['writing', 'lexgram', 'reading', 'listening', 'speaking'],
      mode: 'mock',
      state: mockState(),
      now: opts.now ?? T0,
    },
    { replace: opts.replace },
  );
}

async function startDrill(now = T0) {
  return repos.exams.startAttempt({
    packId: PACK_ID,
    examId: DRILL,
    scope: 'drill',
    subtestIds: ['lexgram'],
    mode: 'drill',
    state: initialAttemptState([{ id: 'lexgram', kind: 'lexgram' }]),
    now,
  });
}

beforeEach(async () => {
  trackMock.mockClear();
  db = createTestDb();
  repos = createRepositories(db);
  await importPack(db, examPackJson);
});

describe('content reads', () => {
  it('listExams lists both fixture exams in order with parsed JSON; filters by pack and mode', async () => {
    const all = await repos.exams.listExams();
    expect(all.map((e) => [e.examId, e.mode, e.orderIdx])).toEqual([
      [DRILL, 'drill', 0],
      [MOCK, 'mock', 1],
    ]);
    expect(all.every((e) => e.exam !== null)).toBe(true);
    expect((await repos.exams.listExams({ mode: 'mock' })).map((e) => e.examId)).toEqual([MOCK]);
    expect(await repos.exams.listExams({ packId: 'nope' })).toEqual([]);
  });

  it('getExam returns the parsed Exam; null for a missing id; an unreadable row → null + one app_error', async () => {
    const exam = await repos.exams.getExam(PACK_ID, MOCK);
    expect(exam?.subtests).toHaveLength(5);
    expect(await repos.exams.getExam(PACK_ID, 'missing')).toBeNull();

    await db.run(sql`UPDATE exams SET json = '{"broken":' WHERE exam_id = ${DRILL}`);
    const fresh = createRepositories(db);
    expect(await fresh.exams.getExam(PACK_ID, DRILL)).toBeNull();
    expect(await fresh.exams.getExam(PACK_ID, DRILL)).toBeNull();
    const listed = await fresh.exams.listExams();
    expect(listed.find((e) => e.examId === DRILL)?.exam).toBeNull();
    expect(trackMock.mock.calls.filter((c) => c[0] === 'app_error')).toEqual([
      ['app_error', { scope: 'exam-parse', fatal: false }],
    ]);
  });
});

describe('attempt lifecycle', () => {
  it('startAttempt writes an active attempt with parsed subtests + state', async () => {
    const a = await startMock();
    expect(a).toMatchObject({
      packId: PACK_ID,
      examId: MOCK,
      scope: 'full',
      mode: 'mock',
      status: 'active',
      startedAt: T0,
      finishedAt: null,
      results: null,
      verdict: null,
      xpAwarded: 0,
      pinned: false,
    });
    expect(a.subtestIds).toEqual(['writing', 'lexgram', 'reading', 'listening', 'speaking']);
    expect(a.state?.subtests.map((s) => s.status)).toEqual(Array(5).fill('pending'));
    expect((await repos.exams.getActiveAttempt())?.id).toBe(a.id);
  });

  it('T70: drill attempts are exempt — never block, replace or shadow a mock', async () => {
    const mock = await startMock();
    const d1 = await startDrill(T0 + MIN);
    const d2 = await startDrill(T0 + 2 * MIN); // two drills at once is fine too
    expect((await repos.exams.getActiveAttempt())?.id).toBe(mock.id);
    expect((await repos.exams.getAttempt(mock.id))!.status).toBe('active');
    // a replacing mock start abandons the old MOCK only, never a drill
    await startMock({ replace: true, now: T0 + 3 * MIN });
    expect((await repos.exams.getAttempt(mock.id))!.status).toBe('abandoned');
    expect((await repos.exams.getAttempt(d1.id))!.status).toBe('active');
    // orphan sweep: drills only, mocks untouched
    expect(await repos.exams.abandonActiveDrills(T0 + 4 * MIN)).toBe(2);
    expect((await repos.exams.getAttempt(d2.id))!.status).toBe('abandoned');
    expect((await repos.exams.getActiveAttempt())?.status).toBe('active');
    // and a drill can still record responses while it is active
    const d3 = await startDrill(T0 + 5 * MIN);
    await expect(
      repos.exams.recordResponse({
        attemptId: d3.id,
        subtestId: 'lexgram',
        itemId: 'dr01',
        answer: { kind: 'choice', index: 0 },
        points: 1,
        maxPoints: 1,
        gradingStatus: 'scored',
      }),
    ).resolves.toBeTruthy();
  });

  it('single-active rule: a second start is refused; replace abandons the old one', async () => {
    const first = await startMock();
    await expect(startMock({ now: T0 + MIN })).rejects.toBeInstanceOf(ExamAttemptActiveError);
    await expect(startMock({ now: T0 + MIN })).rejects.toMatchObject({
      activeAttemptId: first.id,
    });
    expect(await repos.exams.listAttempts()).toHaveLength(1);

    const second = await startMock({ replace: true, now: T0 + 2 * MIN });
    const old = (await repos.exams.getAttempt(first.id))!;
    expect(old.status).toBe('abandoned');
    expect(old.finishedAt).toBe(T0 + 2 * MIN);
    expect((await repos.exams.getActiveAttempt())?.id).toBe(second.id);
    const active = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM exam_attempts WHERE status = 'active'`,
    );
    expect(active[0]!.n).toBe(1);
  });

  it('startAttempt validates subtestIds and state before writing', async () => {
    await expect(
      repos.exams.startAttempt({
        packId: PACK_ID,
        examId: MOCK,
        scope: 'full',
        subtestIds: [],
        mode: 'mock',
        state: mockState(),
      }),
    ).rejects.toThrow();
    await expect(
      repos.exams.startAttempt({
        packId: PACK_ID,
        examId: MOCK,
        scope: 'full',
        subtestIds: ['lexgram'],
        mode: 'mock',
        state: { v: 2 } as unknown as ExamAttemptState,
      }),
    ).rejects.toThrow();
    expect(await repos.exams.listAttempts()).toEqual([]);
  });

  it('saveState persists the state (unknown engine fields survive); refused on a finished attempt', async () => {
    const a = await startMock();
    const state = mockState();
    state.subtests[1]!.status = 'running';
    state.subtests[1]!.deadlineAt = T0 + 40 * MIN;
    state.current = 1;
    state.playCounts = { 'ls01:audio': 2 };
    const withExtra = { ...state, futureField: 7 } as ExamAttemptState;
    await repos.exams.saveState(a.id, withExtra);
    const read = (await repos.exams.getAttempt(a.id))!.state!;
    expect(read.current).toBe(1);
    expect(read.subtests[1]).toMatchObject({ status: 'running', deadlineAt: T0 + 40 * MIN });
    expect(read.playCounts).toEqual({ 'ls01:audio': 2 });
    expect((read as Record<string, unknown>).futureField).toBe(7);

    await repos.exams.finishAttempt(a.id, {}, null, 0, T0 + MIN);
    await expect(repos.exams.saveState(a.id, state)).rejects.toThrow(/not active/);
    await expect(repos.exams.saveState('nope', state)).rejects.toThrow(/does not exist/);
  });

  it('recordResponse upserts on (attempt, subtest, item): same id + createdAt, new answer', async () => {
    const a = await startMock();
    const r1 = await repos.exams.recordResponse({
      attemptId: a.id,
      subtestId: 'lexgram',
      itemId: 'lg01',
      answer: { kind: 'choice', index: 2 },
      points: 0,
      maxPoints: 1,
      gradingStatus: 'scored',
      durationMs: 9000,
      now: T0 + 1000,
    });
    const r2 = await repos.exams.recordResponse({
      attemptId: a.id,
      subtestId: 'lexgram',
      itemId: 'lg01',
      answer: { kind: 'choice', index: 1 },
      points: 1,
      maxPoints: 1,
      gradingStatus: 'scored',
      durationMs: 12000,
      now: T0 + 5000,
    });
    expect(r2.id).toBe(r1.id);
    expect(r2).toMatchObject({
      createdAt: T0 + 1000,
      updatedAt: T0 + 5000,
      points: 1,
      answer: { kind: 'choice', index: 1 },
      durationMs: 12000,
    });
    const detail = (await repos.exams.getAttempt(a.id))!;
    expect(detail.responses).toHaveLength(1);
    // Invalid answer shapes are refused before writing.
    await expect(
      repos.exams.recordResponse({
        attemptId: a.id,
        subtestId: 'lexgram',
        itemId: 'lg02',
        answer: { kind: 'choice' } as never,
        points: 0,
        maxPoints: 1,
        gradingStatus: 'scored',
      }),
    ).rejects.toThrow();
    expect((await repos.exams.getAttempt(a.id))!.responses).toHaveLength(1);
  });

  it('finishAttempt stores validated results + verdict + xp; finishing twice is refused', async () => {
    const a = await startMock();
    const results = {
      lexgram: {
        points: 4,
        maxPoints: 5,
        pct: 80,
        provisional: false,
        gradedBy: 'offline' as const,
      },
      writing: {
        points: 70,
        maxPoints: 100,
        pct: 70,
        provisional: true,
        gradedBy: 'offline' as const,
      },
    };
    const done = await repos.exams.finishAttempt(a.id, results, 'pass', 60.4, T0 + 3 * MIN);
    expect(done).toMatchObject({
      status: 'finished',
      finishedAt: T0 + 3 * MIN,
      verdict: 'pass',
      xpAwarded: 60,
      results,
    });
    expect(await repos.exams.getActiveAttempt()).toBeNull();
    await expect(repos.exams.finishAttempt(a.id, results, 'pass')).rejects.toThrow(/not active/);
    await expect(
      repos.exams.finishAttempt((await startDrill()).id, { x: { pct: 120 } } as never, null),
    ).rejects.toThrow();

    // AI upgrade path (T72): rewrite results on the finished attempt.
    await repos.exams.updateResults(
      a.id,
      { ...results, writing: { ...results.writing, provisional: false, gradedBy: 'ai' } },
      'pass',
    );
    expect((await repos.exams.getAttempt(a.id))!.results!.writing!.gradedBy).toBe('ai');
  });

  it('abandonAttempt closes the attempt and keeps its responses; refused when not active', async () => {
    const a = await startDrill();
    await repos.exams.recordResponse({
      attemptId: a.id,
      subtestId: 'lexgram',
      itemId: 'dr01',
      answer: { kind: 'choice', index: 0 },
      points: 1,
      maxPoints: 1,
      gradingStatus: 'scored',
    });
    await repos.exams.abandonAttempt(a.id, T0 + MIN);
    const read = (await repos.exams.getAttempt(a.id))!;
    expect(read).toMatchObject({ status: 'abandoned', finishedAt: T0 + MIN });
    expect(read.responses).toHaveLength(1);
    await expect(repos.exams.abandonAttempt(a.id)).rejects.toThrow(/not active/);
    // Responses cannot be added to a closed attempt.
    await expect(
      repos.exams.recordResponse({
        attemptId: a.id,
        subtestId: 'lexgram',
        itemId: 'dr02',
        answer: { kind: 'choice', index: 0 },
        points: 1,
        maxPoints: 1,
        gradingStatus: 'scored',
      }),
    ).rejects.toThrow(/not active/);
  });

  it('listAttempts: newest first, scope/status filters, limit; getAttempt null for missing', async () => {
    const d1 = await startDrill(T0);
    await repos.exams.abandonAttempt(d1.id, T0 + 1);
    const m1 = await startMock({ now: T0 + 10 });
    await repos.exams.finishAttempt(m1.id, {}, 'fail', 0, T0 + 20);
    const d2 = await startDrill(T0 + 30);

    expect((await repos.exams.listAttempts()).map((a) => a.id)).toEqual([d2.id, m1.id, d1.id]);
    expect((await repos.exams.listAttempts({ scope: 'drill' })).map((a) => a.id)).toEqual([
      d2.id,
      d1.id,
    ]);
    expect((await repos.exams.listAttempts({ status: 'finished' })).map((a) => a.id)).toEqual([
      m1.id,
    ]);
    expect(await repos.exams.listAttempts({ limit: 1 })).toHaveLength(1);
    expect(await repos.exams.getAttempt('missing')).toBeNull();
  });

  it('setPinned toggles the flag', async () => {
    const a = await startMock();
    await repos.exams.setPinned(a.id, true);
    expect((await repos.exams.getAttempt(a.id))!.pinned).toBe(true);
    await repos.exams.setPinned(a.id, false);
    expect((await repos.exams.getAttempt(a.id))!.pinned).toBe(false);
  });

  it('unreadable JSON columns read as null with one app_error per row (never a crash)', async () => {
    const a = await startMock();
    await db.run(sql`UPDATE exam_attempts SET state_json = 'nope' WHERE id = ${a.id}`);
    const fresh = createRepositories(db);
    expect((await fresh.exams.getAttempt(a.id))!.state).toBeNull();
    expect((await fresh.exams.getActiveAttempt())!.state).toBeNull();
    expect(trackMock.mock.calls.filter((c) => c[0] === 'app_error')).toEqual([
      ['app_error', { scope: 'exam-attempt-parse', fatal: false }],
    ]);
  });
});

describe('topicStats + grading queue', () => {
  async function seedStats() {
    const m = await startMock({ now: T0 });
    const rec = (
      subtestId: string,
      itemId: string,
      points: number | null,
      maxPoints: number,
      now: number,
      kind: 'choice' | 'writing' = 'choice',
      gradingStatus: 'scored' | 'pending-ai' = 'scored',
    ) =>
      repos.exams.recordResponse({
        attemptId: m.id,
        subtestId,
        itemId,
        answer: kind === 'choice' ? { kind, index: 0 } : { kind, text: 'Привет!' },
        points,
        maxPoints,
        gradingStatus,
        now,
      });
    await rec('lexgram', 'lg01', 1, 1, T0 + 1); // case-prep ✓
    await rec('lexgram', 'lg03', 0, 1, T0 + 2); // case-gen ✗
    await rec('reading', 'rd01', 4, 4, T0 + 3); // read-detail ✓
    await rec('reading', 'rd02', 0, 4, T0 + 4); // read-detail ✗
    await rec('listening', 'ls01', 5, 5, T0 + 5 * DAY); // listen-detail ✓ (late)
    // Writing is rubric-scored → never in topicStats, even with points.
    await rec('writing', 'wr01', 55, 100, T0 + 6, 'writing', 'pending-ai');
    await repos.exams.finishAttempt(m.id, {}, null, 0, T0 + 6 * DAY);

    const d = await startDrill(T0 + 7 * DAY);
    await repos.exams.recordResponse({
      attemptId: d.id,
      subtestId: 'lexgram',
      itemId: 'dr01',
      answer: { kind: 'choice', index: 1 },
      points: 1,
      maxPoints: 1,
      gradingStatus: 'scored',
      now: T0 + 7 * DAY,
    });
    // Typed half credit: answered, not "correct", half the points.
    await repos.exams.recordResponse({
      attemptId: d.id,
      subtestId: 'lexgram',
      itemId: 'dr06',
      answer: { kind: 'typed', text: 'в школа' },
      points: 0.5,
      maxPoints: 1,
      gradingStatus: 'scored',
      now: T0 + 7 * DAY + 1,
    });
    return { m, d };
  }

  it('aggregates answered / correct / points per topic over objective responses', async () => {
    await seedStats();
    expect(await repos.exams.topicStats()).toEqual([
      { topic: 'case-gen', answered: 1, correct: 0, points: 0, maxPoints: 1 },
      { topic: 'case-prep', answered: 3, correct: 2, points: 2.5, maxPoints: 3 },
      { topic: 'listen-detail', answered: 1, correct: 1, points: 5, maxPoints: 5 },
      { topic: 'read-detail', answered: 2, correct: 1, points: 4, maxPoints: 8 },
    ]);
  });

  it('filters by sinceMs, subtestKind and mode', async () => {
    await seedStats();
    expect((await repos.exams.topicStats({ sinceMs: T0 + 5 * DAY })).map((s) => s.topic)).toEqual([
      'case-prep',
      'listen-detail',
    ]);
    expect(await repos.exams.topicStats({ subtestKind: 'reading' })).toEqual([
      { topic: 'read-detail', answered: 2, correct: 1, points: 4, maxPoints: 8 },
    ]);
    expect(await repos.exams.topicStats({ mode: 'drill' })).toEqual([
      { topic: 'case-prep', answered: 2, correct: 1, points: 1.5, maxPoints: 2 },
    ]);
  });

  it('an item removed by a pack update falls back to its deck card topic, else is skipped (§12)', async () => {
    await seedStats();
    await repos.exams.ensureCard({
      packId: PACK_ID,
      examId: MOCK,
      itemId: 'lg03',
      subtestKind: 'lexgram',
      topic: 'case-gen',
    });
    // v2 of the pack removes lg03 (the card knows its topic) and rd02 (no card).
    const v2 = structuredClone(PACK);
    v2.version = 2;
    const mock = v2.exams!.find((e) => e.id === MOCK)!;
    const lex = mock.subtests.find((s) => s.kind === 'lexgram')!;
    lex.parts[0]!.items = lex.parts[0]!.items.filter((i) => i.id !== 'lg03');
    lex.maxPoints = 4;
    const rd = mock.subtests.find((s) => s.kind === 'reading')!;
    rd.parts[0]!.items = rd.parts[0]!.items.filter((i) => i.id !== 'rd02');
    rd.maxPoints = 8;
    expect((await importPack(db, v2)).action).toBe('updated');

    const stats = await repos.exams.topicStats();
    expect(stats.find((s) => s.topic === 'case-gen')).toMatchObject({ answered: 1, correct: 0 });
    expect(stats.find((s) => s.topic === 'read-detail')).toMatchObject({
      answered: 1,
      correct: 1,
      points: 4,
      maxPoints: 4,
    });
  });

  it('pendingGrading lists pending-ai responses oldest first with pack/exam; setGrading moves them out', async () => {
    const { m } = await seedStats();
    const queue = await repos.exams.pendingGrading();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      attemptId: m.id,
      itemId: 'wr01',
      gradingStatus: 'pending-ai',
      packId: PACK_ID,
      examId: MOCK,
      answer: { kind: 'writing', text: 'Привет!' },
    });
    const graded = await repos.exams.setGrading(queue[0]!.id, {
      points: 72,
      gradingStatus: 'scored',
      grading: {
        v: 1,
        ai: { criteria: [{ id: 'grammar', score: 18, max: 25 }], tips: ['Use the accusative.'] },
      },
      now: T0 + 10 * DAY,
    });
    expect(graded).toMatchObject({ points: 72, gradingStatus: 'scored', updatedAt: T0 + 10 * DAY });
    expect(graded!.grading!.ai!.criteria[0]!.score).toBe(18);
    expect(await repos.exams.pendingGrading()).toEqual([]);
    expect(await repos.exams.countResponsesByStatus(m.id)).toEqual({ scored: 6 });
    expect(
      await repos.exams.setGrading('missing', {
        points: 0,
        gradingStatus: 'scored',
        grading: null,
      }),
    ).toBeNull();
    await expect(
      repos.exams.setGrading(queue[0]!.id, {
        points: 0,
        gradingStatus: 'scored',
        grading: { v: 9 } as never,
      }),
    ).rejects.toThrow();
  });

  it('pendingGrading respects the limit and the oldest-first order', async () => {
    const m = await startMock();
    for (const [i, itemId] of ['sp01', 'sp02', 'sp03'].entries()) {
      await repos.exams.recordResponse({
        attemptId: m.id,
        subtestId: 'speaking',
        itemId,
        answer: {
          kind: 'speaking-reply',
          transcript: 'меня зовут митч',
          recordingPath: null,
          durationMs: 3000,
        },
        points: null,
        maxPoints: 1,
        gradingStatus: 'pending-ai',
        now: T0 + (3 - i) * 1000,
      });
    }
    expect((await repos.exams.pendingGrading({ limit: 2 })).map((r) => r.itemId)).toEqual([
      'sp03',
      'sp02',
    ]);
  });
});

describe('T74 — recordings prune + lazy restore on the rows', () => {
  async function speakingRows() {
    const m = await startMock();
    for (const [itemId, kind, path] of [
      ['sp01', 'speaking-reply', 't1-sp01.ogg'],
      ['sp02', 'speaking-situation', 't2-sp02.wav'],
      ['sp03', 'speaking-monologue', null],
    ] as const) {
      await repos.exams.recordResponse({
        attemptId: m.id,
        subtestId: 'speaking',
        itemId,
        answer: { kind, transcript: 'я живу в колорадо', recordingPath: path, durationMs: 4000 },
        points: 1,
        maxPoints: 1,
        gradingStatus: 'scored',
        now: T0,
      });
    }
    return m;
  }

  it('markRecordingsPruned nulls every recordingPath of the attempt; the rows stay', async () => {
    const m = await speakingRows();
    expect((await repos.exams.listAttemptsWithRecordings()).map((a) => a.id)).toEqual([m.id]);
    expect(await repos.exams.markRecordingsPruned([m.id])).toBe(2);
    expect(await repos.exams.listAttemptsWithRecordings()).toEqual([]);
    const detail = await repos.exams.getAttempt(m.id);
    expect(detail!.responses).toHaveLength(3);
    for (const r of detail!.responses) {
      expect(r.answer && 'recordingPath' in r.answer ? r.answer.recordingPath : null).toBeNull();
    }
  });

  it('restoreRecordingPaths re-points speaking answers by item from the bundle file names, preferring .ogg', async () => {
    const m = await speakingRows();
    await repos.exams.markRecordingsPruned([m.id]);
    const n = await repos.exams.restoreRecordingPaths(m.id, [
      't1-sp01.wav',
      't1-sp01.ogg',
      't2-sp02.wav',
      'notes.txt',
      't3-sp99.ogg',
    ]);
    expect(n).toBe(2);
    const byItem = new Map(
      (await repos.exams.getAttempt(m.id))!.responses.map((r) => [
        r.itemId,
        r.answer && 'recordingPath' in r.answer ? r.answer.recordingPath : null,
      ]),
    );
    expect(byItem.get('sp01')).toBe('t1-sp01.ogg');
    expect(byItem.get('sp02')).toBe('t2-sp02.wav');
    expect(byItem.get('sp03')).toBeNull();
    expect((await repos.exams.listAttemptsWithRecordings()).map((a) => a.id)).toEqual([m.id]);
  });

  it('setPinned flips the attempt pin both ways', async () => {
    const m = await startMock();
    expect(m.pinned).toBe(false);
    await repos.exams.setPinned(m.id, true);
    expect((await repos.exams.getAttemptsByIds([m.id]))[0]!.pinned).toBe(true);
    await repos.exams.setPinned(m.id, false);
    expect((await repos.exams.getAttemptsByIds([m.id]))[0]!.pinned).toBe(false);
  });
});

describe('the exam deck (FSRS, separate from cards/review_log)', () => {
  const KEY = `${PACK_ID}:${DRILL}:dr01`;
  const input = {
    packId: PACK_ID,
    examId: DRILL,
    itemId: 'dr01',
    subtestKind: 'lexgram',
    topic: 'case-prep',
  };

  it('ensureCard creates a New card due now and is idempotent; a mismatched itemKey is refused', async () => {
    const c = await repos.exams.ensureCard({ ...input, now: T0 });
    expect(c).toMatchObject({
      itemKey: KEY,
      due: T0,
      lastResult: null,
      suspended: false,
      fsrs: { state: State.New, reps: 0, due: T0 },
    });
    const again = await repos.exams.ensureCard({ ...input, topic: 'other', now: T0 + DAY });
    expect(again).toEqual(c);
    expect(await db.select().from(examItemCards)).toHaveLength(1);
    await expect(repos.exams.ensureCard({ ...input, itemKey: 'x:y:z' })).rejects.toThrow();
  });

  it('Again → Learning (wrong); Good after Good → Review (correct); due moves forward', async () => {
    await repos.exams.ensureCard({ ...input, now: T0 });
    const a = await repos.exams.gradeCard(KEY, ExamRating.Again, T0);
    expect(a.fsrs!.state).toBe(State.Learning);
    expect(a.lastResult).toBe('wrong');
    expect(a.due).toBeGreaterThan(T0);
    expect(a.due).toBeLessThan(T0 + 10 * MIN);

    // Fresh card: Good, then Good again once due → Review.
    const key2 = `${PACK_ID}:${DRILL}:dr02`;
    await repos.exams.ensureCard({ ...input, itemId: 'dr02', now: T0 });
    const g1 = await repos.exams.gradeCard(key2, ExamRating.Good, T0);
    expect(g1.fsrs!.state).toBe(State.Learning);
    const g2 = await repos.exams.gradeCard(key2, ExamRating.Good, g1.due);
    expect(g2.fsrs!.state).toBe(State.Review);
    expect(g2.lastResult).toBe('correct');
    expect(g2.fsrs!.reps).toBe(2);
    expect(g2.due).toBeGreaterThan(g1.due + DAY / 2);
    expect((await repos.exams.getCard(key2))!.fsrs).toEqual(g2.fsrs);

    await expect(repos.exams.gradeCard('missing', ExamRating.Good)).rejects.toThrow(/not found/);
  });

  it('never touches cards / review_log', async () => {
    await repos.exams.ensureCard({ ...input, now: T0 });
    await repos.exams.gradeCard(KEY, ExamRating.Good, T0);
    expect(await db.select().from(cards)).toEqual([]);
    expect(await db.select().from(reviewLog)).toEqual([]);
  });

  it('an unreadable fsrs payload heals to a fresh card on grade', async () => {
    await repos.exams.ensureCard({ ...input, now: T0 });
    await db.run(sql`UPDATE exam_item_cards SET fsrs_json = '{}' WHERE item_key = ${KEY}`);
    const fresh = createRepositories(db);
    expect((await fresh.exams.getCard(KEY))!.fsrs).toBeNull();
    const g = await fresh.exams.gradeCard(KEY, ExamRating.Good, T0);
    expect(g.fsrs!.reps).toBe(1);
  });

  it('dueItems / deckCounts / suspendCard: due ordering, filters, per-topic counts', async () => {
    const mk = (itemId: string, topic: string, subtestKind = 'lexgram', now = T0) =>
      repos.exams.ensureCard({ ...input, itemId, topic, subtestKind, now });
    await mk('dr01', 'case-prep', 'lexgram', T0 + 2);
    await mk('dr02', 'case-prep', 'lexgram', T0 + 1);
    await mk('dr03', 'case-gen');
    await mk('rd01', 'read-detail', 'reading');
    // dr03 graded Good twice → Review, due days out.
    const k3 = `${PACK_ID}:${DRILL}:dr03`;
    const g = await repos.exams.gradeCard(k3, ExamRating.Good, T0);
    await repos.exams.gradeCard(k3, ExamRating.Good, g.due);

    const now = T0 + 20 * MIN;
    expect((await repos.exams.dueItems({ now })).map((c) => c.itemId)).toEqual([
      'rd01',
      'dr02',
      'dr01',
    ]);
    expect(
      (await repos.exams.dueItems({ now, subtestKind: 'reading' })).map((c) => c.itemId),
    ).toEqual(['rd01']);
    expect(
      (await repos.exams.dueItems({ now, topic: 'case-prep', limit: 1 })).map((c) => c.itemId),
    ).toEqual(['dr02']);

    expect(await repos.exams.deckCounts(now)).toEqual({
      due: 3,
      total: 4,
      suspended: 0,
      byTopic: {
        'case-gen': { due: 0, total: 1 },
        'case-prep': { due: 2, total: 2 },
        'read-detail': { due: 1, total: 1 },
      },
    });

    await repos.exams.suspendCard(`${PACK_ID}:${DRILL}:dr01`);
    expect((await repos.exams.dueItems({ now })).map((c) => c.itemId)).toEqual(['rd01', 'dr02']);
    expect(await repos.exams.deckCounts(now)).toMatchObject({ due: 2, total: 3, suspended: 1 });
    await repos.exams.suspendCard(`${PACK_ID}:${DRILL}:dr01`, false);
    expect((await repos.exams.deckCounts(now)).due).toBe(3);
  });
});

describe('dev tooling', () => {
  it('deleteUserRowsForPack removes attempts (responses cascade) and cards of one pack only', async () => {
    const a = await startDrill();
    await repos.exams.recordResponse({
      attemptId: a.id,
      subtestId: 'lexgram',
      itemId: 'dr01',
      answer: { kind: 'choice', index: 0 },
      points: 1,
      maxPoints: 1,
      gradingStatus: 'scored',
    });
    await repos.exams.ensureCard({
      packId: PACK_ID,
      examId: DRILL,
      itemId: 'dr01',
      subtestKind: 'lexgram',
      topic: 'case-prep',
    });
    await repos.exams.ensureCard({
      packId: 'other-pack',
      examId: 'x',
      itemId: 'y',
      subtestKind: 'lexgram',
      topic: 'case-prep',
    });
    expect(await repos.exams.deleteUserRowsForPack(PACK_ID)).toEqual({ attempts: 1, cards: 1 });
    expect(await db.select().from(examAttempts)).toEqual([]);
    expect(await db.select().from(examResponses)).toEqual([]);
    expect((await db.select().from(examItemCards)).map((c) => c.packId)).toEqual(['other-pack']);
  });
});
