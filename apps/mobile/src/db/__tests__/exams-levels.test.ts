import { ExamSchema, type Pack } from '@sumrak/schema';
import a1ExamPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import a2ExamPackJson from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import a1PromptsPackJson from '@sumrak/schema/fixtures/packs/a1-torfl-prompts-fixture/pack.json';
import a2PromptsPackJson from '@sumrak/schema/fixtures/packs/a2-torfl-prompts-fixture/pack.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupTexts, type TextStoryLike } from '@/features/torfl/hub-model';
import { initialAttemptState, type ExamAttemptState } from '@/features/torfl/model';
import { promptsForLevel } from '@/features/torfl/answers/answers-model';
import { monologueTickets } from '@/features/torfl/speaking/tickets-model';

import { importPack, removePack } from '../importer';
import { createRepositories } from '../repositories';
import { ExamRating } from '../repositories/exams';
import { createTestDb } from './helpers';
import type { SumrakDB } from '../types';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track: trackMock }));

/**
 * T75 THE LEVEL RULE (ADR-0021): every level-taking repo read isolates A1
 * from A2 in BOTH directions, and an unscoped read still sees both. An
 * attempt / responses / deck card inherit their level from `exams.level`
 * through the LEFT JOIN on (pack_id, exam_id); prompts from `packs.level`.
 */

const A1_PACK = a1ExamPackJson as unknown as Pack;
const A2_PACK = a2ExamPackJson as unknown as Pack;
const A1_PACK_ID = A1_PACK.id;
const A2_PACK_ID = A2_PACK.id;
const A1_DRILL = 'a1-drill-fx';
const A1_MOCK = 'a1-mock-fx';
const A2_DRILL_TIME = 'a2-drill-fx-time';
const A2_MOCK = 'a2-mock-fx';
const T0 = 1_790_000_000_000;
const MIN = 60_000;
const DAY = 86_400_000;

let db: SumrakDB;
let repos: ReturnType<typeof createRepositories>;

function stateFor(pack: Pack, examId: string): ExamAttemptState {
  const exam = ExamSchema.parse(pack.exams!.find((e) => e.id === examId));
  return initialAttemptState(exam.subtests);
}

function startDrill(packId: string, examId: string, now = T0) {
  return repos.exams.startAttempt({
    packId,
    examId,
    scope: 'drill',
    subtestIds: ['lexgram'],
    mode: 'drill',
    state: initialAttemptState([{ id: 'lexgram', kind: 'lexgram' }]),
    now,
  });
}

function startMock(pack: Pack, packId: string, examId: string, now = T0) {
  return repos.exams.startAttempt({
    packId,
    examId,
    scope: 'full',
    subtestIds: ['writing', 'lexgram', 'reading', 'listening', 'speaking'],
    mode: 'mock',
    state: stateFor(pack, examId),
    now,
  });
}

const RESULTS = {
  lexgram: { points: 1, maxPoints: 1, pct: 100, provisional: false, gradedBy: 'offline' as const },
};

beforeEach(async () => {
  trackMock.mockClear();
  db = createTestDb();
  repos = createRepositories(db);
  await importPack(db, a1ExamPackJson);
  await importPack(db, a2ExamPackJson);
  await importPack(db, a1PromptsPackJson);
  await importPack(db, a2PromptsPackJson);
});

describe('listExams({ level })', () => {
  it('A1 lists only the A1 exams, A2 only the A2 ones, unscoped both', async () => {
    const a1 = (await repos.exams.listExams({ level: 'A1' })).map((e) => e.examId);
    const a2 = (await repos.exams.listExams({ level: 'A2' })).map((e) => e.examId);
    expect(a1.sort()).toEqual([A1_DRILL, A1_MOCK].sort());
    expect(a2.sort()).toEqual([A2_DRILL_TIME, 'a2-drill-fx-info', A2_MOCK].sort());
    expect((await repos.exams.listExams()).length).toBe(a1.length + a2.length);
  });

  it('combines with mode: A2 mock only, A1 drill only', async () => {
    expect(
      (await repos.exams.listExams({ level: 'A2', mode: 'mock' })).map((e) => e.examId),
    ).toEqual([A2_MOCK]);
    expect(
      (await repos.exams.listExams({ level: 'A1', mode: 'drill' })).map((e) => e.examId),
    ).toEqual([A1_DRILL]);
  });
});

describe('listAttempts({ level })', () => {
  it('each level sees only its own attempt; unscoped sees both', async () => {
    const a1 = await startDrill(A1_PACK_ID, A1_DRILL, T0);
    await repos.exams.finishAttempt(a1.id, RESULTS, null, 0, T0 + MIN);
    const a2 = await startDrill(A2_PACK_ID, A2_DRILL_TIME, T0 + 2 * MIN);
    await repos.exams.finishAttempt(a2.id, RESULTS, null, 0, T0 + 3 * MIN);

    const ids = async (level?: 'A1' | 'A2') =>
      (await repos.exams.listAttempts({ level, limit: 50 })).map((a) => a.id);
    expect(await ids('A1')).toEqual([a1.id]);
    expect(await ids('A2')).toEqual([a2.id]);
    expect((await ids()).sort()).toEqual([a1.id, a2.id].sort());
  });
});

