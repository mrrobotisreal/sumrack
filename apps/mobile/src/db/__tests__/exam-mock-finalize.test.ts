import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hydrate,
  initialRunState,
  reduce,
  toPersisted,
  type ExamEffect,
  type ExamRunState,
} from '@/features/torfl/engine/exam-machine';
import { finalizeAttempt } from '@/features/torfl/engine/finalize';
import { mockSubtestIds, startMockAttempt } from '@/features/torfl/engine/start';
import type { ExamAnswer } from '@/features/torfl/model';
import { scoreItem } from '@/features/torfl/scoring';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { ExamAttemptActiveError } from '../repositories/exams';
import type { SumrakDB } from '../types';
import { createTestDb } from './helpers';

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

/**
 * T71: the mock lifecycle on the real schema — start (single-active rule),
 * immediate response persistence, a kill → hydrate round trip, finalize
 * (scored-only results, no verdict for three subtests, deck entries ONLY
 * after the attempt is finished), and the recorded interrupted-play state.
 */

const PACK = examPackJson as unknown as Pack;
const EXAM = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx')) as Exam;
const PACK_ID = PACK.id;
const T0 = 1_790_000_000_000;
const MIN = 60_000;

let db: SumrakDB;
let repos: ReturnType<typeof createRepositories>;
const count = async (table: string, where = '1=1') =>
  (await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)))[0]!.n;

beforeEach(async () => {
  db = createTestDb();
  repos = createRepositories(db);
  await importPack(db, examPackJson);
});

/** Drive the reducer + perform the persistence effects the executor performs. */
async function perform(attemptId: string, state: ExamRunState, effects: ExamEffect[]) {
  for (const e of effects) {
    if (e.type === 'PERSIST_RESPONSE') {
      const subtest = EXAM.subtests.find((s) => s.id === e.subtestId)!;
      const item = subtest.parts.flatMap((p) => p.items).find((i) => i.id === e.itemId)!;
      const score = scoreItem(
        item,
        e.answer.kind === 'choice' ? { index: e.answer.index } : { text: '' },
        subtest,
      );
      await repos.exams.recordResponse({
        attemptId,
        subtestId: e.subtestId,
        itemId: e.itemId,
        answer: e.answer,
        points: null,
        maxPoints: score?.maxPoints ?? 1,
        gradingStatus: 'scored',
      });
    }
    if (e.type === 'PERSIST_STATE') await repos.exams.saveState(attemptId, toPersisted(state));
  }
}

describe('startMockAttempt', () => {
  it('scope plans: full = exam order, subtest = just that one', () => {
    expect(mockSubtestIds(EXAM, { scope: 'full' })).toEqual([
      'writing',
      'lexgram',
      'reading',
      'listening',
      'speaking',
    ]);
    expect(mockSubtestIds(EXAM, { scope: 'subtest', subtestId: 'reading' })).toEqual(['reading']);
  });

  it('a second start throws ExamAttemptActiveError; replace abandons the old attempt', async () => {
    const a = await startMockAttempt(repos.exams, EXAM, PACK_ID, { scope: 'full' }, { now: T0 });
    await expect(
      startMockAttempt(repos.exams, EXAM, PACK_ID, { scope: 'full' }),
    ).rejects.toBeInstanceOf(ExamAttemptActiveError);
    const b = await startMockAttempt(
      repos.exams,
      EXAM,
      PACK_ID,
      { scope: 'subtest', subtestId: 'lexgram' },
      { replace: true, now: T0 + 1 },
    );
    expect((await repos.exams.getAttempt(a.id))!.status).toBe('abandoned');
    expect((await repos.exams.getActiveAttempt())!.id).toBe(b.id);
  });
});

