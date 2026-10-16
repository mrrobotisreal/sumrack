import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { CourseItemSchema, CourseSchema, type CourseItem } from '@sumrak/schema';

type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
import { Rating, type Grade } from 'ts-fsrs';
import { z } from 'zod';

import { cooldownFor, passes, type CourseKind } from '@/features/hotel/hotel-model';
import { ratingForDrillAnswer } from '@/features/torfl/pace';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { newId } from '../ids';
import { examItemKey } from '@/features/torfl/model';
import { courseAttempts, courseFloors, courseItems, courseProgress } from '../schema';
import type { SumrakDB } from '../types';
import { createExamsRepo } from './exams';

/**
 * The hotel course repository (T89, HOTEL_PATH §3, decisions 4–7) — `repos.course`.
 * The only place the hotel touches the database. Rules:
 *
 * - Every JSON column is Zod-parsed here on read (`CourseSchema` / `CourseItemSchema`).
 *   An unreadable row resolves to `null` and never crashes the screen.
 * - `recordAttempt` writes the attempt and the progress upsert in ONE transaction,
 *   and mistakes go to the exam deck through the T70 grading path (decision 8).
 * - User tables carry no FK to content: progress and attempts survive a pack update.
 */

export interface CourseFloorRow {
  packId: string;
  floor: number;
  title: { ru: string; en: string };
  subtitle: { ru: string; en: string } | null;
  unitCount: number;
  course: z.infer<typeof CourseSchema>;
}

export interface ProgressRecord {
  key: string;
  packId: string;
  unitId: string | null;
  bestPercent: number;
  passedAt: number | null;
  passedVia: 'course' | 'extern' | null;
  attempts: number;
  lastAttemptAt: number | null;
  cooldownUntil: number | null;
  updatedAt: number;
}

export interface AttemptRecord {
  id: string;
  packId: string;
  unitId: string | null;
  kind: 'unit' | 'floor' | 'extern';
  startedAt: number;
  finishedAt: number | null;
  percent: number | null;
  passed: boolean | null;
  itemIds: string[];
  responses: Record<string, ResponseEntry>;
}

export interface ResponseEntry {
  answer: unknown;
  correct: boolean;
  half?: boolean;
}

export interface StartCourseAttemptInput {
  packId: string;
  unitId: string | null;
  kind: 'unit' | 'floor' | 'extern';
  itemIds: string[];
  now?: number;
}

/** Input to `recordAttempt`: the finished sitting and its scored responses. */
export interface RecordAttemptInput {
  attemptId: string;
  packId: string;
  unitId: string | null;
  kind: 'unit' | 'floor' | 'extern';
  /** The percent the model computed (`scoreAttempt`). */
  percent: number;
  /** Every scored item's response, keyed by item id. */
  responses: Record<string, ResponseEntry>;
  /** The items the attempt drew, in order (used for the deck + stats). */
  items: CourseItem[];
  now?: number;
}

export interface RecordAttemptResult {
  progress: ProgressRecord;
  passed: boolean;
  /** Missed scored items that entered the exam deck. */
  deckCards: number;
}

const floorKey = (packId: string) => `${packId}:floor`;
const unitKey = (packId: string, unitId: string) => `${packId}:${unitId}`;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

const ResponsesSchema = z.record(
  z.string(),
  z.strictObject({
    answer: z.unknown(),
    correct: z.boolean(),
    half: z.boolean().optional(),
  }),
);
const IdListSchema = z.array(z.string());

/** The deck's subtest kind for a course item (decision 8, HOTEL_PATH §3). */
export function courseSubtestKind(floor: number, item: CourseItem): string {
  if (floor === 12) return 'writing';
  if (floor === 14) return item.topic.startsWith('ls-') ? 'listening' : 'reading';
  if (floor === 15) return 'speaking';
  return 'lexgram';
}

/**
 * The deck rating for one course answer (decision 8, the drill rule): a miss
 * is Again; a half-credit typed answer is Hard; a correct answer on an item
 * that already has a card is graded by the pace rule (Good when untimed).
 */
export function courseRating(outcome: 'half' | 'wrong', subtestKind: string): Grade {
  return ratingForDrillAnswer(outcome, 0, subtestKind, 'A1');
}

/** Items that go into the exam deck: objective kinds only (writing/speaking are graded in T92). */
function isDeckItem(item: CourseItem): boolean {
  return item.kind === 'choice' || item.kind === 'typed' || item.kind === 'trigger' || item.kind === 'transform';
}