describe('getActiveAttempt({ level })', () => {
  it('an active A2 mock is returned for A2 and not for A1; unscoped returns it', async () => {
    const mock = await startMock(A2_PACK, A2_PACK_ID, A2_MOCK);
    expect(await repos.exams.getActiveAttempt({ level: 'A1' })).toBeNull();
    expect((await repos.exams.getActiveAttempt({ level: 'A2' }))?.id).toBe(mock.id);
    expect((await repos.exams.getActiveAttempt())?.id).toBe(mock.id);
  });

  it('the single-active rule stays global: an A1 mock start is refused while the A2 mock is active', async () => {
    const mock = await startMock(A2_PACK, A2_PACK_ID, A2_MOCK);
    await expect(startMock(A1_PACK, A1_PACK_ID, A1_MOCK, T0 + MIN)).rejects.toMatchObject({
      activeAttemptId: mock.id,
    });
  });
});

describe('recentAccuracy / topicStats({ level })', () => {
  it('each level counts only its own scored responses', async () => {
    const a1 = await startDrill(A1_PACK_ID, A1_DRILL);
    await repos.exams.recordResponse({
      attemptId: a1.id,
      subtestId: 'lexgram',
      itemId: 'dr01',
      answer: { kind: 'choice', index: 0 },
      points: 1,
      maxPoints: 1,
      gradingStatus: 'scored',
    });
    const a2 = await startDrill(A2_PACK_ID, A2_DRILL_TIME, T0 + MIN);
    await repos.exams.recordResponse({
      attemptId: a2.id,
      subtestId: 'lexgram',
      itemId: 'dt01',
      answer: { kind: 'choice', index: 0 },
      points: 0,
      maxPoints: 1,
      gradingStatus: 'scored',
    });

    expect(await repos.exams.recentAccuracy({ level: 'A1' })).toEqual({
      lexgram: { answered: 1, correct: 1 },
    });
    expect(await repos.exams.recentAccuracy({ level: 'A2' })).toEqual({
      lexgram: { answered: 1, correct: 0 },
    });
    expect(await repos.exams.recentAccuracy()).toEqual({
      lexgram: { answered: 2, correct: 1 },
    });

    expect(await repos.exams.topicStats({ level: 'A1' })).toEqual([
      { topic: 'case-prep', answered: 1, correct: 1, points: 1, maxPoints: 1 },
    ]);
    expect(await repos.exams.topicStats({ level: 'A2' })).toEqual([
      { topic: 'case-time', answered: 1, correct: 0, points: 0, maxPoints: 1 },
    ]);
  });
});

describe('the exam deck per level', () => {
  it('dueItems and deckCounts split A1 from A2; countCardsInReview stays cross-level', async () => {
    const a1Key = {
      packId: A1_PACK_ID,
      examId: A1_DRILL,
      itemId: 'dr01',
      subtestKind: 'lexgram',
      topic: 'case-prep',
      now: T0,
    };
    const a2Key = {
      packId: A2_PACK_ID,
      examId: A2_DRILL_TIME,
      itemId: 'dt01',
      subtestKind: 'lexgram',
      topic: 'case-time',
      now: T0,
    };
    await repos.exams.ensureCard(a1Key);
    await repos.exams.ensureCard(a2Key);

    const now = T0 + MIN;
    expect((await repos.exams.dueItems({ now, level: 'A1' })).map((c) => c.packId)).toEqual([
      A1_PACK_ID,
    ]);
    expect((await repos.exams.dueItems({ now, level: 'A2' })).map((c) => c.packId)).toEqual([
      A2_PACK_ID,
    ]);
    expect((await repos.exams.dueItems({ now })).length).toBe(2);

    expect(await repos.exams.deckCounts(now, { level: 'A1' })).toMatchObject({ due: 1, total: 1 });
    expect(await repos.exams.deckCounts(now, { level: 'A2' })).toMatchObject({ due: 1, total: 1 });
    expect(await repos.exams.deckCounts(now)).toMatchObject({ due: 2, total: 2 });

    // Grade both cards Good twice → Review in both levels; the cleared count is cross-level.
    for (const k of [a1Key, a2Key]) {
      const key = `${k.packId}:${k.examId}:${k.itemId}`;
      const g1 = await repos.exams.gradeCard(key, ExamRating.Good, T0);
      await repos.exams.gradeCard(key, ExamRating.Good, g1.due);
    }
    expect(await repos.exams.countCardsInReview()).toBe(2);
  });
});

