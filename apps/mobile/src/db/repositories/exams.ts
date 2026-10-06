import { and, asc, desc, eq, gte, inArray, like, lte, ne, sql, type SQL } from 'drizzle-orm';
import { ExamSchema, type Exam, type ExamSubtestKind } from '@sumrak/schema';
import { createEmptyCard, Rating, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { z } from 'zod';

import {
  ExamAnswerSchema,
  ExamAttemptStateSchema,
  ExamGradingSchema,
  ExamResultsSchema,
  ExamSubtestIdsSchema,
  ExamFsrsCardSchema,
  examItemKey,
  findExamItem,
  type ExamAnswer,
  type ExamAttemptState,
  type ExamAttemptStatus,
  type ExamFsrsCard,
  type ExamGrading,
  type ExamGradingStatus,
  type ExamMode,
  type ExamResults,
  type ExamScope,
  type ExamVerdict,
} from '@/features/torfl/model';
import { track } from '@/services/analytics';

import { newId } from '../ids';
import { examAttempts, examItemCards, examResponses, exams } from '../schema';
import type { SumrakDB } from '../types';
import { reviewScheduler } from './reviews';

/**
 * Exams repository (T68, TORFL_EXAM_PREP §4.3) — `repos.exams`: the read side
 * over the `exams` content table, the attempt lifecycle over `exam_attempts`
 * / `exam_responses`, topic stats + the AI grading queue's reads, and the
 * exam deck («Работа над ошибками», §7.2) over `exam_item_cards`.
 *
 * Rules:
 * - Every JSON column is parsed here through `features/torfl/model.ts`; an
 *   unreadable value resolves to `null` and fires ONE `app_error` per row
 *   (the T52/T58 pattern) — never a crash. Writes validate before writing.
 * - At most ONE `active` MOCK attempt exists; `startAttempt` refuses another
 *   unless `{ replace: true }`, which abandons the old one first. DRILL
 *   attempts (scope 'drill', T70) are exempt: they never block, replace or
 *   resume-collide with a mock (`abandonActiveDrills` sweeps orphans).
 * - Attempts outlive pack versions (§12): nothing here throws on an item a
 *   pack update removed — `topicStats` falls back to the deck row's topic,
 *   then skips.
 * - The deck NEVER touches `cards` / `review_log` (ADR-0020 decision 5) but
 *   schedules with the SAME ts-fsrs instance as `reviews` (T06 params).
 */

export type ExamRow = typeof exams.$inferSelect;
export type ExamAttemptRow = typeof examAttempts.$inferSelect;
export type ExamResponseRow = typeof examResponses.$inferSelect;
export type ExamItemCardRow = typeof examItemCards.$inferSelect;

/** One installed exam (listing shape); `exam` is null when the stored JSON no longer parses. */
export interface ExamSummary {
  packId: string;
  examId: string;
  orderIdx: number;
  format: string;
  level: ExamRow['level'];
  mode: ExamMode;
  titleRu: string;
  titleEn: string;
  exam: Exam | null;
}

/** An attempt with its JSON columns parsed (`null` = unreadable). */
export interface ExamAttempt {
  id: string;
  packId: string;
  examId: string;
  scope: ExamScope;
  mode: ExamMode;
  status: ExamAttemptStatus;
  subtestIds: string[] | null;
  state: ExamAttemptState | null;
  startedAt: number;
  finishedAt: number | null;
  results: ExamResults | null;
  verdict: ExamVerdict | null;
  xpAwarded: number;
  pinned: boolean;
}

export interface ExamResponse {
  id: string;
  attemptId: string;
  subtestId: string;
  itemId: string;
  answer: ExamAnswer | null;
  points: number | null;
  maxPoints: number;
  gradingStatus: ExamGradingStatus;
  grading: ExamGrading | null;
  durationMs: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExamAttemptDetail extends ExamAttempt {
  responses: ExamResponse[];
}

/** A queued AI grading job (§6.2): the response plus where its item lives. */
export interface PendingGradingJob extends ExamResponse {
  packId: string;
  examId: string;
}

export interface ExamTopicStat {
  topic: string;
  answered: number;
  correct: number;
  points: number;
  maxPoints: number;
}

export interface ExamItemCard {
  itemKey: string;
  packId: string;
  examId: string;
  itemId: string;
  subtestKind: string;
  topic: string;
  fsrs: ExamFsrsCard | null;
  due: number;
  lastResult: 'correct' | 'wrong' | null;
  suspended: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ExamDeckCounts {
  /** Non-suspended cards due at `now`. */
  due: number;
  /** Non-suspended cards. */
  total: number;
  suspended: number;
  byTopic: Record<string, { due: number; total: number }>;
}

/** Thrown by `startAttempt` while another attempt is active (the hub offers resume/abandon). */
export class ExamAttemptActiveError extends Error {
  constructor(readonly activeAttemptId: string) {
    super(`an exam attempt is already active (${activeAttemptId})`);
    this.name = 'ExamAttemptActiveError';
  }
}

export interface StartAttemptInput {
  packId: string;
  examId: string;
  scope: ExamScope;
  subtestIds: string[];
  mode: ExamMode;
  state: ExamAttemptState;
  /** Defaults to Date.now(). */
  now?: number;
}

export interface RecordResponseInput {
  attemptId: string;
  subtestId: string;
  itemId: string;
  answer: ExamAnswer;
  points: number | null;
  maxPoints: number;
  gradingStatus: ExamGradingStatus;
  grading?: ExamGrading | null;
  durationMs?: number | null;
  now?: number;
}

export interface EnsureCardInput {
  /** Derived from pack/exam/item when absent; must match when given. */
  itemKey?: string;
  packId: string;
  examId: string;
  itemId: string;
  subtestKind: ExamSubtestKind | string;
  topic: string;
  now?: number;
}

const OBJECTIVE_ITEM_KINDS = new Set(['choice', 'typed']);

function parseJsonText(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function toFsrsJson(card: FsrsCard): ExamFsrsCard {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

function fromFsrsJson(card: ExamFsrsCard): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review !== null ? new Date(card.last_review) : undefined,
  };
}

export function createExamsRepo(db: SumrakDB) {
  const parseWarned = new Set<string>();
  /** Parsed-exam memo keyed by `packId/examId`, invalidated when the stored JSON changes (pack update). */
  const examCache = new Map<string, { json: string; exam: Exam | null }>();

  function parseWith<T>(schema: z.ZodType<T>, raw: unknown, key: string, scope: string): T | null {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    if (!parseWarned.has(key)) {
      parseWarned.add(key);
      track('app_error', { scope, fatal: false });
    }
    return null;
  }

  function parseExamRow(row: ExamRow): Exam | null {
    const key = `${row.packId}/${row.examId}`;
    const cached = examCache.get(key);
    if (cached && cached.json === row.json) return cached.exam;
    const exam = parseWith(ExamSchema, parseJsonText(row.json), `exam/${key}`, 'exam-parse');
    examCache.set(key, { json: row.json, exam });
    return exam;
  }

  function toSummary(row: ExamRow): ExamSummary {
    return {
      packId: row.packId,
      examId: row.examId,
      orderIdx: row.orderIdx,
      format: row.format,
      level: row.level,
      mode: row.mode,
      titleRu: row.titleRu,
      titleEn: row.titleEn,
      exam: parseExamRow(row),
    };
  }

  function toAttempt(row: ExamAttemptRow): ExamAttempt {
    return {
      id: row.id,
      packId: row.packId,
      examId: row.examId,
      scope: row.scope,
      mode: row.mode,
      status: row.status,
      subtestIds: parseWith(
        ExamSubtestIdsSchema,
        parseJsonText(row.subtestIds),
        `attempt/${row.id}/subtests`,
        'exam-attempt-parse',
      ),
      state: parseWith(
        ExamAttemptStateSchema,
        parseJsonText(row.stateJson),
        `attempt/${row.id}/state`,
        'exam-attempt-parse',
      ),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      results:
        row.resultsJson === null
          ? null
          : parseWith(
              ExamResultsSchema,
              parseJsonText(row.resultsJson),
              `attempt/${row.id}/results`,
              'exam-attempt-parse',
            ),
      verdict: row.verdict,
      xpAwarded: row.xpAwarded,
      pinned: row.pinned,
    };
  }

  function toResponse(row: ExamResponseRow): ExamResponse {
    return {
      id: row.id,
      attemptId: row.attemptId,
      subtestId: row.subtestId,
      itemId: row.itemId,
      answer: parseWith(
        ExamAnswerSchema,
        parseJsonText(row.answerJson),
        `response/${row.id}/answer`,
        'exam-response-parse',
      ),
      points: row.points,
      maxPoints: row.maxPoints,
      gradingStatus: row.gradingStatus,
      grading:
        row.gradingJson === null
          ? null
          : parseWith(
              ExamGradingSchema,
              parseJsonText(row.gradingJson),
              `response/${row.id}/grading`,
              'exam-response-parse',
            ),
      durationMs: row.durationMs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function toCard(row: ExamItemCardRow): ExamItemCard {
    return {
      itemKey: row.itemKey,
      packId: row.packId,
      examId: row.examId,
      itemId: row.itemId,
      subtestKind: row.subtestKind,
      topic: row.topic,
      fsrs: parseWith(
        ExamFsrsCardSchema,
        parseJsonText(row.fsrsJson),
        `card/${row.itemKey}`,
        'exam-card-parse',
      ),
      due: row.due,
      lastResult: row.lastResult,
      suspended: row.suspended,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function getAttemptRow(attemptId: string): Promise<ExamAttemptRow | null> {
    const rows = await db
      .select()
      .from(examAttempts)
      .where(eq(examAttempts.id, attemptId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getActiveRowOrThrow(attemptId: string): Promise<ExamAttemptRow> {
    const row = await getAttemptRow(attemptId);
    if (!row) throw new Error(`exam attempt "${attemptId}" does not exist`);
    if (row.status !== 'active') {
      throw new Error(`exam attempt "${attemptId}" is ${row.status}, not active`);
    }
    return row;
  }

  /**
   * The «active attempt» rows the single-active rule + resume read. DRILL
   * attempts are exempt (T70 decision): a drill never blocks, replaces or is
   * mistaken for a mock's resumable attempt — see `startAttempt` /
   * `abandonActiveDrills`.
   */
  async function activeRows(): Promise<ExamAttemptRow[]> {
    return db
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.status, 'active'), ne(examAttempts.scope, 'drill')))
      .orderBy(desc(examAttempts.startedAt));
  }

  async function getExam(packId: string, examId: string): Promise<Exam | null> {
    const rows = await db
      .select()
      .from(exams)
      .where(and(eq(exams.packId, packId), eq(exams.examId, examId)))
      .limit(1);
    const row = rows[0];
    return row ? parseExamRow(row) : null;
  }

  async function getCardRow(itemKey: string): Promise<ExamItemCardRow | null> {
    const rows = await db
      .select()
      .from(examItemCards)
      .where(eq(examItemCards.itemKey, itemKey))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Scored objective responses joined to their item's topic + subtest kind
   * (the shared core of `topicStats` / `recentAccuracy`). Resolution order:
   * the item in the CURRENT exam → its deck card → skipped (§12).
   */
  async function objectiveRows(opts: {
    sinceMs?: number;
    mode?: ExamMode;
  }): Promise<
    { topic: string; kind: string; points: number; maxPoints: number; createdAt: number }[]
  > {
    const where: SQL[] = [sql`${examResponses.points} IS NOT NULL`];
    if (opts.sinceMs !== undefined) where.push(gte(examResponses.createdAt, opts.sinceMs));
    if (opts.mode) where.push(eq(examAttempts.mode, opts.mode));
    const rows = await db
      .select({
        packId: examAttempts.packId,
        examId: examAttempts.examId,
        subtestId: examResponses.subtestId,
        itemId: examResponses.itemId,
        points: examResponses.points,
        maxPoints: examResponses.maxPoints,
        createdAt: examResponses.createdAt,
      })
      .from(examResponses)
      .innerJoin(examAttempts, eq(examAttempts.id, examResponses.attemptId))
      .where(and(...where));
    if (rows.length === 0) return [];

    const examsByKey = new Map<string, Exam | null>();
    const examFor = async (packId: string, examId: string) => {
      const key = `${packId}/${examId}`;
      if (!examsByKey.has(key)) examsByKey.set(key, await getExam(packId, examId));
      return examsByKey.get(key) ?? null;
    };
    const cardRows = await db
      .select({
        itemKey: examItemCards.itemKey,
        topic: examItemCards.topic,
        subtestKind: examItemCards.subtestKind,
      })
      .from(examItemCards);
    const cardMeta = new Map(cardRows.map((c) => [c.itemKey, c]));

    const out: {
      topic: string;
      kind: string;
      points: number;
      maxPoints: number;
      createdAt: number;
    }[] = [];
    for (const r of rows) {
      const exam = await examFor(r.packId, r.examId);
      const located = exam ? findExamItem(exam, r.itemId, r.subtestId) : null;
      let topic: string;
      let kind: string;
      if (located) {
        if (!OBJECTIVE_ITEM_KINDS.has(located.item.kind)) continue;
        topic = located.item.topic;
        kind = located.subtest.kind;
      } else {
        const meta = cardMeta.get(examItemKey(r.packId, r.examId, r.itemId));
        if (!meta) continue;
        topic = meta.topic;
        kind = meta.subtestKind;
      }
      out.push({
        topic,
        kind,
        points: r.points ?? 0,
        maxPoints: r.maxPoints,
        createdAt: r.createdAt,
      });
    }
    return out;
  }

  return {
    // --- content reads --------------------------------------------------

    /** Installed exams, pack then authoring order; optional pack / mode filter. */
    async listExams(filter: { packId?: string; mode?: ExamMode } = {}): Promise<ExamSummary[]> {
      const where: SQL[] = [];
      if (filter.packId) where.push(eq(exams.packId, filter.packId));
      if (filter.mode) where.push(eq(exams.mode, filter.mode));
      const rows = await db
        .select()
        .from(exams)
        .where(where.length > 0 ? and(...where) : undefined)
        .orderBy(asc(exams.packId), asc(exams.orderIdx));
      return rows.map(toSummary);
    },

    /** One exam, Zod-parsed; null when missing or unreadable. */
    getExam,

    // --- attempt lifecycle ---------------------------------------------

    /**
     * Start an attempt. Refuses (ExamAttemptActiveError) while another is
     * active unless `{ replace: true }` — which marks every active attempt
     * `abandoned` first (single-active rule, §8.1).
     */
    async startAttempt(
      input: StartAttemptInput,
      opts: { replace?: boolean } = {},
    ): Promise<ExamAttempt> {
      const subtestIds = ExamSubtestIdsSchema.parse(input.subtestIds);
      const state = ExamAttemptStateSchema.parse(input.state);
      const now = input.now ?? Date.now();
      // T70: drill attempts (scope 'drill') are EXEMPT from the single-active
      // rule — they neither throw ExamAttemptActiveError nor abandon a mock.
      const active = input.scope === 'drill' ? [] : await activeRows();
      if (active.length > 0) {
        if (!opts.replace) throw new ExamAttemptActiveError(active[0]!.id);
        await db
          .update(examAttempts)
          .set({ status: 'abandoned', finishedAt: now })
          .where(
            inArray(
              examAttempts.id,
              active.map((a) => a.id),
            ),
          );
      }
      const row: ExamAttemptRow = {
        id: newId(),
        packId: input.packId,
        examId: input.examId,
        scope: input.scope,
        subtestIds: JSON.stringify(subtestIds),
        mode: input.mode,
        status: 'active',
        stateJson: JSON.stringify(state),
        startedAt: now,
        finishedAt: null,
        resultsJson: null,
        verdict: null,
        xpAwarded: 0,
        pinned: false,
      };
      await db.insert(examAttempts).values(row);
      return toAttempt(row);
    },

    /** Persist engine state (validated shape; throttling is the engine's job). Active attempts only. */
    async saveState(attemptId: string, state: ExamAttemptState): Promise<void> {
      await getActiveRowOrThrow(attemptId);
      const validated = ExamAttemptStateSchema.parse(state);
      await db
        .update(examAttempts)
        .set({ stateJson: JSON.stringify(validated) })
        .where(eq(examAttempts.id, attemptId));
    },

    /**
     * Upsert one response on (attemptId, subtestId, itemId) — re-answering
     * an item keeps its row id and createdAt. Active attempts only.
     */
    async recordResponse(input: RecordResponseInput): Promise<ExamResponse> {
      await getActiveRowOrThrow(input.attemptId);
      const answer = ExamAnswerSchema.parse(input.answer);
      const grading = input.grading == null ? null : ExamGradingSchema.parse(input.grading);
      const now = input.now ?? Date.now();
      const answerJson = JSON.stringify(answer);
      const gradingJson = grading === null ? null : JSON.stringify(grading);
      const rows = await db
        .insert(examResponses)
        .values({
          id: newId(),
          attemptId: input.attemptId,
          subtestId: input.subtestId,
          itemId: input.itemId,
          answerJson,
          points: input.points,
          maxPoints: input.maxPoints,
          gradingStatus: input.gradingStatus,
          gradingJson,
          durationMs: input.durationMs ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [examResponses.attemptId, examResponses.subtestId, examResponses.itemId],
          set: {
            answerJson,
            points: input.points,
            maxPoints: input.maxPoints,
            gradingStatus: input.gradingStatus,
            gradingJson,
            durationMs: input.durationMs ?? null,
            updatedAt: now,
          },
        })
        .returning();
      return toResponse(rows[0]!);
    },

    /** Finish an active attempt: results (validated), verdict (full scope), XP. */
    async finishAttempt(
      attemptId: string,
      results: ExamResults,
      verdict: ExamVerdict | null,
      xp = 0,
      now = Date.now(),
    ): Promise<ExamAttempt> {
      const row = await getActiveRowOrThrow(attemptId);
      const validated = ExamResultsSchema.parse(results);
      const patch = {
        status: 'finished' as const,
        finishedAt: now,
        resultsJson: JSON.stringify(validated),
        verdict,
        xpAwarded: Math.max(0, Math.round(xp)),
      };
      await db.update(examAttempts).set(patch).where(eq(examAttempts.id, attemptId));
      return toAttempt({ ...row, ...patch });
    },

    /**
     * Rewrite a finished attempt's results/verdict — the AI grading upgrade
     * (T72: provisional → graded) without re-finishing. No-op on missing ids.
     */
    async updateResults(
      attemptId: string,
      results: ExamResults,
      verdict: ExamVerdict | null,
    ): Promise<void> {
      const validated = ExamResultsSchema.parse(results);
      await db
        .update(examAttempts)
        .set({ resultsJson: JSON.stringify(validated), verdict })
        .where(eq(examAttempts.id, attemptId));
    },

    /**
     * T70: close every `active` DRILL attempt as `abandoned` — orphans of a
     * session the OS killed mid-drill (a drill session finishes/abandons its
     * own attempts on exit). Called once when a drill/deck/daily-segment
     * session starts. Never touches mock attempts. Returns the count.
     */
    async abandonActiveDrills(now = Date.now()): Promise<number> {
      const rows = await db
        .update(examAttempts)
        .set({ status: 'abandoned', finishedAt: now })
        .where(and(eq(examAttempts.status, 'active'), eq(examAttempts.scope, 'drill')))
        .returning({ id: examAttempts.id });
      return rows.length;
    },

    /** Abandon an active attempt (responses stay — history/readiness still read them). */
    async abandonAttempt(attemptId: string, now = Date.now()): Promise<void> {
      await getActiveRowOrThrow(attemptId);
      await db
        .update(examAttempts)
        .set({ status: 'abandoned', finishedAt: now })
        .where(eq(examAttempts.id, attemptId));
    },

    /** The one active attempt (resume), or null. */
    async getActiveAttempt(): Promise<ExamAttempt | null> {
      const rows = await activeRows();
      return rows[0] ? toAttempt(rows[0]) : null;
    },

    /** Attempts newest first; optional scope / status / exam filter. */
    async listAttempts(
      opts: {
        scope?: ExamScope;
        status?: ExamAttemptStatus;
        packId?: string;
        examId?: string;
        limit?: number;
      } = {},
    ): Promise<ExamAttempt[]> {
      const where: SQL[] = [];
      if (opts.scope) where.push(eq(examAttempts.scope, opts.scope));
      if (opts.status) where.push(eq(examAttempts.status, opts.status));
      if (opts.packId) where.push(eq(examAttempts.packId, opts.packId));
      if (opts.examId) where.push(eq(examAttempts.examId, opts.examId));
      const rows = await db
        .select()
        .from(examAttempts)
        .where(where.length > 0 ? and(...where) : undefined)
        .orderBy(desc(examAttempts.startedAt))
        .limit(opts.limit ?? 50);
      return rows.map(toAttempt);
    },

    /** One attempt + its responses (subtest, then creation order). */
    async getAttempt(attemptId: string): Promise<ExamAttemptDetail | null> {
      const row = await getAttemptRow(attemptId);
      if (!row) return null;
      const responses = await db
        .select()
        .from(examResponses)
        .where(eq(examResponses.attemptId, attemptId))
        .orderBy(asc(examResponses.subtestId), asc(examResponses.createdAt));
      return { ...toAttempt(row), responses: responses.map(toResponse) };
    },

    /** Response counts by grading status (dev readout / hub badge). */
    async countResponsesByStatus(attemptId?: string): Promise<Record<string, number>> {
      const rows = await db
        .select({ status: examResponses.gradingStatus, n: sql<number>`COUNT(*)` })
        .from(examResponses)
        .where(attemptId ? eq(examResponses.attemptId, attemptId) : undefined)
        .groupBy(examResponses.gradingStatus);
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },

    /** Pin / unpin an attempt (pinned recordings survive the prune, §8.5). */
    async setPinned(attemptId: string, pinned: boolean): Promise<void> {
      await db.update(examAttempts).set({ pinned }).where(eq(examAttempts.id, attemptId));
    },

    // --- stats + grading queue -----------------------------------------

    /**
     * Accuracy per topic over OBJECTIVE responses (choice / typed items with
     * points set) created at or after `sinceMs`. The topic and subtest kind
     * come from the item in the CURRENT exam; when a pack update removed the
     * item, from its deck card; else the response is skipped (§12).
     * `answered` counts every scored response (a recorded blank = 0 points,
     * §6.1); `correct` = full credit (points ≥ maxPoints).
     */
    async topicStats(
      opts: { sinceMs?: number; subtestKind?: ExamSubtestKind; mode?: ExamMode } = {},
    ): Promise<ExamTopicStat[]> {
      const rows = await objectiveRows(opts);
      const stats = new Map<string, ExamTopicStat>();
      for (const r of rows) {
        if (opts.subtestKind && r.kind !== opts.subtestKind) continue;
        const s = stats.get(r.topic) ?? {
          topic: r.topic,
          answered: 0,
          correct: 0,
          points: 0,
          maxPoints: 0,
        };
        s.answered += 1;
        if (r.points >= r.maxPoints - 1e-9) s.correct += 1;
        s.points += r.points;
        s.maxPoints += r.maxPoints;
        stats.set(r.topic, s);
      }
      return [...stats.values()].sort((a, b) => a.topic.localeCompare(b.topic));
    },

    /**
     * T70 readiness input (TORFL §7.4): per subtest kind, the LAST `limit`
     * (default 200) scored objective responses, newest first — `answered` +
     * `correct` (full credit). Same item/kind resolution as `topicStats`.
     */
    async recentAccuracy(
      opts: { limit?: number } = {},
    ): Promise<Partial<Record<ExamSubtestKind, { answered: number; correct: number }>>> {
      const limit = opts.limit ?? 200;
      const rows = await objectiveRows({});
      rows.sort((a, b) => b.createdAt - a.createdAt);
      const out: Partial<Record<ExamSubtestKind, { answered: number; correct: number }>> = {};
      for (const r of rows) {
        const kind = r.kind as ExamSubtestKind;
        const acc = (out[kind] ??= { answered: 0, correct: 0 });
        if (acc.answered >= limit) continue;
        acc.answered += 1;
        if (r.points >= r.maxPoints - 1e-9) acc.correct += 1;
      }
      return out;
    },

    /** The AI grading queue (§6.2, T72): `pending-ai` responses, oldest first. */
    async pendingGrading(opts: { limit?: number } = {}): Promise<PendingGradingJob[]> {
      const rows = await db
        .select({
          response: examResponses,
          packId: examAttempts.packId,
          examId: examAttempts.examId,
        })
        .from(examResponses)
        .innerJoin(examAttempts, eq(examAttempts.id, examResponses.attemptId))
        .where(eq(examResponses.gradingStatus, 'pending-ai'))
        .orderBy(asc(examResponses.updatedAt))
        .limit(opts.limit ?? 20);
      return rows.map((r) => ({ ...toResponse(r.response), packId: r.packId, examId: r.examId }));
    },

    /** One response by id (T72: the retry / self-check paths); null when missing. */
    async getResponse(responseId: string): Promise<ExamResponse | null> {
      const rows = await db
        .select()
        .from(examResponses)
        .where(eq(examResponses.id, responseId))
        .limit(1);
      return rows[0] ? toResponse(rows[0]) : null;
    },

    /**
     * T73: the exam transcode queue's rewrite of a speaking answer's
     * `recordingPath` (`t1-sp01.wav` → `.ogg`), or null once pruned (§8.5).
     * Any attempt status — the transcode finishes after the sitting. A
     * response whose answer is not a speaking answer is left alone.
     */
    async setRecordingPath(responseId: string, name: string | null): Promise<void> {
      const rows = await db
        .select()
        .from(examResponses)
        .where(eq(examResponses.id, responseId))
        .limit(1);
      const row = rows[0] ? toResponse(rows[0]) : null;
      if (!row || !row.answer || row.answer.kind === 'choice') return;
      if (row.answer.kind === 'typed' || row.answer.kind === 'writing') return;
      const answer = ExamAnswerSchema.parse({ ...row.answer, recordingPath: name });
      await db
        .update(examResponses)
        .set({ answerJson: JSON.stringify(answer) })
        .where(eq(examResponses.id, responseId));
    },

    /**
     * T73 (prune): attempts whose speaking responses still point at a
     * recording — joined to the on-disk `recordings/exam/` dirs by the prune
     * service. Mirrors `scenarios.listRunsWithLocalMedia`.
     */
    async listAttemptsWithRecordings(): Promise<ExamAttempt[]> {
      const rows = await db
        .selectDistinct({ attempt: examAttempts })
        .from(examResponses)
        .innerJoin(examAttempts, eq(examAttempts.id, examResponses.attemptId))
        .where(like(examResponses.answerJson, '%"recordingPath":"%'));
      return rows.map((r) => toAttempt(r.attempt));
    },

    /** Rows for a set of attempt ids (the prune service joins on-disk dirs to rows). */
    async getAttemptsByIds(attemptIds: string[]): Promise<ExamAttempt[]> {
      if (attemptIds.length === 0) return [];
      const rows = await db.select().from(examAttempts).where(inArray(examAttempts.id, attemptIds));
      return rows.map(toAttempt);
    },

    /** T73 (prune): every speaking response of `attemptIds` forgets its recording (rows stay). */
    async markRecordingsPruned(attemptIds: string[]): Promise<number> {
      if (attemptIds.length === 0) return 0;
      const rows = await db
        .select()
        .from(examResponses)
        .where(
          and(
            inArray(examResponses.attemptId, attemptIds),
            like(examResponses.answerJson, '%"recordingPath":"%'),
          ),
        );
      let n = 0;
      for (const row of rows) {
        const parsed = ExamAnswerSchema.safeParse(parseJsonText(row.answerJson));
        if (!parsed.success) continue;
        const a = parsed.data;
        if (a.kind === 'choice' || a.kind === 'typed' || a.kind === 'writing') continue;
        await db
          .update(examResponses)
          .set({ answerJson: JSON.stringify({ ...a, recordingPath: null }) })
          .where(eq(examResponses.id, row.id));
        n += 1;
      }
      return n;
    },

    /** Write a grading outcome onto a response (any attempt status — grading follows finishing). */
    async setGrading(
      responseId: string,
      update: {
        points: number | null;
        gradingStatus: ExamGradingStatus;
        grading: ExamGrading | null;
        now?: number;
      },
    ): Promise<ExamResponse | null> {
      const grading = update.grading === null ? null : ExamGradingSchema.parse(update.grading);
      const rows = await db
        .update(examResponses)
        .set({
          points: update.points,
          gradingStatus: update.gradingStatus,
          gradingJson: grading === null ? null : JSON.stringify(grading),
          updatedAt: update.now ?? Date.now(),
        })
        .where(eq(examResponses.id, responseId))
        .returning();
      return rows[0] ? toResponse(rows[0]) : null;
    },

    // --- the exam deck («Работа над ошибками», §7.2) ---------------------

    /** Create the item's card if missing (New, due now); returns it either way. Idempotent. */
    async ensureCard(input: EnsureCardInput): Promise<ExamItemCard> {
      const itemKey = examItemKey(input.packId, input.examId, input.itemId);
      if (input.itemKey !== undefined && input.itemKey !== itemKey) {
        throw new Error(`ensureCard: itemKey "${input.itemKey}" ≠ "${itemKey}"`);
      }
      const now = input.now ?? Date.now();
      const fsrsJson = toFsrsJson(createEmptyCard(new Date(now)));
      await db
        .insert(examItemCards)
        .values({
          itemKey,
          packId: input.packId,
          examId: input.examId,
          itemId: input.itemId,
          subtestKind: input.subtestKind,
          topic: input.topic,
          fsrsJson: JSON.stringify(fsrsJson),
          due: fsrsJson.due,
          lastResult: null,
          suspended: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      return toCard((await getCardRow(itemKey))!);
    },

    async getCard(itemKey: string): Promise<ExamItemCard | null> {
      const row = await getCardRow(itemKey);
      return row ? toCard(row) : null;
    },

    /**
     * Grade a card with ts-fsrs (the `reviews` scheduler — same params, no
     * fuzz). Again ⇒ lastResult 'wrong', else 'correct'. An unreadable FSRS
     * payload heals to a fresh card before grading. Throws on a missing key.
     */
    async gradeCard(itemKey: string, rating: Grade, now = Date.now()): Promise<ExamItemCard> {
      const row = await getCardRow(itemKey);
      if (!row) throw new Error(`gradeCard: exam card "${itemKey}" not found`);
      const current = toCard(row).fsrs;
      const base = current ? fromFsrsJson(current) : createEmptyCard(new Date(now));
      const { card: next } = reviewScheduler.next(base, new Date(now), rating);
      const fsrsJson = toFsrsJson(next);
      const patch = {
        fsrsJson: JSON.stringify(fsrsJson),
        due: fsrsJson.due,
        lastResult: rating === Rating.Again ? ('wrong' as const) : ('correct' as const),
        updatedAt: now,
      };
      await db.update(examItemCards).set(patch).where(eq(examItemCards.itemKey, itemKey));
      return toCard({ ...row, ...patch });
    },

    /** Due, non-suspended cards (most overdue first); optional subtest kind / topic filter. */
    async dueItems(
      opts: { limit?: number; now?: number; subtestKind?: string; topic?: string } = {},
    ): Promise<ExamItemCard[]> {
      const where: SQL[] = [
        eq(examItemCards.suspended, false),
        lte(examItemCards.due, opts.now ?? Date.now()),
      ];
      if (opts.subtestKind) where.push(eq(examItemCards.subtestKind, opts.subtestKind));
      if (opts.topic) where.push(eq(examItemCards.topic, opts.topic));
      const rows = await db
        .select()
        .from(examItemCards)
        .where(and(...where))
        .orderBy(asc(examItemCards.due))
        .limit(opts.limit ?? 50);
      return rows.map(toCard);
    },

    /** Deck totals: due / total (non-suspended) / suspended, plus per-topic due/total. */
    async deckCounts(now = Date.now()): Promise<ExamDeckCounts> {
      const rows = await db
        .select({
          topic: examItemCards.topic,
          suspended: examItemCards.suspended,
          n: sql<number>`COUNT(*)`,
          due: sql<number>`SUM(CASE WHEN ${examItemCards.due} <= ${now} THEN 1 ELSE 0 END)`,
        })
        .from(examItemCards)
        .groupBy(examItemCards.topic, examItemCards.suspended);
      const out: ExamDeckCounts = { due: 0, total: 0, suspended: 0, byTopic: {} };
      for (const r of rows) {
        if (r.suspended) {
          out.suspended += r.n;
          continue;
        }
        out.total += r.n;
        out.due += r.due;
        const t = (out.byTopic[r.topic] ??= { due: 0, total: 0 });
        t.total += r.n;
        t.due += r.due;
      }
      return out;
    },

    /**
     * T70 `torfl-deck-100`: non-suspended exam cards in the FSRS Review
     * state (2) — «cleared» items. Suspended cards don't count.
     */
    async countCardsInReview(): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(examItemCards)
        .where(
          and(
            eq(examItemCards.suspended, false),
            sql`json_extract(${examItemCards.fsrsJson}, '$.state') = 2`,
          ),
        );
      return rows[0]?.n ?? 0;
    },

    /** Suspend (default) or unsuspend a card; suspended cards never come due. */
    async suspendCard(itemKey: string, suspended = true, now = Date.now()): Promise<void> {
      await db
        .update(examItemCards)
        .set({ suspended, updatedAt: now })
        .where(eq(examItemCards.itemKey, itemKey));
    },

    // --- dev / tooling ---------------------------------------------------

    /**
     * DEV/TOOLING ONLY (T68 «Delete fixture», device data hygiene): delete
     * every attempt (responses cascade) and deck card that references
     * `packId`. Never called by product code — user exam history is precious.
     */
    async deleteUserRowsForPack(packId: string): Promise<{ attempts: number; cards: number }> {
      const attempts = await db
        .delete(examAttempts)
        .where(eq(examAttempts.packId, packId))
        .returning({ id: examAttempts.id });
      const cards = await db
        .delete(examItemCards)
        .where(eq(examItemCards.packId, packId))
        .returning({ k: examItemCards.itemKey });
      return { attempts: attempts.length, cards: cards.length };
    },
  };
}

export type ExamsRepo = ReturnType<typeof createExamsRepo>;
export { Rating as ExamRating };
