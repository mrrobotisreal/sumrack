import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';

import { startOfNextLocalDay } from '@/lib/dates';

import { newId } from '../ids';
import { bankItems, cards, reviewLog, type CardDirection, type ReviewSource } from '../schema';
import type { SumrakDB } from '../types';

export type CardRow = typeof cards.$inferSelect;
export type ReviewLogRow = typeof reviewLog.$inferSelect;

export const ALL_DIRECTIONS: CardDirection[] = ['ru-en', 'en-ru', 'listening', 'production'];

/**
 * Directions that actually schedule today. T06 decision (recorded in the
 * ticket): listening/production card rows are NOT created dormant — they are
 * created by T14/T12 when those game modes land, by adding the direction
 * here and letting `ensureCards`/`backfillCards` (both idempotent) fill the
 * gap. T12 activated `production` (pronunciation game); T14 activated
 * `listening` (listening quiz).
 */
export const ACTIVE_DIRECTIONS: CardDirection[] = ['ru-en', 'en-ru', 'production', 'listening'];

/**
 * Directions the T06 standalone flashcard/MC session serves. `production`
 * and `listening` are deliberately NOT here: a flip-card can't train either
 * skill, so those cards are due only to the game that can (pronunciation /
 * listening quiz — both also folded into the T14 daily session).
 */
export const MIXED_SESSION_DIRECTIONS: CardDirection[] = ['ru-en', 'en-ru'];

/**
 * Directions the T14 unified daily session serves — everything except
 * `production`, which stays with the separate pronunciation entry (mic
 * setup, ASR model gate, and room acoustics make it a deliberate act, not
 * something to spring mid-session). Today's headline due count uses this.
 */
export const UNIFIED_SESSION_DIRECTIONS: CardDirection[] = ['ru-en', 'en-ru', 'listening'];

/**
 * T39: the scheduler's tunable inputs. `desiredRetention` is the target
 * recall probability (the 0.8–0.95 band lives in features/review/fsrs-settings);
 * `w` is an FSRS-6 parameter vector (21 numbers, ts-fsrs 5.x) or null for ts-fsrs defaults.
 */
export interface SchedulerConfig {
  desiredRetention: number;
  w: number[] | null;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = { desiredRetention: 0.9, w: null };

/**
 * Build an FSRS scheduler for `config`. Fuzz stays off (ts-fsrs default) —
 * single user, no need to de-synchronize siblings.
 */
export function buildScheduler(config: SchedulerConfig) {
  return fsrs(
    generatorParameters({
      request_retention: config.desiredRetention,
      ...(config.w ? { w: config.w } : {}),
    }),
  );
}

/**
 * T39: the one live scheduler. Replaced by `configureReviewScheduler` when the
 * user changes desired retention or imports optimizer parameters. Still the
 * ONLY construction site (see `buildScheduler`). Read it through
 * `getReviewScheduler()` — `exams` (ADR-0020 decision 5) schedules with the
 * same instance so the exam deck and the review queue stay in step.
 */
let currentScheduler = buildScheduler(DEFAULT_SCHEDULER_CONFIG);

export function configureReviewScheduler(config: SchedulerConfig): void {
  currentScheduler = buildScheduler(config);
}

export function getReviewScheduler() {
  return currentScheduler;
}

/**
 * T39: a card a queue may serve at `now` — not suspended, not buried past now.
 * The ONE exclusion predicate; every card-sourcing query uses it (directly or
 * through `servableSql`). `getCard`/`listCardsForItem` stay unfiltered.
 */
export function servableAt(now: number) {
  return and(isNull(cards.suspendedAt), or(isNull(cards.buriedUntil), lte(cards.buriedUntil, now)));
}

/**
 * T39: raw-SQL twin of `servableAt` for `sql\`\`` queries (dashboard, path).
 * `alias` is the cards table alias in the query (e.g. `c`) — restricted to
 * plain identifiers, so it is never user input.
 */
export function servableSql(alias: string, now: number): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`servableSql: bad alias ${alias}`);
  const a = sql.raw(alias);
  return sql`${a}.suspended_at IS NULL AND (${a}.buried_until IS NULL OR ${a}.buried_until <= ${now})`;
}

export { Rating, State };
export type { Grade };

/** Hydrate a DB row into the ts-fsrs Card structure (columns mirror it 1:1). */
export function cardRowToFsrs(row: CardRow): FsrsCard {
  return {
    due: new Date(row.dueAt),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.lastReviewAt != null ? new Date(row.lastReviewAt) : undefined,
  };
}

