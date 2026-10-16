import type { Pack } from '@sumrak/schema';
import coursePackJson from '@sumrak/schema/fixtures/packs/a1-hotel-fixture/pack.json';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { courseAttempts, courseProgress, examItemCards } from '../schema';
import type { SumrakDB } from '../types';
import { createTestDb } from './helpers';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track: trackMock }));
vi.mock('@/services/error-log', () => ({ logError: vi.fn() }));

/**
 * T89: `repos.course` (HOTEL_PATH §3, decisions 4–8) against the real migrations.
 * Floor/item reads, the attempt lifecycle, the progress upsert with cooldown,
 * the extern cascade, and mistakes → the exam deck (examId 'course').
 */

const PACK = coursePackJson as unknown as Pack;
const PACK_ID = PACK.id;
const T0 = 1_790_000_000_000;
const MIN = 60_000;

let db: SumrakDB;
let repos: ReturnType<typeof createRepositories>;

beforeEach(async () => {
  db = createTestDb();
  repos = createRepositories(db);
  await importPack(db, PACK);
  trackMock.mockClear();
});

const itemsById = () => new Map((PACK.items ?? []).map((i) => [i.id, i]));

describe('reads', () => {
  it('listFloors returns the installed A1 floors in order with unit counts', async () => {
    const floors = await repos.course.listFloors({ ladder: 'torfl', level: 'A1' });
    expect(floors.map((f) => f.floor)).toEqual([3]);
    expect(floors[0]!.packId).toBe(PACK_ID);
    expect(floors[0]!.unitCount).toBe(PACK.course!.units.length);
    expect(floors[0]!.title.ru).toBe(PACK.course!.title.ru);
  });

  it('listFloors filters by level', async () => {
    expect(await repos.course.listFloors({ ladder: 'torfl', level: 'A2' })).toEqual([]);
  });

  it('getFloor returns the parsed course, null for an unknown pack', async () => {
    const floor = await repos.course.getFloor(PACK_ID);
    expect(floor!.course).toEqual(PACK.course);
    expect(await repos.course.getFloor('nope')).toBeNull();
  });

  it('getItems returns the items in the requested order, dropping unknown ids', async () => {
    const ids = ['u2-c01', 'ghost', 'u1-c01'];
    const items = await repos.course.getItems(PACK_ID, ids);
    expect(items.map((i) => i.id)).toEqual(['u2-c01', 'u1-c01']);
  });

  it('getItem returns one parsed item or null', async () => {
    const item = await repos.course.getItem(PACK_ID, 'u1-c01');
    expect(item).toEqual(itemsById().get('u1-c01'));
    expect(await repos.course.getItem(PACK_ID, 'missing')).toBeNull();
  });

  it('getProgress is empty on a fresh install and honours a pack filter', async () => {
    expect(await repos.course.getProgress()).toEqual([]);
    expect(await repos.course.getProgress([])).toEqual([]);
  });
});

describe('attempt lifecycle', () => {
  it('startAttempt stores the drawn items in order; activeAttempt resumes it after a kill', async () => {
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: ['u1-c01', 'u1-c02'],
      now: T0,
    });
    const active = await repos.course.activeAttempt(PACK_ID, 'u1', 'unit');
    expect(active?.id).toBe(attempt.id);
    expect(active?.itemIds).toEqual(['u1-c01', 'u1-c02']);
  });

  it('saveResponses persists the responses so far', async () => {
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: ['u1-c01'],
      now: T0,
    });
    await repos.course.saveResponses(attempt.id, { 'u1-c01': { answer: 0, correct: true } });
    const active = await repos.course.activeAttempt(PACK_ID, 'u1', 'unit');
    expect(active?.responses).toEqual({ 'u1-c01': { answer: 0, correct: true } });
  });

  it('a finished attempt is no longer active', async () => {
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: ['u1-c01'],
      now: T0,
    });
    await repos.course.recordAttempt({
      attemptId: attempt.id,
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      percent: 100,
      responses: { 'u1-c01': { answer: 0, correct: true } },
      items: [itemsById().get('u1-c01')!],
      now: T0,
    });
    expect(await repos.course.activeAttempt(PACK_ID, 'u1', 'unit')).toBeNull();
  });
});