describe('a mock run end to end', () => {
  it('kill mid-subtest → hydrate → same remaining time; answers survive; finalize writes results; the deck only after finish', async () => {
    const attempt = await startMockAttempt(
      repos.exams,
      EXAM,
      PACK_ID,
      { scope: 'subtest', subtestId: 'lexgram' },
      { now: T0 },
    );
    const ctx = { exam: EXAM, breakBetween: false };
    let state = initialRunState(EXAM, ['lexgram']);
    const send = async (event: Parameters<typeof reduce>[2]) => {
      const t = reduce(ctx, state, event);
      state = t.state;
      await perform(attempt.id, state, t.effects);
      return t.effects;
    };
    await send({ type: 'START', now: T0 });
    await send({ type: 'BEGIN', now: T0 + 1000 });
    const lex = EXAM.subtests.find((s) => s.id === 'lexgram')!;
    const items = lex.parts.flatMap((p) => p.items);
    // answer lg01 right, lg02 wrong; leave the rest blank
    const right = (id: string) => {
      const it = items.find((i) => i.id === id)!;
      return it.kind === 'choice' ? it.answer : 0;
    };
    await send({
      type: 'ANSWER',
      itemId: 'lg01',
      answer: { kind: 'choice', index: right('lg01') },
      now: T0 + 2000,
    });
    await send({
      type: 'ANSWER',
      itemId: 'lg02',
      answer: { kind: 'choice', index: (right('lg02') + 1) % 3 },
      now: T0 + 3000,
    });
    await send({ type: 'FLAG', itemId: 'lg03' });
    await send({ type: 'GOTO', flat: 3 });

    // ---- the app is killed here; nothing in memory survives ----
    const stored = await repos.exams.getActiveAttempt();
    expect(stored).not.toBeNull();
    const detail = (await repos.exams.getAttempt(stored!.id))!;
    const answers: Record<string, ExamAnswer> = {};
    for (const r of detail.responses) if (r.answer) answers[r.itemId] = r.answer;
    expect(Object.keys(answers).sort()).toEqual(['lg01', 'lg02']);
    const revived = hydrate(EXAM, stored!.state!, answers);
    expect(revived.phase).toBe('running');
    expect(revived.subtests[0]!.flat).toBe(3);
    expect(revived.flagged).toEqual(['lg03']);
    const back = T0 + 10 * MIN;
    expect(revived.subtests[0]!.deadlineAt! - back).toBe(40 * MIN + 1000 - 10 * MIN);
    state = reduce(ctx, revived, { type: 'RESUME', now: back }).state;

    // no deck entry and no results while the attempt is active (no spoilers)
    expect(await count('exam_item_cards')).toBe(0);
    expect((await repos.exams.getAttempt(attempt.id))!.results).toBeNull();

    await send({ type: 'SUBMIT_SUBTEST', now: back });
    const out = await finalizeAttempt(
      {
        exams: repos.exams,
        rewards: async () => ({ xp: 15 }),
        now: back + 1,
      },
      {
        attemptId: attempt.id,
        packId: PACK_ID,
        examId: EXAM.id,
        scope: 'subtest',
        exam: EXAM,
        state,
        answers: state.answers,
      },
    );
    expect(out.results.lexgram).toMatchObject({ points: 1, maxPoints: 5, pct: 20 });
    expect(out.verdict).toBeNull();
    expect(out.xp).toBe(15);
    expect(out.deckAdded).toBe(4);
    const done = (await repos.exams.getAttempt(attempt.id))!;
    expect(done.status).toBe('finished');
    expect(done.xpAwarded).toBe(15);
    expect(await count('exam_item_cards', "last_result = 'wrong'")).toBe(4);
    expect(await count('exam_item_cards', "item_id = 'lg01'")).toBe(0);
    // the deck is separate from the word-bank cards
    expect(await count('cards')).toBe(0);
    expect(await count('review_log')).toBe(0);
  });

  it('a deadline that passed while closed auto-submits on resume with the answers as they were', async () => {
    const attempt = await startMockAttempt(
      repos.exams,
      EXAM,
      PACK_ID,
      { scope: 'subtest', subtestId: 'reading' },
      { now: T0 },
    );
    const ctx = { exam: EXAM, breakBetween: false };
    let state = initialRunState(EXAM, ['reading']);
    const effects: ExamEffect[] = [];
    for (const ev of [
      { type: 'START', now: T0 },
      { type: 'BEGIN', now: T0 },
      { type: 'ANSWER', itemId: 'rd01', answer: { kind: 'choice', index: 0 }, now: T0 + 5 },
    ] as const) {
      const t = reduce(ctx, state, ev);
      state = t.state;
      effects.push(...t.effects);
    }
    await perform(attempt.id, state, effects);
    const stored = (await repos.exams.getActiveAttempt())!;
    const detail = (await repos.exams.getAttempt(stored.id))!;
    const revived = hydrate(EXAM, stored.state!, { rd01: detail.responses[0]!.answer! });
    const t = reduce(ctx, revived, { type: 'RESUME', now: T0 + 3 * 60 * MIN });
    expect(t.effects.find((e) => e.type === 'SCORE_SUBTEST')).toMatchObject({
      autoSubmitted: true,
      answered: 1,
      total: 3,
    });
    expect(t.state.subtests[0]!.autoSubmitted).toBe(true);
  });

  it('a full mock with the placeholders skipped finishes with three results and a null verdict', async () => {
    const attempt = await startMockAttempt(
      repos.exams,
      EXAM,
      PACK_ID,
      { scope: 'full' },
      { now: T0 },
    );
    const ctx = { exam: EXAM, breakBetween: false };
    let state = initialRunState(
      EXAM,
      EXAM.subtests.map((s) => s.id),
    );
    const step = (e: Parameters<typeof reduce>[2]) => {
      state = reduce(ctx, state, e).state;
    };
    step({ type: 'START', now: T0 });
    step({ type: 'SUBMIT_SUBTEST', now: T0 });
    for (let i = 0; i < 3; i++) {
      step({ type: 'BEGIN', now: T0 });
      step({ type: 'SUBMIT_SUBTEST', now: T0 + 1000 });
    }
    step({ type: 'SUBMIT_SUBTEST', now: T0 });
    expect(state.phase).toBe('done');
    const out = await finalizeAttempt(
      { exams: repos.exams, rewards: async () => ({ xp: 105 }), now: T0 + 5 },
      {
        attemptId: attempt.id,
        packId: PACK_ID,
        examId: EXAM.id,
        scope: 'full',
        exam: EXAM,
        state,
        answers: {},
      },
    );
    expect(Object.keys(out.results).sort()).toEqual(['lexgram', 'listening', 'reading']);
    expect(out.verdict).toBeNull();
    expect(out.finish.verdict?.missing).toEqual(['writing', 'speaking']);
    // every item blank → every objective item is a miss
    expect(out.deckAdded).toBe(5 + 3 + 3);
  });
});