export interface DueQuery {
  now?: number;
  limit?: number;
  /** Defaults to ACTIVE_DIRECTIONS; pass explicitly to widen (T12/T14). */
  directions?: CardDirection[];
}

export interface GradeResult {
  card: CardRow;
  log: ReviewLogRow;
}

/**
 * FSRS scheduling: card lifecycle per (bankItem × direction), the due
 * queue, grading, and the append-only review log. This is the pipeline six
 * later tickets (T12–T14, T17–T19) call into — game modes differ only in
 * how they arrive at a `Grade`.
 */
export function createReviewsRepo(db: SumrakDB) {
  return {
    /** Create missing cards for a bank item (idempotent per direction). */
    async ensureCards(
      bankItemId: string,
      directions: CardDirection[] = ACTIVE_DIRECTIONS,
    ): Promise<CardRow[]> {
      const now = Date.now();
      const existing = await db.select().from(cards).where(eq(cards.bankItemId, bankItemId));
      const have = new Set(existing.map((c) => c.direction));
      for (const direction of directions) {
        if (have.has(direction)) continue;
        await db.insert(cards).values({
          id: newId(),
          bankItemId,
          direction,
          dueAt: now,
          stability: 0,
          difficulty: 0,
          elapsedDays: 0,
          scheduledDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          state: 0,
          lastReviewAt: null,
          createdAt: now,
        });
      }
      return db.select().from(cards).where(eq(cards.bankItemId, bankItemId));
    },

    /**
     * Create missing ACTIVE_DIRECTIONS cards for every bank item — heals
     * items created before T06 (or before a direction activates). Runs each
     * bootstrap; O(bank size), cheap at single-user scale.
     */
    async backfillCards(directions: CardDirection[] = ACTIVE_DIRECTIONS): Promise<number> {
      const items = await db.select({ id: bankItems.id }).from(bankItems);
      const existing = await db
        .select({ bankItemId: cards.bankItemId, direction: cards.direction })
        .from(cards);
      const have = new Set(existing.map((c) => `${c.bankItemId}:${c.direction}`));
      const now = Date.now();
      // T22: batched inserts (chunks of 50) instead of one round trip per
      // card — this runs every bootstrap and used to issue N sequential
      // INSERTs whenever a direction activated across the whole bank.
      const missing = items.flatMap((item) =>
        directions
          .filter((direction) => !have.has(`${item.id}:${direction}`))
          .map((direction) => ({
            id: newId(),
            bankItemId: item.id,
            direction,
            dueAt: now,
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            learningSteps: 0,
            reps: 0,
            lapses: 0,
            state: 0,
            lastReviewAt: null,
            createdAt: now,
          })),
      );
      for (let i = 0; i < missing.length; i += 50) {
        await db.insert(cards).values(missing.slice(i, i + 50));
      }
      return missing.length;
    },

    async getCard(bankItemId: string, direction: CardDirection): Promise<CardRow | null> {
      const rows = await db
        .select()
        .from(cards)
        .where(and(eq(cards.bankItemId, bankItemId), eq(cards.direction, direction)))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * T39: the card a game may GRADE, or null when it is suspended. Buried
     * cards are still gradable — bury is only a queue filter (a buried card
     * answered elsewhere still learns). Use this at every grading call site
     * that resolves a card from a bank item, so a suspended item is never rated.
     */
    async getGradableCard(bankItemId: string, direction: CardDirection): Promise<CardRow | null> {
      const rows = await db
        .select()
        .from(cards)
        .where(
          and(
            eq(cards.bankItemId, bankItemId),
            eq(cards.direction, direction),
            isNull(cards.suspendedAt),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async getCardById(cardId: string): Promise<CardRow | null> {
      const rows = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
      return rows[0] ?? null;
    },

    async listCardsForItem(bankItemId: string): Promise<CardRow[]> {
      return db.select().from(cards).where(eq(cards.bankItemId, bankItemId));
    },

    /** Cards due at or before `now`, most-overdue first — the session source. */
    async listDueCards(query: DueQuery = {}): Promise<CardRow[]> {
      const { now = Date.now(), limit = 100, directions = ACTIVE_DIRECTIONS } = query;
      return db
        .select()
        .from(cards)
        .where(and(lte(cards.dueAt, now), inArray(cards.direction, directions), servableAt(now)))
        .orderBy(asc(cards.dueAt))
        .limit(limit);
    },

    /**
     * Not-yet-due cards, weakest (lowest stability) first — T13's standalone
     * games top up with these when the due queue alone can't fill a session
     * (design §7.3: cloze targets "due/weak lemmas"). Practicing ahead of
     * schedule is free extra signal for FSRS, never harm.
     */
    async listWeakestCards(query: DueQuery = {}): Promise<CardRow[]> {
      const { now = Date.now(), limit = 100, directions = ACTIVE_DIRECTIONS } = query;
      return db
        .select()
        .from(cards)
        .where(and(gt(cards.dueAt, now), inArray(cards.direction, directions), servableAt(now)))
        .orderBy(asc(cards.stability), asc(cards.dueAt))
        .limit(limit);
    },

    /**
     * Every card for a specific set of bank items (T18 "practice now"
     * focused sessions): due-agnostic — a weak lemma the dashboard flags
     * may not be due yet, and practicing ahead is free FSRS signal (the
     * T13 listWeakestCards rationale). Due cards first, then weakest.
     */
    async listCardsForItems(
      bankItemIds: string[],
      directions: CardDirection[] = ACTIVE_DIRECTIONS,
      now: number = Date.now(),
    ): Promise<CardRow[]> {
      if (bankItemIds.length === 0) return [];
      return db
        .select()
        .from(cards)
        .where(
          and(
            inArray(cards.bankItemId, bankItemIds),
            inArray(cards.direction, directions),
            servableAt(now),
          ),
        )
        .orderBy(
          sql`CASE WHEN ${cards.dueAt} <= ${now} THEN 0 ELSE 1 END`,
          asc(cards.stability),
          asc(cards.dueAt),
        )
        .limit(200);
    },

    /**
     * Word lemmas in the T18 "mature" mastery band: MIN stability across the
     * item's *reviewed* core-direction cards (ru-en/en-ru — the directions
     * that vouch for knowing a word, T18 decision) ≥ `minStabilityDays`.
     * Feeds the mastered-100 achievement (T19).
     *
     * T39 decision: suspension is a scheduling state, not knowledge, so this
     * count (and the bank/path/coverage stat counts) deliberately IGNORES
     * suspended and buried cards.
     */
    async countMasteredLemmas(minStabilityDays = 30): Promise<number> {
      const rows = await db.select({ n: sql<number>`COUNT(*)` }).from(
        db
          .select({ bankItemId: cards.bankItemId })
          .from(cards)
          .innerJoin(bankItems, eq(bankItems.id, cards.bankItemId))
          .where(
            and(
              eq(bankItems.kind, 'word'),
              inArray(cards.direction, MIXED_SESSION_DIRECTIONS),
              gt(cards.reps, 0),
            ),
          )
          .groupBy(cards.bankItemId)
          .having(sql`MIN(${cards.stability}) >= ${minStabilityDays}`)
          .as('mastered'),
      );
      return rows[0]?.n ?? 0;
    },

    async countDueCards(query: Omit<DueQuery, 'limit'> = {}): Promise<number> {
      const { now = Date.now(), directions = ACTIVE_DIRECTIONS } = query;
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(cards)
        .where(and(lte(cards.dueAt, now), inArray(cards.direction, directions), servableAt(now)));
      return rows[0]?.n ?? 0;
    },

    /**
     * The review pipeline's single write path: run ts-fsrs on the card for
     * `rating`, persist the rescheduled card, and append the full
     * ts-fsrs-native log entry (design §5 — never a lossy summary).
     * `source` (T50) records which activity produced the grade; omitted →
     * NULL, the same shape as every pre-T50 row.
     */
    async gradeCard(
      cardId: string,
      rating: Grade,
      opts: { now?: number; durationMs?: number; source?: ReviewSource } = {},
    ): Promise<GradeResult> {
      const rows = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
      const row = rows[0];
      if (!row) throw new Error(`gradeCard: card ${cardId} not found`);
      const now = opts.now ?? Date.now();

      const { card: next, log } = getReviewScheduler().next(
        cardRowToFsrs(row),
        new Date(now),
        rating,
      );

      const updated: CardRow = {
        ...row,
        dueAt: next.due.getTime(),
        stability: next.stability,
        difficulty: next.difficulty,
        elapsedDays: next.elapsed_days,
        scheduledDays: next.scheduled_days,
        learningSteps: next.learning_steps,
        reps: next.reps,
        lapses: next.lapses,
        state: next.state,
        lastReviewAt: next.last_review ? next.last_review.getTime() : now,
      };
      const { id, ...patch } = updated;
      await db.update(cards).set(patch).where(eq(cards.id, id));

      const logRow: ReviewLogRow = {
        id: newId(),
        cardId,
        rating: log.rating,
        state: log.state,
        dueAt: log.due.getTime(),
        stability: log.stability,
        difficulty: log.difficulty,
        elapsedDays: log.elapsed_days,
        lastElapsedDays: log.last_elapsed_days,
        scheduledDays: log.scheduled_days,
        learningSteps: log.learning_steps,
        reviewedAt: log.review.getTime(),
        durationMs: opts.durationMs ?? null,
        source: opts.source ?? null,
      };
      await db.insert(reviewLog).values(logRow);

      return { card: updated, log: logRow };
    },

    /**
     * T39 card management. Suspend = never served, never graded (see
     * `getGradableCard`); unsuspend restores it. Scheduling state only — the
     * review log and mastery counts are untouched.
     */
    async suspendCard(cardId: string, now: number = Date.now()): Promise<void> {
      await db.update(cards).set({ suspendedAt: now }).where(eq(cards.id, cardId));
    },

    async unsuspendCard(cardId: string): Promise<void> {
      await db.update(cards).set({ suspendedAt: null }).where(eq(cards.id, cardId));
    },

    /** T39: hide the card from queues until the start of the next local day. */
    async buryUntilTomorrow(cardId: string, now: number = Date.now()): Promise<void> {
      await db
        .update(cards)
        .set({ buriedUntil: startOfNextLocalDay(now) })
        .where(eq(cards.id, cardId));
    },

    async unburyCard(cardId: string): Promise<void> {
      await db.update(cards).set({ buriedUntil: null }).where(eq(cards.id, cardId));
    },

    /**
     * T39: reset the card's FSRS state to New, due now. `suspendedAt` is kept
     * (a suspended card stays suspended), buriedUntil is cleared, and the
     * `review_log` is UNTOUCHED — history is preserved and still feeds
     * leeches, familiarity and the optimizer export. Returns the updated row.
     */
    async resetCard(cardId: string, now: number = Date.now()): Promise<CardRow> {
      await db
        .update(cards)
        .set({
          state: 0,
          dueAt: now,
          stability: 0,
          difficulty: 0,
          elapsedDays: 0,
          scheduledDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          lastReviewAt: null,
          buriedUntil: null,
        })
        .where(eq(cards.id, cardId));
      const rows = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
      const row = rows[0];
      if (!row) throw new Error(`resetCard: card ${cardId} not found`);
      return row;
    },

    /**
     * Every review_log row with its card's direction and bank item, ordered by
     * card then time — the optimizer export's input (T39).
     */
    async listAllReviewLog(): Promise<
      {
        cardId: string;
        bankItemId: string;
        direction: CardDirection;
        rating: number;
        state: number;
        reviewedAt: number;
        durationMs: number | null;
      }[]
    > {
      return db
        .select({
          cardId: reviewLog.cardId,
          bankItemId: cards.bankItemId,
          direction: cards.direction,
          rating: reviewLog.rating,
          state: reviewLog.state,
          reviewedAt: reviewLog.reviewedAt,
          durationMs: reviewLog.durationMs,
        })
        .from(reviewLog)
        .innerJoin(cards, eq(cards.id, reviewLog.cardId))
        .orderBy(asc(reviewLog.cardId), asc(reviewLog.reviewedAt));
    },

    /** Persist post-review FSRS state directly (tests/tooling; games use gradeCard). */
    async saveCard(card: CardRow): Promise<void> {
      const { id, ...rest } = card;
      await db.update(cards).set(rest).where(eq(cards.id, id));
    },

    /** Tests/tooling; `source` defaults to NULL like a pre-T50 row. */
    async appendReviewLog(
      entry: Omit<ReviewLogRow, 'id' | 'source'> & { source?: ReviewSource | null },
    ): Promise<ReviewLogRow> {
      const row: ReviewLogRow = { id: newId(), ...entry, source: entry.source ?? null };
      await db.insert(reviewLog).values(row);
      return row;
    },

    async listReviewLog(cardId: string): Promise<ReviewLogRow[]> {
      return db
        .select()
        .from(reviewLog)
        .where(eq(reviewLog.cardId, cardId))
        .orderBy(asc(reviewLog.reviewedAt));
    },

    /** Full history across all of an item's directions, newest first (card detail). */
    async listReviewLogForItem(bankItemId: string, limit = 50): Promise<ReviewLogRow[]> {
      const itemCards = await db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.bankItemId, bankItemId));
      if (itemCards.length === 0) return [];
      return db
        .select()
        .from(reviewLog)
        .where(
          inArray(
            reviewLog.cardId,
            itemCards.map((c) => c.id),
          ),
        )
        .orderBy(desc(reviewLog.reviewedAt))
        .limit(limit);
    },
  };
}

export type ReviewsRepo = ReturnType<typeof createReviewsRepo>;