describe('orphans keep their level (THE LEVEL RULE fallback)', () => {
  it('after removing the A2 pack, its deck card and attempt still count as A2 and never leak into A1', async () => {
    const a1Card = await repos.exams.ensureCard({
      packId: A1_PACK_ID,
      examId: A1_DRILL,
      itemId: 'dr01',
      subtestKind: 'lexgram',
      topic: 'case-prep',
      now: T0,
    });
    await repos.exams.ensureCard({
      packId: A2_PACK_ID,
      examId: A2_DRILL_TIME,
      itemId: 'dt01',
      subtestKind: 'lexgram',
      topic: 'case-time',
      now: T0,
    });
    const a2Attempt = await startDrill(A2_PACK_ID, A2_DRILL_TIME, T0);
    await repos.exams.finishAttempt(a2Attempt.id, RESULTS, null, 0, T0 + MIN);

    await removePack(db, A2_PACK_ID);
    const fresh = createRepositories(db);
    const now = T0 + MIN;

    expect(await fresh.exams.listExams({ level: 'A2' })).toEqual([]);
    expect((await fresh.exams.dueItems({ now, level: 'A2' })).map((c) => c.packId)).toEqual([
      A2_PACK_ID,
    ]);
    expect((await fresh.exams.dueItems({ now, level: 'A1' })).map((c) => c.itemKey)).toEqual([
      a1Card.itemKey,
    ]);
    expect(await fresh.exams.deckCounts(now, { level: 'A2' })).toMatchObject({ due: 1, total: 1 });
    expect(await fresh.exams.deckCounts(now, { level: 'A1' })).toMatchObject({ due: 1, total: 1 });
    expect((await fresh.exams.listAttempts({ level: 'A2' })).map((a) => a.id)).toEqual([
      a2Attempt.id,
    ]);
    expect(await fresh.exams.listAttempts({ level: 'A1' })).toEqual([]);
  });
});

describe('journal prompts by pack level', () => {
  it('A1 gets the four A1 prompts, A2 the two A2 prompts, neither gets the other', async () => {
    const rows = await repos.content.listJournalPromptsWithPackLevel();
    const shaped = rows.map((r) => ({
      packId: r.prompt.packId,
      id: r.prompt.id,
      promptRu: r.prompt.promptRu,
      promptEn: r.prompt.promptEn,
      tags: r.prompt.tags ?? null,
      packLevel: r.packLevel,
    }));
    const a1 = promptsForLevel(shaped, 'A1').map((p) => p.packId);
    const a2 = promptsForLevel(shaped, 'A2').map((p) => p.packId);
    expect(a1).toHaveLength(4);
    expect(a1.every((id) => id === a1PromptsPackJson.id)).toBe(true);
    expect(a2).toHaveLength(2);
    expect(a2.every((id) => id === a2PromptsPackJson.id)).toBe(true);
  });
});

describe('texts per level', () => {
  it('A1 texts come only from the A1 exam pack, A2 texts only from the A2 pack', async () => {
    const stories: TextStoryLike[] = (await repos.content.listStories()).map((s) => ({
      packId: s.packId,
      id: s.id,
      orderIdx: s.orderIdx,
      titleRu: s.titleRu,
      titleEn: s.titleEn,
      sentenceCount: s.sentenceCount,
    }));
    const packsOf = (groups: ReturnType<typeof groupTexts>) =>
      new Set(groups.flatMap((g) => g.texts.map((t) => t.packId)));

    const a1 = groupTexts(await repos.exams.listExams({ level: 'A1' }), stories, new Set());
    const a2 = groupTexts(await repos.exams.listExams({ level: 'A2' }), stories, new Set());
    expect([...packsOf(a1)]).toEqual([A1_PACK_ID]);
    expect([...packsOf(a2)]).toEqual([A2_PACK_ID]);
  });
});

describe('monologue tickets per level', () => {
  it('A1 gets the two A1 monologues, A2 the single A2 monologue', async () => {
    const a1 = monologueTickets(await repos.exams.listExams({ level: 'A1' }));
    const a2 = monologueTickets(await repos.exams.listExams({ level: 'A2' }));
    expect(a1.map((t) => t.item.id).sort()).toEqual(['sp03', 'sp04']);
    expect(a2.map((t) => t.item.id)).toEqual(['sp05']);
  });
});

describe('removePack leaves the other level untouched', () => {
  it('removing the A1 pack leaves A2 listings unchanged', async () => {
    const before = (await repos.exams.listExams({ level: 'A2' })).map((e) => e.examId);
    await removePack(db, A1_PACK_ID);
    const fresh = createRepositories(db);
    expect((await fresh.exams.listExams({ level: 'A2' })).map((e) => e.examId)).toEqual(before);
    expect(await fresh.exams.listExams({ level: 'A1' })).toEqual([]);
  });
});
