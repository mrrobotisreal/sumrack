import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { drillEntriesFromExam } from '@/features/torfl/drill/drill-model';
import { createDrillRecorder } from '@/features/torfl/drill/drill-recorder';
import { initialAttemptState } from '@/features/torfl/model';
import { scoreChoice, scoreTyped } from '@/features/torfl/scoring';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { State } from '../repositories/reviews';
import type { SumrakDB } from '../types';
import { createTestDb } from './helpers';

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

/**
 * T70: the drill recorder against the real schema — every answer is one
 * `exam_responses` row + one `exam_item_cards` row graded by the pace rule;
 * drill attempts never block a mock; finish/abandon close attempts; the deck
 * and `cards`/`review_log` stay separate.
 */

const PACK = examPackJson as unknown as Pack;
const DRILL = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-drill-fx')) as Exam;
const MOCK = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx')) as Exam;
const T0 = 1_790_000_000_000;

let db: SumrakDB;
let repos: ReturnType<typeof createRepositories>;
const count = async (table: string) =>
  (await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)))[0]!.n;

beforeEach(async () => {
  db = createTestDb();
  repos = createRepositories(db);
  await importPack(db, examPackJson);
});

describe('createDrillRecorder', () => {
  it('one response + one card per answer; right-fast = Good, right-slow = Hard, wrong = Again; wrong is due now', async () => {
    const entries = drillEntriesFromExam(DRILL, PACK.id).entries;
    let clock = T0;
    const rec = createDrillRecorder(repos.exams, () => clock);
    const [e1, e2, e3] = entries as [(typeof entries)[0], (typeof entries)[0], (typeof entries)[0]];
    const choice = (e: typeof e1) => e.item as Extract<typeof e1.item, { kind: 'choice' }>;

    // fast + right → Good
    const r1 = await rec.answer(
      e1,
      { index: choice(e1).answer },
      scoreChoice(choice(e1), choice(e1).answer, 1),
      5000,
    );
    // slow (> 68 s) + right → Hard
    const r2 = await rec.answer(
      e2,
      { index: choice(e2).answer },
      scoreChoice(choice(e2), choice(e2).answer, 1),
      70_000,
    );
    // wrong → Again
    const wrongIdx = (choice(e3).answer + 1) % choice(e3).options.length;
    const r3 = await rec.answer(
      e3,
      { index: wrongIdx },
      scoreChoice(choice(e3), wrongIdx, 1),
      4000,
    );

    expect([r1.rating, r2.rating, r3.rating]).toEqual([3, 2, 1]);
    expect(r3.correct).toBe(false);
    expect(await count('exam_responses')).toBe(3);
    expect(await count('exam_item_cards')).toBe(3);
    expect(await count('exam_attempts')).toBe(1);
    // the deck never touches the review pipeline
    expect(await count('cards')).toBe(0);
    expect(await count('review_log')).toBe(0);

    const wrongCard = (await repos.exams.getCard(e3.itemKey))!;
    expect(wrongCard.lastResult).toBe('wrong');
    expect(wrongCard.fsrs!.state).toBe(State.Learning);
    // «wrong item's card due today»: Again schedules within minutes, so it is due by end of day
    expect(wrongCard.due - T0).toBeLessThan(86_400_000);
    expect((await repos.exams.getCard(e1.itemKey))!.lastResult).toBe('correct');
  });

  it('typed: half credit grades Hard and records points 0.5; the response stores the typed text', async () => {
    const entries = drillEntriesFromExam(DRILL, PACK.id).entries;
    const typedEntry = entries.find((e) => e.item.kind === 'typed')!;
    const rec = createDrillRecorder(repos.exams, () => T0);
    const score = scoreTyped(typedEntry.item as never, 'парк', 1);
    const out = await rec.answer(typedEntry, { text: 'парк' }, score, 3000);
    expect(out.rating).toBe(2);
    const detail = (await repos.exams.listAttempts({ scope: 'drill' }))[0]!;
    const full = (await repos.exams.getAttempt(detail.id))!;
    expect(full.responses[0]).toMatchObject({ points: 0.5, maxPoints: 1 });
    expect(full.responses[0]!.answer).toEqual({ kind: 'typed', text: 'парк' });
  });

  it('a drill never blocks (or is blocked by) an active mock attempt', async () => {
    await repos.exams.startAttempt({
      packId: PACK.id,
      examId: MOCK.id,
      scope: 'full',
      subtestIds: ['lexgram'],
      mode: 'mock',
      state: initialAttemptState([{ id: 'lexgram', kind: 'lexgram' }]),
      now: T0,
    });
    const e = drillEntriesFromExam(DRILL, PACK.id).entries[0]!;
    const rec = createDrillRecorder(repos.exams, () => T0 + 1000);
    await rec.answer(e, { index: 0 }, scoreChoice(e.item as never, 0, 1), 1000);
    await rec.finish();
    const active = await repos.exams.getActiveAttempt();
    expect(active?.mode).toBe('mock');
    expect(active?.status).toBe('active');
  });

  it('finish closes the attempt with a per-subtest result; abandon keeps responses; both idempotent', async () => {
    const entries = drillEntriesFromExam(DRILL, PACK.id).entries;
    const rec = createDrillRecorder(repos.exams, () => T0);
    await rec.answer(
      entries[0]!,
      { index: (entries[0]!.item as never as { answer: number }).answer },
      scoreChoice(
        entries[0]!.item as never,
        (entries[0]!.item as never as { answer: number }).answer,
        1,
      ),
      1000,
    );
    await rec.answer(entries[1]!, { index: 9 }, scoreChoice(entries[1]!.item as never, 9, 1), 1000);
    await rec.finish();
    await rec.finish();
    await rec.abandon();
    const attempt = (await repos.exams.listAttempts({ scope: 'drill' }))[0]!;
    expect(attempt.status).toBe('finished');
    expect(attempt.results!['lexgram']).toMatchObject({ points: 1, maxPoints: 2, pct: 50 });
    expect(await count('exam_responses')).toBe(2);

    const rec2 = createDrillRecorder(repos.exams, () => T0);
    await rec2.answer(
      entries[2]!,
      { index: 0 },
      scoreChoice(entries[2]!.item as never, 0, 1),
      1000,
    );
    await rec2.abandon();
    const abandoned = (await repos.exams.listAttempts({ scope: 'drill' })).find(
      (a) => a.status === 'abandoned',
    );
    expect(abandoned).toBeTruthy();
    expect(await count('exam_responses')).toBe(3);
  });

  it('re-answering the same item in one session keeps ONE response row and ONE card', async () => {
    const e = drillEntriesFromExam(DRILL, PACK.id).entries[0]!;
    const rec = createDrillRecorder(repos.exams, () => T0);
    await rec.answer(e, { index: 9 }, scoreChoice(e.item as never, 9, 1), 1000);
    await rec.answer(e, { index: 0 }, scoreChoice(e.item as never, 0, 1), 1000);
    expect(await count('exam_responses')).toBe(1);
    expect(await count('exam_item_cards')).toBe(1);
  });

  it('feeds topicStats, recentAccuracy and countCardsInReview', async () => {
    const entries = drillEntriesFromExam(DRILL, PACK.id).entries;
    let clock = T0;
    const rec = createDrillRecorder(repos.exams, () => clock++);
    const e0 = entries[0]!;
    await rec.answer(
      e0,
      { index: (e0.item as never as { answer: number }).answer },
      scoreChoice(e0.item as never, (e0.item as never as { answer: number }).answer, 1),
      1000,
    );
    await rec.answer(entries[1]!, { index: 9 }, scoreChoice(entries[1]!.item as never, 9, 1), 1000);
    expect(await repos.exams.topicStats({ mode: 'drill' })).toEqual([
      { topic: 'case-prep', answered: 2, correct: 1, points: 1, maxPoints: 2 },
    ]);
    expect(await repos.exams.recentAccuracy()).toEqual({ lexgram: { answered: 2, correct: 1 } });
    expect(await repos.exams.recentAccuracy({ limit: 1 })).toEqual({
      lexgram: { answered: 1, correct: 0 },
    });
    expect(await repos.exams.countCardsInReview()).toBe(0);
    // promote one card to the Review state through repeated Good grades
    for (let i = 0; i < 4; i++)
      await repos.exams.gradeCard(e0.itemKey, 3, T0 + (i + 1) * 3 * 86_400_000);
    expect(await repos.exams.countCardsInReview()).toBe(1);
    await repos.exams.suspendCard(e0.itemKey);
    expect(await repos.exams.countCardsInReview()).toBe(0);
  });
});
