import { and, asc, eq, lte, sql } from 'drizzle-orm';

import { newId } from '../ids';
import { cards, reviewLog, type CardDirection } from '../schema';
import type { SumrakDB } from '../types';

export type CardRow = typeof cards.$inferSelect;
export type ReviewLogRow = typeof reviewLog.$inferSelect;

export const ALL_DIRECTIONS: CardDirection[] = ['ru-en', 'en-ru', 'listening', 'production'];

/**
 * FSRS storage (tables + shapes only — scheduling logic is T06). Card
 * columns mirror ts-fsrs's `Card` 1:1; new cards start in State.New (0)
 * with due = now, which is exactly what ts-fsrs's createEmptyCard()
 * produces, so T06 can hydrate rows straight into the scheduler.
 */
export function createReviewsRepo(db: SumrakDB) {
  return {
    /** Create missing cards for a bank item (idempotent per direction). */
    async ensureCards(
      bankItemId: string,
      directions: CardDirection[] = ['ru-en', 'en-ru'],
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

    async getCard(bankItemId: string, direction: CardDirection): Promise<CardRow | null> {
      const rows = await db
        .select()
        .from(cards)
        .where(and(eq(cards.bankItemId, bankItemId), eq(cards.direction, direction)))
        .limit(1);
      return rows[0] ?? null;
    },

    async listCardsForItem(bankItemId: string): Promise<CardRow[]> {
      return db.select().from(cards).where(eq(cards.bankItemId, bankItemId));
    },

    /** Cards due at or before `now` — the T06 daily-queue source. */
    async listDueCards(now: number = Date.now(), limit = 100): Promise<CardRow[]> {
      return db
        .select()
        .from(cards)
        .where(lte(cards.dueAt, now))
        .orderBy(asc(cards.dueAt))
        .limit(limit);
    },

    async countDueCards(now: number = Date.now()): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(cards)
        .where(lte(cards.dueAt, now));
      return rows[0]?.n ?? 0;
    },

    /** Persist post-review FSRS state (T06 writes what ts-fsrs computed). */
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
  };
}

export type ReviewsRepo = ReturnType<typeof createReviewsRepo>;