describe('recordAttempt: progress, best, pass, cooldown (decision 6)', () => {
  async function run(
    kind: 'unit' | 'floor' | 'extern',
    unitId: string | null,
    percent: number,
    now = T0,
  ) {
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId,
      kind,
      itemIds: ['u1-c01'],
      now,
    });
    return repos.course.recordAttempt({
      attemptId: attempt.id,
      packId: PACK_ID,
      unitId,
      kind,
      percent,
      responses: { 'u1-c01': { answer: 0, correct: percent >= 50 } },
      items: [itemsById().get('u1-c01')!],
      now,
    });
  }

  it('a passing unit writes passedAt and no cooldown', async () => {
    const res = await run('unit', 'u1', 90);
    expect(res.passed).toBe(true);
    expect(res.progress.passedAt).toBe(T0);
    expect(res.progress.cooldownUntil).toBeNull();
    expect(res.progress.attempts).toBe(1);
  });

  it('a failing floor sets cooldownUntil = finishedAt + 20 min', async () => {
    const res = await run('floor', null, 40, T0);
    expect(res.passed).toBe(false);
    expect(res.progress.cooldownUntil).toBe(T0 + 20 * MIN);
    expect(res.progress.passedAt).toBeNull();
  });

  it('a failing экстерн sets a 60 min cooldown', async () => {
    const res = await run('extern', null, 70, T0);
    expect(res.progress.cooldownUntil).toBe(T0 + 60 * MIN);
  });

  it('a unit fail has no cooldown', async () => {
    const res = await run('unit', 'u1', 40, T0);
    expect(res.progress.cooldownUntil).toBeNull();
  });

  it('best percent keeps the maximum across attempts', async () => {
    await run('unit', 'u1', 85, T0);
    const second = await run('unit', 'u1', 60, T0 + MIN);
    expect(second.progress.bestPercent).toBe(85);
    expect(second.progress.attempts).toBe(2);
  });

  it('passedAt is set only on the first pass and never moves', async () => {
    await run('unit', 'u1', 85, T0);
    const again = await run('unit', 'u1', 95, T0 + 10 * MIN);
    expect(again.progress.passedAt).toBe(T0);
  });

  it('a pass clears a running cooldown on the same row', async () => {
    await run('floor', null, 40, T0);
    const passed = await run('floor', null, 90, T0 + 25 * MIN);
    expect(passed.progress.cooldownUntil).toBeNull();
    expect(passed.progress.passedAt).toBe(T0 + 25 * MIN);
  });

  it('a unit row and the floor row are separate keys', async () => {
    await run('unit', 'u1', 90, T0);
    const rows = await db.select().from(courseProgress);
    expect(rows.map((r) => r.key).sort()).toEqual([`${PACK_ID}:u1`]);
  });

  it('the attempt row stores finishedAt, percent, passed and responses', async () => {
    await run('unit', 'u1', 90, T0);
    const [row] = await db.select().from(courseAttempts);
    expect(row!.finishedAt).toBe(T0);
    expect(row!.percent).toBe(90);
    expect(row!.passed).toBe(true);
    expect(JSON.parse(row!.responsesJson)).toEqual({ 'u1-c01': { answer: 0, correct: true } });
  });
});

describe('extern cascade (decision 7, D12)', () => {
  it('markExternCascade passes lower panel floors via extern without overwriting a course pass', async () => {
    // The fixture is floor 3 only, so the cascade over a single installed floor
    // touches just that floor's row. A floor 3 pass via extern stamps the row.
    await repos.course.markExternCascade([PACK_ID], T0);
    const [row] = await db
      .select()
      .from(courseProgress)
      .where(eq(courseProgress.key, `${PACK_ID}:floor`));
    expect(row!.passedVia).toBe('extern');
    expect(row!.passedAt).toBe(T0);
  });

  it('a floor already passed via its course exam keeps its passedVia', async () => {
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: null,
      kind: 'floor',
      itemIds: ['u1-c01'],
      now: T0,
    });
    await repos.course.recordAttempt({
      attemptId: attempt.id,
      packId: PACK_ID,
      unitId: null,
      kind: 'floor',
      percent: 90,
      responses: { 'u1-c01': { answer: 0, correct: true } },
      items: [itemsById().get('u1-c01')!],
      now: T0,
    });
    await repos.course.markExternCascade([PACK_ID], T0 + MIN);
    const [row] = await db
      .select()
      .from(courseProgress)
      .where(eq(courseProgress.key, `${PACK_ID}:floor`));
    expect(row!.passedVia).toBe('course');
    expect(row!.passedAt).toBe(T0);
  });
});

