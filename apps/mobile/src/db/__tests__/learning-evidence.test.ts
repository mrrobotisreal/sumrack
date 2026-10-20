import { CourseItemSchema, ExamSchema } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PRACTICE } from '@/features/learning-evidence/catalog';
import {
  PRACTICE_MODE,
  EXPOSURE_MODE,
  summarizeEvidence,
} from '@/features/learning-evidence/model';
import { createLearningEvidenceRepo } from '../repositories/learning-evidence';
import { createLearningSessionsRepo } from '../repositories/learning-sessions';
import {
  packs,
  courseItems,
  courseAttempts,
  exams,
  examAttempts,
  examResponses,
  cards,
  reviewLog,
  examItemCards,
} from '../schema';
import { createTestDb } from './helpers';
import { exportUserData } from '@/features/backup/export-core';
import { restoreUserData } from '@/features/backup/restore-core';

async function seeded() {
  const db = createTestDb();
  await db.insert(packs).values(
    ['a1-hotel-f03', 'a1-torfl-lexgram-001'].map((id) => ({
      id,
      version: 1,
      type: 'course' as const,
      titleRu: 'Тест',
      titleEn: 'Test',
      level: 'A1' as const,
      tags: [],
      importedAt: 1,
    })),
  );
  const item = CourseItemSchema.parse({
    id: 'u1-k01',
    topic: 'case-prep',
    kind: 'typed',
    prompt: 'Я в … (дом).',
    accept: ['доме'],
    explain:
      'The speaker is already inside the house, so the question is где? The preposition в takes the prepositional case here: доме. Дом would mark a destination after в.',
  });
  await db.insert(courseItems).values({
    packId: 'a1-hotel-f03',
    itemId: item.id,
    kind: item.kind,
    topic: item.topic,
    json: JSON.stringify(item),
  });
  await db.insert(courseAttempts).values({
    id: 'hotel-attempt',
    packId: 'a1-hotel-f03',
    unitId: 'u1',
    kind: 'unit',
    startedAt: 1,
    finishedAt: 2,
    percent: 0,
    passed: false,
    itemIds: JSON.stringify([item.id]),
    responsesJson: JSON.stringify({ [item.id]: { answer: 'дом', correct: false } }),
  });
  const exam = ExamSchema.parse(examPackJson.exams[0]);
  const examItem = exam.subtests[0]!.parts[0]!.items[0]!;
  examItem.id = 'lg-case-prep-01';
  examItem.topic = 'case-prep';
  const subtestId = exam.subtests[0]!.id;
  await db.insert(exams).values({
    packId: 'a1-torfl-lexgram-001',
    examId: exam.id,
    orderIdx: 0,
    format: exam.format,
    level: exam.level,
    mode: exam.mode,
    titleRu: 'Тест',
    titleEn: 'Test',
    json: JSON.stringify(exam),
  });
  await db.insert(examAttempts).values({
    id: 'exam-attempt',
    packId: 'a1-torfl-lexgram-001',
    examId: exam.id,
    scope: 'drill',
    mode: 'drill',
    status: 'finished',
    subtestIds: JSON.stringify([subtestId]),
    stateJson: '{}',
    startedAt: 3,
    finishedAt: 4,
  });
  await db.insert(examResponses).values({
    id: 'response',
    attemptId: 'exam-attempt',
    subtestId,
    itemId: examItem.id,
    answerJson: JSON.stringify({ kind: 'choice', index: 0 }),
    points: 0,
    maxPoints: 1,
    gradingStatus: 'scored',
    createdAt: 3,
    updatedAt: 4,
  });
  return { db, repo: createLearningEvidenceRepo(db) };
}

