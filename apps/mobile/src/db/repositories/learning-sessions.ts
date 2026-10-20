import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { gameSessions } from '../schema';
import type { SumrakDB } from '../types';

const CompletedSessionSchema = z
  .strictObject({
    id: z.string().min(1),
    mode: z.string().min(1),
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    itemCount: z.number().int().nonnegative(),
    correctCount: z.number().int().nonnegative(),
    detail: z.record(z.string(), z.json()),
  })
  .refine((row) => row.endedAt >= row.startedAt && row.correctCount <= row.itemCount);

export type CompletedLearningSession = z.input<typeof CompletedSessionSchema>;

/**
 * M30 final attempts are inserted once, fully populated. game_sessions is
 * append-only in account sync: start→update would race an early upload.
 * Drafts stay device-local. An identical retry is harmless; a conflicting
 * reuse of an attempt id is rejected rather than rewriting user history.
 */
export function createLearningSessionsRepo(db: SumrakDB) {
  return {
    async recordCompleted(input: CompletedLearningSession): Promise<void> {
      const row = CompletedSessionSchema.parse(input);
      await db.insert(gameSessions).values(row).onConflictDoNothing();
      const [saved] = await db.select().from(gameSessions).where(eq(gameSessions.id, row.id));
      if (
        !saved ||
        saved.mode !== row.mode ||
        saved.startedAt !== row.startedAt ||
        saved.endedAt !== row.endedAt ||
        saved.itemCount !== row.itemCount ||
        saved.correctCount !== row.correctCount ||
        JSON.stringify(saved.detail) !== JSON.stringify(row.detail)
      ) {
        throw new Error('This attempt has already been saved with different results.');
      }
    },
    async list(mode: string, limit = 100) {
      return db
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.mode, mode))
        .orderBy(desc(gameSessions.startedAt), desc(gameSessions.id))
        .limit(Math.max(1, Math.min(10000, Math.floor(limit))));
    },
  };
}
