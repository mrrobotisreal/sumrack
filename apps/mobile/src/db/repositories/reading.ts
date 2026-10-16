import { and, eq, sql } from 'drizzle-orm';

import { resolveContinueTarget, type ContinueTarget } from '@/features/reader/continue-target';

import { stories, storyProgress } from '../schema';
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

    /**
     * Upsert the reading position; never touches finishedAt.
     *
     * T30.2 never-regress rule: the saved index only ever moves forward —
     * `max(saved, incoming)`, applied atomically in SQL. A short revisit
     * (open → leave) can no longer wipe a saved position (CT002b's 5→0).
     * Deliberately unconditional (finished rows too): the index is
     * display/eligibility-only once finished, and a "start over" reset is
     * a separate future affordance, not a lower save.
     */
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
          set: {
            currentSentenceIdx: sql`max(${storyProgress.currentSentenceIdx}, ${sentenceIdx})`,
            updatedAt: now,
          },
        });
    },

    /**
     * The «Continue reading» target (T40 widget, T84 rule): what Mitch LAST
     * READ — resume it, or once it is finished the next story of its pack —
     * via the pure `resolveContinueTarget` (shared with Today's card).
     */
    async getContinueTarget(): Promise<ContinueTarget | null> {
      const [progress, storyRows] = await Promise.all([
        db
          .select({
            packId: storyProgress.packId,
            storyId: storyProgress.storyId,
            updatedAt: storyProgress.updatedAt,
            finishedAt: storyProgress.finishedAt,
          })
          .from(storyProgress),
        db
          .select({
            packId: stories.packId,
            id: stories.id,
            orderIdx: stories.orderIdx,
            titleRu: stories.titleRu,
          })
          .from(stories),
      ]);
      // T86 series step: the widget shares Today's rule, so it needs the packs'
      // series placement too (tags + level).
      const packRows = await db
        .select({ id: packs.id, tags: packs.tags, level: packs.level })
        .from(packs);
      const placements = new Map<string, { series: string; chapter: number; level: string }>();
      for (const pack of packRows) {
        const placed = parseSeriesTags(pack.tags);
        if (placed) placements.set(pack.id, { series: placed.series, chapter: placed.chapter, level: pack.level });
      }
      return resolveContinueTarget(progress, storyRows, (packId) => placements.get(packId) ?? null);
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