describe('learning evidence repository projection', () => {
  it('combines hotel/exam rows without fabricating provenance or mutating user/card history', async () => {
    const { db, repo } = await seeded();
    const before = [await db.select().from(courseAttempts), await db.select().from(examResponses)];
    const snapshot = await repo.read();
    expect(snapshot.events.map((e) => e.source)).toEqual(['hotel', 'exam']);
    expect(
      snapshot.events.every(
        (e) => e.historicalVersion === null && e.currentVersion === 1 && e.assistance === 'unknown',
      ),
    ).toBe(true);
    expect(summarizeEvidence(snapshot.events)[0]).toMatchObject({
      missedItems: 2,
      sources: ['hotel', 'exam'],
      freshUnaided: 0,
    });
    await repo.read();
    expect([await db.select().from(courseAttempts), await db.select().from(examResponses)]).toEqual(
      before,
    );
    expect(await db.select().from(cards)).toEqual([]);
    expect(await db.select().from(reviewLog)).toEqual([]);
    expect(await db.select().from(examItemCards)).toEqual([]);
  });
  it('unmaps replaced/removed content and corrupt responses while leaving history intact', async () => {
    const { db, repo } = await seeded();
    await db.update(packs).set({ version: 2 }).where(eq(packs.id, 'a1-hotel-f03'));
    expect((await repo.read()).events.map((e) => e.source)).toEqual(['exam']);
    await db.delete(packs).where(eq(packs.id, 'a1-torfl-lexgram-001'));
    expect((await repo.read()).events).toEqual([]);
    expect(await db.select().from(examResponses)).toHaveLength(1);
    await db.update(courseAttempts).set({ responsesJson: '{broken' });
    expect((await repo.read()).unmapped).toBeGreaterThan(0);
  });
  it('never converts an ASR discrepancy or held-out response into a confirmed grammar error', async () => {
    const { db, repo } = await seeded();
    await db.update(examResponses).set({
      answerJson: JSON.stringify({
        kind: 'speaking-reply',
        transcript: 'текст',
        recordingPath: null,
        durationMs: 100,
      }),
      gradingStatus: 'provisional',
    });
    const event = (await repo.read()).events.find((e) => e.source === 'exam');
    expect(event).toMatchObject({ grader: 'asr', result: 'uncertain' });
    await db.update(examAttempts).set({ examId: 'a1-torfl-mock-004' });
    expect((await repo.read()).events.some((e) => e.source === 'exam')).toBe(false);
  });
  it('round-trips completed practice and exposure through the existing JSON user store with idempotency', async () => {
    const db = createTestDb();
    const writer = createLearningSessionsRepo(db);
    const prompt = PRACTICE[0]!;
    const detail = {
      v: 1,
      skill: prompt.skill,
      promptId: prompt.id,
      context: prompt.context,
      catalogVersion: 1,
      answer: prompt.answer,
      correct: true,
      assistance: 'none',
      exposure: 'first',
      grader: 'exact-match-v1',
    };
    const row = {
      id: 'practice',
      mode: PRACTICE_MODE,
      startedAt: 10,
      endedAt: 20,
      itemCount: 1,
      correctCount: 1,
      detail,
    };
    await writer.recordCompleted(row);
    await writer.recordCompleted(row);
    await writer.recordCompleted({
      id: 'help',
      mode: EXPOSURE_MODE,
      startedAt: 5,
      endedAt: 5,
      itemCount: 0,
      correctCount: 0,
      detail: { v: 1, skill: prompt.skill, kind: 'help' },
    });
    const snapshot = await createLearningEvidenceRepo(db).read();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({
      source: 'practice',
      historicalVersion: 1,
      result: 'correct',
    });
    expect(snapshot.exposures).toHaveLength(1);
    expect((await writer.list(PRACTICE_MODE))[0]?.detail).toEqual(detail);
    expect(snapshot.events[0]?.assistance).toBe('help'); // persisted help overrides an inconsistent claimed unaided row
    await writer.recordCompleted({
      id: 'plan',
      mode: 'daily-plan-v1',
      startedAt: 30,
      endedAt: 30,
      itemCount: 0,
      correctCount: 0,
      detail: {
        v: 1,
        day: '2026-10-20',
        options: { minutes: 15, goal: 'reading', quiet: true },
        tasks: [],
      },
    });
    const exported = await exportUserData(db, { now: new Date(100) });
    const restored = createTestDb();
    await restoreUserData(restored, JSON.parse(JSON.stringify(exported.payload)));
    expect(await createLearningEvidenceRepo(restored).read()).toEqual(snapshot);
    expect((await createLearningSessionsRepo(restored).list('daily-plan-v1'))[0]?.detail).toEqual(
      (await writer.list('daily-plan-v1'))[0]?.detail,
    );
  });
  it('imports reading-form results as assisted practice and does not grade the own sentence', async () => {
    const db = createTestDb();
    const writer = createLearningSessionsRepo(db);
    await writer.recordCompleted({
      id: 'reading',
      mode: 'grammar-connection',
      startedAt: 1,
      endedAt: 2,
      itemCount: 1,
      correctCount: 1,
      detail: {
        version: 1,
        skillId: 'location-destination',
        taskId: 'gc-location-1',
        contextId: 'hotel-waiting',
        trigger: 'Где?',
        answer: 'коридоре',
        ownSentence: 'intentionally ungraded',
        helpCount: 1,
        exposure: 'first',
        grader: 'authored-key',
        productionGrader: 'self-review',
        correct: true,
      },
    });
    const snapshot = await createLearningEvidenceRepo(db).read();
    expect(snapshot.events[0]).toMatchObject({
      source: 'reading-practice',
      assistance: 'help',
      grader: 'authored-key',
    });
    expect(summarizeEvidence(snapshot.events)[0]?.freshUnaided).toBe(0);
  });
});