/**
 * D14 / decision 8: every missed scored item enters the exam deck through the
 * T70 path (`ensureCard` then `gradeCard`). A miss grades Again. A correct
 * answer on an item that already has a card grades Good (as the drills do);
 * a correct answer on an item with no card creates nothing.
 */
async function enterMistakesInto(
  exams: ReturnType<typeof createExamsRepo>,
  floorNo: number,
  input: RecordAttemptInput,
): Promise<number> {
  let count = 0;
  for (const item of input.items) {
    if (!isDeckItem(item)) continue;
    const response = input.responses[item.id];
    if (!response) continue;
    const subtestKind = courseSubtestKind(floorNo, item);
    if (response.correct) {
      // A correct answer only ever grades a card that already exists (decision 8).
      // The course has no per-item pace, so it is Good, never a timed rating.
      const existing = await exams.getCard(examItemKey(input.packId, 'course', item.id));
      if (existing) await exams.gradeCard(existing.itemKey, Rating.Good, input.now);
      continue;
    }
    const card = await exams.ensureCard({
      packId: input.packId,
      examId: 'course',
      itemId: item.id,
      subtestKind,
      topic: item.topic,
      now: input.now,
    });
    await exams.gradeCard(
      card.itemKey,
      courseRating(response.half ? 'half' : 'wrong', subtestKind),
      input.now,
    );
    count += 1;
  }
  return count;
}

