import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';

import { newId } from '../ids';
import { bankItems, cards, reviewLog, type CardDirection } from '../schema';
import type { SumrakDB } from '../types';

export type CardRow = typeof cards.$inferSelect;
export type ReviewLogRow = typeof reviewLog.$inferSelect;

export const ALL_DIRECTIONS: CardDirection[] = ['ru-en', 'en-ru', 'listening', 'production'];

/**
 * Directions that actually schedule today. T06 decision (recorded in the
 * ticket): listening/production card rows are NOT created dormant — they are
 * created by T14/T12 when those game modes land, by adding the direction
 * here and letting `ensureCards`/`backfillCards` (both idempotent) fill the
 * gap. Keeping the rows absent means due queries and counts need no
 * direction filtering to stay honest.
 */
export const ACTIVE_DIRECTIONS: CardDirection[] = ['ru-en', 'en-ru'];

/**
 * One shared scheduler, default FSRS-5 parameters (no fuzz — single user,
 * no need to de-synchronize siblings). If parameters ever become tunable
 * (settings), this is the only construction site.
 */
const scheduler = fsrs(generatorParameters());

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
      let created = 0;
      for (const item of items) {
        for (const direction of directions) {
          if (have.has(`${item.id}:${direction}`)) continue;
          await db.insert(cards).values({
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
          });
          created += 1;
        }
      }
      return created;
    },

    async getCard(bankItemId: string, direction: CardDirection): Promise<CardRow | null> {
      const rows = await db
        .select()
        .from(cards)
        .where(and(eq(cards.bankItemId, bankItemId), eq(cards.direction, direction)))
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
        .where(and(lte(cards.dueAt, now), inArray(cards.direction, directions)))
        .orderBy(asc(cards.dueAt))
        .limit(limit);
    },

    async countDueCards(query: Omit<DueQuery, 'limit'> = {}): Promise<number> {
      const { now = Date.now(), directions = ACTIVE_DIRECTIONS } = query;
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(cards)
        .where(and(lte(cards.dueAt, now), inArray(cards.direction, directions)));
      return rows[0]?.n ?? 0;
    },

    /**
     * The review pipeline's single write path: run ts-fsrs on the card for
     * `rating`, persist the rescheduled card, and append the full
     * ts-fsrs-native log entry (design §5 — never a lossy summary).
     */
    async gradeCard(
      cardId: string,
      rating: Grade,
      opts: { now?: number; durationMs?: number } = {},
    ): Promise<GradeResult> {
      const rows = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
      const row = rows[0];
      if (!row) throw new Error(`gradeCard: card ${cardId} not found`);
      const now = opts.now ?? Date.now();

      const { card: next, log } = scheduler.next(cardRowToFsrs(row), new Date(now), rating);

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
      };
      await db.insert(reviewLog).values(logRow);

      return { card: updated, log: logRow };
    },

    /** Persist post-review FSRS state directly (tests/tooling; games use gradeCard). */
    async saveCard(card: CardRow): Promise<void> {
      const { id, ...rest } = card;
      await db.update(cards).set(rest).where(eq(cards.id, id));
    },

    async appendReviewLog(entry: Omit<ReviewLogRow, 'id'>): Promise<ReviewLogRow> {
      const row = { id: newId(), ...entry };
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
