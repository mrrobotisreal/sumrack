import { ExamSchema, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import a2ExamPackJson from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { importPack, removePack } from '../importer';
import {
  examAttempts,
  examItemCards,
  examResponses,
  exams,
  packs,
  sentences,
  stories,
  syncState,
} from '../schema';
import { createTestDb } from './helpers';

/**
 * T68: exam pack import (TORFL §4.1) — one `exams` row per exam with the
 * whole validated Exam as JSON; stories through the ordinary story path;
 * re-import (version bump) replaces; removal cascades content only; the
 * three exam user tables are never touched by import.
 */

const PACK = examPackJson as unknown as Pack;

function bumped(version: number, mutate?: (p: Pack) => void): Pack {
  const clone = structuredClone(PACK);
  clone.version = version;
  mutate?.(clone);
  return clone;
}

async function seedUserRows(db: ReturnType<typeof createTestDb>) {
  await db.insert(examAttempts).values({
    id: 'att-1',
    packId: PACK.id,
    examId: 'a1-mock-fx',
    scope: 'full',
    subtestIds: '["lexgram"]',
    mode: 'mock',
    status: 'finished',
    stateJson: '{}',
    startedAt: 1,
    finishedAt: 2,
  });
  await db.insert(examResponses).values({
    id: 'r-1',
    attemptId: 'att-1',
    subtestId: 'lexgram',
    itemId: 'lg01',
    answerJson: '{"kind":"choice","index":1}',
    points: 1,
    maxPoints: 1,
    gradingStatus: 'scored',
    createdAt: 2,
    updatedAt: 2,
  });
  await db.insert(examItemCards).values({
    itemKey: `${PACK.id}:a1-mock-fx:lg01`,
    packId: PACK.id,
    examId: 'a1-mock-fx',
    itemId: 'lg01',
    subtestKind: 'lexgram',
    topic: 'case-prep',
    fsrsJson: '{}',
    due: 3,
    createdAt: 2,
    updatedAt: 2,
  });
}

async function userCounts(db: ReturnType<typeof createTestDb>) {
  return {
    attempts: (await db.select().from(examAttempts)).length,
    responses: (await db.select().from(examResponses)).length,
    cards: (await db.select().from(examItemCards)).length,
  };
}

describe('exam pack import (T68)', () => {
  it('writes one exams row per exam; JSON round-trips through ExamSchema.parse', async () => {
    const db = createTestDb();
    const result = await importPack(db, examPackJson);
    expect(result.action).toBe('installed');
    expect(result.counts).toMatchObject({ stories: 2, exams: 2, scenarios: 0, dialogues: 0 });

    const rows = await db
      .select()
      .from(exams)
      .where(eq(exams.packId, PACK.id))
      .orderBy(asc(exams.orderIdx));
    expect(rows.map((r) => [r.examId, r.orderIdx, r.mode, r.format, r.level])).toEqual([
      ['a1-drill-fx', 0, 'drill', 'torfl', 'A1'],
      ['a1-mock-fx', 1, 'mock', 'torfl', 'A1'],
    ]);
    expect(rows[1]!.titleRu).toBe('Вариант ФХ');
    expect(rows[0]!.titleEn).toBe('Cases: prepositional');
    for (const [i, row] of rows.entries()) {
      const parsed = ExamSchema.parse(JSON.parse(row.json));
      expect(parsed).toEqual(ExamSchema.parse(PACK.exams![i]));
    }
    // Mock: five subtests in official order, 16 items; drill: 6 items.
    const mock = ExamSchema.parse(JSON.parse(rows[1]!.json));
    expect(mock.subtests.map((s) => s.kind)).toEqual([
      'writing',
      'lexgram',
      'reading',
      'listening',
      'speaking',
    ]);
    const count = (e: typeof mock) =>
      e.subtests.reduce((n, s) => n + s.parts.reduce((m, p) => m + p.items.length, 0), 0);
    expect(count(mock)).toBe(16);
    expect(count(ExamSchema.parse(JSON.parse(rows[0]!.json)))).toBe(6);

    // The two passages/scripts are ordinary stories of the pack.
    const storyRows = await db.select().from(stories).where(eq(stories.packId, PACK.id));
    expect(storyRows.map((s) => s.id).sort()).toEqual(['ls-01', 'rd-01']);
    expect((await db.select().from(sentences).where(eq(sentences.packId, PACK.id))).length).toBe(
      11,
    );
    const pack = (await db.select().from(packs).where(eq(packs.id, PACK.id)))[0]!;
    expect(pack.type).toBe('exam');
    expect(pack.category).toBe('torfl');
  });

  it('same version is a no-op; a version bump replaces the exams rows; user tables untouched', async () => {
    const db = createTestDb();
    await importPack(db, examPackJson);
    await seedUserRows(db);
    const before = await userCounts(db);

    expect((await importPack(db, examPackJson)).action).toBe('unchanged');
    expect((await db.select().from(exams)).length).toBe(2);

    // v2 drops the drill and retitles the mock.
    const v2 = bumped(2, (p) => {
      p.exams = p.exams!.filter((e) => e.id === 'a1-mock-fx');
      p.exams[0]!.title = { ru: 'Вариант ФХ-2', en: 'Fixture mock 2' };
    });
    const res = await importPack(db, v2);
    expect(res.action).toBe('updated');
    expect(res.counts.exams).toBe(1);
    const rows = await db.select().from(exams);
    expect(rows.map((r) => [r.examId, r.titleRu])).toEqual([['a1-mock-fx', 'Вариант ФХ-2']]);
    expect(await userCounts(db)).toEqual(before);
    expect((await db.select().from(syncState))[0]).toMatchObject({ packId: PACK.id, version: 2 });
  });

  it('removePack cascades the exams rows and leaves attempts/responses/cards intact', async () => {
    const db = createTestDb();
    await importPack(db, examPackJson);
    await seedUserRows(db);
    await removePack(db, PACK.id);
    expect(await db.select().from(exams)).toEqual([]);
    expect(await db.select().from(stories).where(eq(stories.packId, PACK.id))).toEqual([]);
    expect(await userCounts(db)).toEqual({ attempts: 1, responses: 1, cards: 1 });
  });

  it('T75: the A2 fixture imports — exams rows carry level A2; both fixtures coexist', async () => {
    const db = createTestDb();
    await importPack(db, examPackJson);
    const a2 = await importPack(db, a2ExamPackJson);
    expect(a2.action).toBe('installed');

    const a1Rows = await db
      .select()
      .from(exams)
      .where(eq(exams.packId, PACK.id))
      .orderBy(asc(exams.orderIdx));
    const a2Rows = await db
      .select()
      .from(exams)
      .where(eq(exams.packId, (a2ExamPackJson as unknown as Pack).id))
      .orderBy(asc(exams.orderIdx));
    expect(a1Rows.map((r) => r.level)).toEqual(['A1', 'A1']);
    expect(a2Rows.map((r) => r.level)).toEqual(['A2', 'A2', 'A2']);
    expect(a2Rows.map((r) => r.examId)).toEqual([
      'a2-drill-fx-time',
      'a2-drill-fx-info',
      'a2-mock-fx',
    ]);

    const packRows = await db.select().from(packs);
    const byId = Object.fromEntries(packRows.map((p) => [p.id, p.category]));
    expect(byId[PACK.id]).toBe('torfl');
    expect(byId['a2-exam-fixture']).toBe('torfl-a2');
    expect(await db.select().from(exams)).toHaveLength(5);
  });
});