export function createCourseRepo(db: SumrakDB) {
  const exams = createExamsRepo(db);
  const parseWarned = new Set<string>();

  /** The D12 cascade for one pack — see `markExternCascade`. */
  async function cascadeExternFloors(packId: string, now: number): Promise<void> {
    const floor = await getFloorRow(packId);
    if (!floor) return;
    const below = await db
      .select()
      .from(courseFloors)
      .where(
        and(
          eq(courseFloors.ladder, floor.ladder),
          eq(courseFloors.level, floor.level),
          sql`${courseFloors.floor} <= ${floor.floor}`,
        ),
      );
    for (const row of below) {
      const key = floorKey(row.packId);
      const existing = (
        await db.select().from(courseProgress).where(eq(courseProgress.key, key)).limit(1)
      )[0];
      if (existing?.passedAt != null) continue;
      const next = {
        key,
        packId: row.packId,
        unitId: null,
        bestPercent: existing?.bestPercent ?? 0,
        passedAt: now,
        passedVia: 'extern' as const,
        attempts: existing?.attempts ?? 0,
        lastAttemptAt: existing?.lastAttemptAt ?? null,
        cooldownUntil: null,
        updatedAt: now,
      };
      await db
        .insert(courseProgress)
        .values(next)
        .onConflictDoUpdate({ target: courseProgress.key, set: next });
    }
  }

  function warnOnce(key: string, err: unknown) {
    if (parseWarned.has(key)) return;
    parseWarned.add(key);
    track('app_error', { scope: 'course-parse', fatal: false });
    logError('db', err ?? new Error(`unreadable course row ${key}`));
  }

  function toProgress(row: typeof courseProgress.$inferSelect): ProgressRecord {
    return {
      key: row.key,
      packId: row.packId,
      unitId: row.unitId,
      bestPercent: row.bestPercent,
      passedAt: row.passedAt,
      passedVia: row.passedVia,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt,
      cooldownUntil: row.cooldownUntil,
      updatedAt: row.updatedAt,
    };
  }

  function toAttempt(row: typeof courseAttempts.$inferSelect): AttemptRecord | null {
    const ids = IdListSchema.safeParse(parseJson(row.itemIds));
    const responses = ResponsesSchema.safeParse(parseJson(row.responsesJson));
    if (!ids.success || !responses.success) {
      warnOnce(`attempt/${row.id}`, null);
      return null;
    }
    return {
      id: row.id,
      packId: row.packId,
      unitId: row.unitId,
      kind: row.kind,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      percent: row.percent,
      passed: row.passed,
      itemIds: ids.data,
      responses: responses.data,
    };
  }

  async function getFloorRow(packId: string): Promise<typeof courseFloors.$inferSelect | null> {
    const rows = await db.select().from(courseFloors).where(eq(courseFloors.packId, packId)).limit(1);
    return rows[0] ?? null;
  }

  function parseCourse(row: typeof courseFloors.$inferSelect): z.infer<typeof CourseSchema> | null {
    const parsed = CourseSchema.safeParse(parseJson(row.json));
    if (!parsed.success) {
      warnOnce(`floor/${row.packId}`, parsed.error);
      return null;
    }
    return parsed.data;
  }

  return {
    /** Every installed course floor of a ladder/level, ordered by floor. Unreadable floors are skipped. */
    async listFloors(opts: { ladder: string; level: CefrLevel }): Promise<CourseFloorRow[]> {
      const rows = await db
        .select()
        .from(courseFloors)
        .where(and(eq(courseFloors.ladder, opts.ladder), eq(courseFloors.level, opts.level)))
        .orderBy(asc(courseFloors.floor));
      const out: CourseFloorRow[] = [];
      for (const row of rows) {
        const course = parseCourse(row);
        if (!course) continue;
        out.push({
          packId: row.packId,
          floor: row.floor,
          title: course.title,
          subtitle: course.subtitle ?? null,
          unitCount: course.units.length,
          course,
        });
      }
      return out;
    },

    /** One floor by pack id (null when not installed or unreadable). */
    async getFloor(packId: string): Promise<CourseFloorRow | null> {
      const row = await getFloorRow(packId);
      if (!row) return null;
      const course = parseCourse(row);
      if (!course) return null;
      return {
        packId: row.packId,
        floor: row.floor,
        title: course.title,
        subtitle: course.subtitle ?? null,
        unitCount: course.units.length,
        course,
      };
    },

    /** The parsed items of a pack, in the given id order. Missing or unreadable ids are dropped. */
    async getItems(packId: string, ids: readonly string[]): Promise<CourseItem[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(courseItems)
        .where(and(eq(courseItems.packId, packId), inArray(courseItems.itemId, [...ids])));
      const byId = new Map<string, CourseItem>();
      for (const row of rows) {
        const parsed = CourseItemSchema.safeParse(parseJson(row.json));
        if (parsed.success) byId.set(row.itemId, parsed.data);
        else warnOnce(`item/${row.packId}/${row.itemId}`, parsed.error);
      }
      return ids.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      });
    },

    /** One course item by pack and id (null when missing or unreadable). Used by the deck resolver. */
    async getItem(packId: string, itemId: string): Promise<CourseItem | null> {
      const rows = await db
        .select()
        .from(courseItems)
        .where(and(eq(courseItems.packId, packId), eq(courseItems.itemId, itemId)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const parsed = CourseItemSchema.safeParse(parseJson(row.json));
      if (!parsed.success) {
        warnOnce(`item/${packId}/${itemId}`, parsed.error);
        return null;
      }
      return parsed.data;
    },

    /** Progress rows, optionally limited to some packs. */
    async getProgress(packIds?: readonly string[]): Promise<ProgressRecord[]> {
      const rows =
        packIds === undefined
          ? await db.select().from(courseProgress)
          : packIds.length === 0
            ? []
            : await db
                .select()
                .from(courseProgress)
                .where(inArray(courseProgress.packId, [...packIds]));
      return rows.map(toProgress);
    },

    /** Start a sitting (unit exercise, floor exam or экстерн). The drawn items are stored in order. */
    async startAttempt(input: StartCourseAttemptInput): Promise<AttemptRecord> {
      const now = input.now ?? Date.now();
      const id = newId();
      await db.insert(courseAttempts).values({
        id,
        packId: input.packId,
        unitId: input.unitId,
        kind: input.kind,
        startedAt: now,
        finishedAt: null,
        percent: null,
        passed: null,
        itemIds: JSON.stringify(input.itemIds),
        responsesJson: '{}',
      });
      return {
        id,
        packId: input.packId,
        unitId: input.unitId,
        kind: input.kind,
        startedAt: now,
        finishedAt: null,
        percent: null,
        passed: null,
        itemIds: [...input.itemIds],
        responses: {},
      };
    },

    /** Save the responses so far on an open sitting (so a kill can resume it). */
    async saveResponses(attemptId: string, responses: Record<string, ResponseEntry>): Promise<void> {
      await db
        .update(courseAttempts)
        .set({ responsesJson: JSON.stringify(responses) })
        .where(eq(courseAttempts.id, attemptId));
    },

    /** The unfinished sitting for a unit / floor / экстерн, if the app was killed mid-way. */
    async activeAttempt(
      packId: string,
      unitId: string | null,
      kind: 'unit' | 'floor' | 'extern',
    ): Promise<AttemptRecord | null> {
      const rows = await db
        .select()
        .from(courseAttempts)
        .where(
          and(
            eq(courseAttempts.packId, packId),
            unitId === null
              ? sql`${courseAttempts.unitId} IS NULL`
              : eq(courseAttempts.unitId, unitId),
            eq(courseAttempts.kind, kind),
            sql`${courseAttempts.finishedAt} IS NULL`,
          ),
        )
        .orderBy(sql`${courseAttempts.startedAt} DESC`)
        .limit(1);
      const row = rows[0];
      return row ? toAttempt(row) : null;
    },

    /**
     * Finish a sitting and record it (decisions 6 and 8). ONE transaction:
     *
     * - the attempt row gets `finishedAt`, `percent`, `passed`, its responses;
     * - the progress row upserts: `bestPercent` = max, `passedAt` only on the
     *   first pass, `passedVia` ('course' for a floor exam, 'extern' for экстерн),
     *   `attempts`++, `lastAttemptAt`, and `cooldownUntil` = now + cooldownFor
     *   on a FAIL only (a pass never cools down);
     * - every MISSED scored item (choice/typed/trigger/transform) enters the exam
     *   deck via the T70 grading path, after the transaction commits.
     *
     * Returns the new progress row and whether the sitting passed.
     */
    async recordAttempt(input: RecordAttemptInput): Promise<RecordAttemptResult> {
      const now = input.now ?? Date.now();
      const kind: CourseKind = input.kind;
      const pass = passes(input.kind, input.percent);
      const key = input.unitId === null ? floorKey(input.packId) : unitKey(input.packId, input.unitId);
      // Cooldown is a timestamp only where the rule has one (decision 6): a unit
      // fail and any pass leave it null, floor/экстерн/gate fails set it.
      const cooldownMs = pass ? 0 : cooldownFor(kind, false);
      const cooldown = cooldownMs > 0 ? now + cooldownMs : null;

      await db.run(sql`BEGIN`);
      try {
        await db
          .update(courseAttempts)
          .set({
            finishedAt: now,
            percent: input.percent,
            passed: pass,
            responsesJson: JSON.stringify(input.responses),
          })
          .where(eq(courseAttempts.id, input.attemptId));

        const existing = (
          await db.select().from(courseProgress).where(eq(courseProgress.key, key)).limit(1)
        )[0];
        const best = Math.max(existing?.bestPercent ?? 0, input.percent);
        const firstPass = pass && existing?.passedAt == null;
        const passedAt = firstPass ? now : (existing?.passedAt ?? null);
        const passedVia =
          passedAt != null
            ? (existing?.passedVia ?? (input.kind === 'extern' ? 'extern' : 'course'))
            : null;
        const next = {
          key,
          packId: input.packId,
          unitId: input.unitId,
          bestPercent: best,
          passedAt,
          passedVia: passedVia as 'course' | 'extern' | null,
          attempts: (existing?.attempts ?? 0) + 1,
          lastAttemptAt: now,
          cooldownUntil: cooldown,
          updatedAt: now,
        };
        await db
          .insert(courseProgress)
          .values(next)
          .onConflictDoUpdate({ target: courseProgress.key, set: next });

        // The D12 cascade: a passing экстерн also passes every lower panel floor
        // that is not yet passed (floor rows only).
        if (pass && input.kind === 'extern' && input.unitId === null) {
          await cascadeExternFloors(input.packId, now);
        }

        await db.run(sql`COMMIT`);
      } catch (err) {
        await db.run(sql`ROLLBACK`);
        throw err;
      }

      // Mistakes → the exam deck (D14, decision 8). After commit: a deck failure
      // must never roll back the sitting itself.
      const floorRow = await getFloorRow(input.packId);
      const deckCards = await enterMistakesInto(exams, floorRow?.floor ?? -1, input);

      const progressRow = (
        await db.select().from(courseProgress).where(eq(courseProgress.key, key)).limit(1)
      )[0]!;
      return { progress: toProgress(progressRow), passed: pass, deckCards };
    },

    /**
     * D12 (decision 7): for each pack id whose экстерн passed, mark that floor and
     * every lower panel floor not yet passed as passed via 'extern' (floor rows
     * only; units stay unpassed, and the model unlocks them). Runs in its own
     * transaction so a caller that already has one open is not affected.
     */
    async markExternCascade(packIds: readonly string[], now = Date.now()): Promise<void> {
      await db.run(sql`BEGIN`);
      try {
        for (const packId of packIds) await cascadeExternFloors(packId, now);
        await db.run(sql`COMMIT`);
      } catch (err) {
        await db.run(sql`ROLLBACK`);
        throw err;
      }
    },

    /** DEV ONLY (the S25 fixture walk): wipe every course progress and attempt row. Guarded by __DEV__. */
    async wipeCourseProgress(): Promise<void> {
      if (!__DEV__) throw new Error('wipeCourseProgress is dev-only');
      await db.delete(courseAttempts);
      await db.delete(courseProgress);
    },
  };
}

export type CourseRepo = ReturnType<typeof createCourseRepo>;
