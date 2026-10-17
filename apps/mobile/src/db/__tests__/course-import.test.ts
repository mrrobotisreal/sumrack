import { CourseItemSchema, CourseSchema, type Pack } from '@sumrak/schema';
import coursePackJson from '@sumrak/schema/fixtures/packs/a1-hotel-fixture/pack.json';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { importPack, removePack } from '../importer';
import { createContentRepo } from '../repositories/content';
import {
  courseAttempts,
  courseFloors,
  courseItems,
  courseProgress,
  packs,
  stories,
} from '../schema';
import { createTestDb } from './helpers';

/**
 * T89: `course` pack import (HOTEL_PATH §2–§3). One floor = one pack: the
 * validated `course` object as JSON in `course_floors`, one `course_items` row
 * per item, stories through the ordinary story path. Re-import replaces via
 * the pack cascade; removal cascades content only — the two user tables are
 * never written by import.
 */

const PACK = coursePackJson as unknown as Pack;

describe('course pack import (T89)', () => {
  it('writes one floor row, one item row per item, and the stories', async () => {
    const db = createTestDb();
    const result = await importPack(db, PACK);
    expect(result.action).toBe('installed');
    expect(result.counts.courseItems).toBe(PACK.items?.length ?? 0);
    expect(result.counts.courseItems).toBeGreaterThan(0);

    const [floor] = await db.select().from(courseFloors).where(eq(courseFloors.packId, PACK.id));
    expect(floor).toBeDefined();
    expect(floor!.ladder).toBe('torfl');
    expect(floor!.level).toBe('A1');
    expect(floor!.floor).toBe(3);
    expect(floor!.titleRu).toBe(PACK.course!.title.ru);
    expect(floor!.titleEn).toBe(PACK.course!.title.en);
    // The stored JSON round-trips through the course schema.
    expect(CourseSchema.parse(JSON.parse(floor!.json))).toEqual(PACK.course);

    const itemRows = await db
      .select()
      .from(courseItems)
      .where(eq(courseItems.packId, PACK.id))
      .orderBy(asc(courseItems.itemId));
    expect(itemRows).toHaveLength(PACK.items!.length);
    for (const row of itemRows) {
      const source = PACK.items!.find((i) => i.id === row.itemId);
      expect(source).toBeDefined();
      expect(row.kind).toBe(source!.kind);
      expect(row.topic).toBe(source!.topic);
      expect(CourseItemSchema.parse(JSON.parse(row.json))).toEqual(source);
    }

    const storyRows = await db.select().from(stories).where(eq(stories.packId, PACK.id));
    expect(storyRows.map((s) => s.id).sort()).toEqual(PACK.stories.map((s) => s.id).sort());
  });

  it('reimport at a higher version replaces the floor and item rows, leaving none stale', async () => {
    const db = createTestDb();
    await importPack(db, PACK);
    const bumped = structuredClone(PACK);
    bumped.version = PACK.version + 1;
    bumped.course!.title = { ru: 'Новый этаж', en: 'New floor' };
    const result = await importPack(db, bumped);
    expect(result.action).toBe('updated');
    expect(result.counts.courseItems).toBe(bumped.items!.length);

    const itemRows = await db.select().from(courseItems).where(eq(courseItems.packId, PACK.id));
    expect(itemRows).toHaveLength(bumped.items!.length);
    const [floor] = await db.select().from(courseFloors).where(eq(courseFloors.packId, PACK.id));
    expect(floor!.titleEn).toBe('New floor');
    const floorRows = await db.select().from(courseFloors).where(eq(courseFloors.packId, PACK.id));
    expect(floorRows).toHaveLength(1);
  });

  it('removePack cascades the floor and items but keeps the user progress and attempts', async () => {
    const db = createTestDb();
    await importPack(db, PACK);
    const now = 1_000;
    await db.insert(courseProgress).values({
      key: `${PACK.id}:u1`,
      packId: PACK.id,
      unitId: 'u1',
      bestPercent: 90,
      passedAt: now,
      passedVia: 'course',
      attempts: 1,
      lastAttemptAt: now,
      updatedAt: now,
    });
    await db.insert(courseAttempts).values({
      id: 'att-1',
      packId: PACK.id,
      unitId: 'u1',
      kind: 'unit',
      startedAt: now,
      finishedAt: now,
      percent: 90,
      passed: true,
      itemIds: '["u1-c01"]',
      responsesJson: '{}',
    });

    await removePack(db, PACK.id);

    expect(await db.select().from(packs).where(eq(packs.id, PACK.id))).toEqual([]);
    expect(await db.select().from(courseFloors)).toEqual([]);
    expect(await db.select().from(courseItems)).toEqual([]);
    expect(await db.select().from(courseProgress)).toHaveLength(1);
    expect(await db.select().from(courseAttempts)).toHaveLength(1);
  });

  it('course stories stay out of listStories (Library, Today, continue-target) but the pack row stays for sync', async () => {
    const db = createTestDb();
    await importPack(db, PACK);
    const content = createContentRepo(db);
    expect(await content.listStories()).toEqual([]);
    expect(await content.listPacks()).toHaveLength(1);
  });

  it('a non-course pack writes no course rows (courseItems count is zero)', async () => {
    const db = createTestDb();
    const exam = (await import('@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json')).default;
    const result = await importPack(db, exam as unknown as Pack);
    expect(result.counts.courseItems).toBe(0);
    expect(await db.select().from(courseFloors)).toEqual([]);
    expect(await db.select().from(courseItems)).toEqual([]);
  });
});
