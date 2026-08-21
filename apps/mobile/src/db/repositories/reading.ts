import { and, eq } from 'drizzle-orm';

import { storyProgress } from '../schema';
import type { SumrakDB } from '../types';

export type StoryProgressRow = typeof storyProgress.$inferSelect;

export type ReadState = 'unread' | 'in-progress' | 'finished';

/** Derive the library read-state indicator from a progress row (or none). */
export function readStateOf(row: StoryProgressRow | null | undefined): ReadState {
  if (!row) return 'unread';
  return row.finishedAt != null ? 'finished' : 'in-progress';
}

/**
 * Reading progress per story (T04): position auto-save/restore and the
 * finished-story fact the Library indicator and later progress/path
 * tickets (T17/T18) read.
 */
export function createReadingRepo(db: SumrakDB) {
  return {
    async getProgress(packId: string, storyId: string): Promise<StoryProgressRow | null> {
      const rows = await db
        .select()
        .from(storyProgress)
        .where(and(eq(storyProgress.packId, packId), eq(storyProgress.storyId, storyId)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** All progress rows — the Library joins these onto its story list. */
    async listProgress(): Promise<StoryProgressRow[]> {
      return db.select().from(storyProgress);
    },

    /** Upsert the reading position; never touches finishedAt. */
    async savePosition(packId: string, storyId: string, sentenceIdx: number): Promise<void> {
      const now = Date.now();
      await db
        .insert(storyProgress)
        .values({
          packId,
          storyId,
          currentSentenceIdx: sentenceIdx,
          startedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [storyProgress.packId, storyProgress.storyId],
          set: { currentSentenceIdx: sentenceIdx, updatedAt: now },
        });
    },

    /** Idempotent — returns true only on the first finish (for stats/analytics). */
    async markFinished(packId: string, storyId: string): Promise<boolean> {
      const now = Date.now();
      const existing = await this.getProgress(packId, storyId);
      if (existing?.finishedAt != null) return false;
      await db
        .insert(storyProgress)
        .values({
          packId,
          storyId,
          currentSentenceIdx: 0,
          startedAt: now,
          updatedAt: now,
          finishedAt: now,
        })
        .onConflictDoUpdate({
          target: [storyProgress.packId, storyProgress.storyId],
          set: { finishedAt: now, updatedAt: now },
        });
      return true;
    },
  };
}

export type ReadingRepo = ReturnType<typeof createReadingRepo>;