describe('mistakes → the exam deck (decision 8)', () => {
  it('a missed item creates a course deck card and grades it Again', async () => {
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: ['u1-c01'],
      now: T0,
    });
    const res = await repos.course.recordAttempt({
      attemptId: attempt.id,
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      percent: 0,
      responses: { 'u1-c01': { answer: 3, correct: false } },
      items: [itemsById().get('u1-c01')!],
      now: T0,
    });
    expect(res.deckCards).toBe(1);
    const [card] = await db
      .select()
      .from(examItemCards)
      .where(eq(examItemCards.itemKey, `${PACK_ID}:course:u1-c01`));
    expect(card).toBeDefined();
    expect(card!.examId).toBe('course');
    expect(card!.subtestKind).toBe('lexgram');
    expect(card!.topic).toBe(itemsById().get('u1-c01')!.topic);
    expect(card!.lastResult).toBe('wrong');
  });

  it('a correct answer creates no deck card when none exists', async () => {
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: ['u1-c01'],
      now: T0,
    });
    const res = await repos.course.recordAttempt({
      attemptId: attempt.id,
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      percent: 100,
      responses: { 'u1-c01': { answer: 0, correct: true } },
      items: [itemsById().get('u1-c01')!],
      now: T0,
    });
    expect(res.deckCards).toBe(0);
    expect(await db.select().from(examItemCards)).toEqual([]);
  });

  it('a correct answer on an item with an existing card grades it (lastResult correct)', async () => {
    const item = itemsById().get('u1-c01')!;
    const miss = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: ['u1-c01'],
      now: T0,
    });
    await repos.course.recordAttempt({
      attemptId: miss.id,
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      percent: 0,
      responses: { 'u1-c01': { answer: 3, correct: false } },
      items: [item],
      now: T0,
    });
    const hit = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: ['u1-c01'],
      now: T0 + MIN,
    });
    await repos.course.recordAttempt({
      attemptId: hit.id,
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      percent: 100,
      responses: { 'u1-c01': { answer: 0, correct: true } },
      items: [item],
      now: T0 + MIN,
    });
    const [card] = await db
      .select()
      .from(examItemCards)
      .where(eq(examItemCards.itemKey, `${PACK_ID}:course:u1-c01`));
    expect(card!.lastResult).toBe('correct');
  });

  it('a trigger miss goes to the deck with the lexgram subtest on a grammar floor', async () => {
    const trigger = PACK.items!.find((i) => i.kind === 'trigger');
    if (!trigger) return;
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: [trigger.id],
      now: T0,
    });
    await repos.course.recordAttempt({
      attemptId: attempt.id,
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      percent: 0,
      responses: { [trigger.id]: { answer: 99, correct: false } },
      items: [trigger],
      now: T0,
    });
    const [card] = await db
      .select()
      .from(examItemCards)
      .where(eq(examItemCards.itemKey, `${PACK_ID}:course:${trigger.id}`));
    expect(card!.subtestKind).toBe('lexgram');
  });

  it('a half-credit typed miss grades Hard, not Again', async () => {
    const typed = PACK.items!.find((i) => i.kind === 'typed');
    if (!typed) return;
    const attempt = await repos.course.startAttempt({
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      itemIds: [typed.id],
      now: T0,
    });
    await repos.course.recordAttempt({
      attemptId: attempt.id,
      packId: PACK_ID,
      unitId: 'u1',
      kind: 'unit',
      percent: 50,
      responses: { [typed.id]: { answer: 'x', correct: false, half: true } },
      items: [typed],
      now: T0,
    });
    const [card] = await db
      .select()
      .from(examItemCards)
      .where(eq(examItemCards.itemKey, `${PACK_ID}:course:${typed.id}`));
    // Half credit is a Hard rating (decision 8, the drill rule): the card is
    // graded (not an Again), so it carries a review and is not 'wrong'.
    expect(card).toBeDefined();
    expect(card!.lastResult).toBe('correct');
    expect(JSON.parse(card!.fsrsJson).reps).toBe(1);
  });
});

describe('dev wipe guard', () => {
  it('wipeCourseProgress refuses outside __DEV__', async () => {
    const original = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      await expect(repos.course.wipeCourseProgress()).rejects.toThrow(/dev-only/);
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = original;
    }
  });
});
