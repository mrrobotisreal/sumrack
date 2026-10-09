import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';

import { dailyQuests, gameSessions } from '../schema';
import type { SumrakDB } from '../types';

export type DailyQuestRow = typeof dailyQuests.$inferSelect;

/** Day window in epoch ms ([start, end)) — the caller computes it from the local day key. */
export interface DayWindow {
  start: number;
  end: number;
}

/**
 * The daily quest slot's data (T34, V2 §7.10): the per-day `daily_quests`
 * row and the read-only counters every quest kind measures progress with.
 * Every counter reads EXISTING tables over the local-day window — quests add
 * no write path to any other feature (recorded decision). The pure kind
 * registry lives in features/motivation/quests.ts.
 */
export function createQuestsRepo(db: SumrakDB) {
  return {
    async get(date: string): Promise<DailyQuestRow | null> {
      const rows = await db.select().from(dailyQuests).where(eq(dailyQuests.date, date)).limit(1);
      return rows[0] ?? null;
    },

    /**
     * Insert the day's quest if none exists (the pick is deterministic, so a
     * race between two evaluations inserts the same row). Returns the row
     * now stored and whether THIS call created it.
     */
    async assign(row: {
      date: string;
      kind: string;
      target: number;
      snapshot: string[] | null;
      assignedAt: number;
    }): Promise<{ row: DailyQuestRow; created: boolean }> {
      const inserted = await db
        .insert(dailyQuests)
        .values({ ...row, progress: 0, completedAt: null, xp: 0 })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return { row: inserted[0], created: true };
      const existing = await this.get(row.date);
      if (!existing) throw new Error(`quests.assign: no row for ${row.date}`);
      return { row: existing, created: false };
    },

    async setProgress(date: string, progress: number): Promise<void> {
      await db.update(dailyQuests).set({ progress }).where(eq(dailyQuests.date, date));
    },

    /** Stamp completion once; returns true only when THIS call stamped it. */
    async markCompleted(date: string, progress: number, xp: number, now: number): Promise<boolean> {
      const updated = await db
        .update(dailyQuests)
        .set({ progress, completedAt: now, xp })
        .where(and(eq(dailyQuests.date, date), sql`${dailyQuests.completedAt} IS NULL`))
        .returning({ date: dailyQuests.date });
      return updated.length > 0;
    },

    /** Recent quests, newest first (yesterday's kind for the no-repeat rule). */
    async listRecent(limit = 7): Promise<DailyQuestRow[]> {
      return db
        .select()
        .from(dailyQuests)
        .orderBy(sql`${dailyQuests.date} DESC`)
        .limit(limit);
    },

    // --- counters (read-only, existing tables) ---------------------------

    /** Stories finished for the first time inside the window (story_progress.finished_at). */
    async countStoriesFinished(w: DayWindow): Promise<number> {
      const rows = await db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM story_progress
        WHERE finished_at >= ${w.start} AND finished_at < ${w.end}
      `);
      return rows[0]?.n ?? 0;
    },

    /** Installed stories (any pack) never finished — finish-a-story's availability. */
    async countUnfinishedStories(): Promise<number> {
      const rows = await db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM stories s
        LEFT JOIN story_progress p ON p.pack_id = s.pack_id AND p.story_id = s.id
        WHERE p.finished_at IS NULL
      `);
      return rows[0]?.n ?? 0;
    },

    /** Journal entries created inside the window. */
    async countJournalEntries(w: DayWindow): Promise<number> {
      const rows = await db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM journal_entries
        WHERE created_at >= ${w.start} AND created_at < ${w.end}
      `);
      return rows[0]?.n ?? 0;
    },

    /** Pronunciation grades inside the window (review_log.source = 'pronunciation'). */
    async countPronunciationGrades(w: DayWindow): Promise<number> {
      const rows = await db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM review_log
        WHERE source = 'pronunciation' AND reviewed_at >= ${w.start} AND reviewed_at < ${w.end}
      `);
      return rows[0]?.n ?? 0;
    },

    /** Production-direction cards that exist (the pronunciation game has something to serve). */
    async countProductionCards(): Promise<number> {
      const rows = await db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM cards
        WHERE direction = 'production' AND suspended_at IS NULL
      `);
      return rows[0]?.n ?? 0;
    },

    /**
     * Finished game sessions of a mode inside the window. `completedOnly`
     * filters on `detail.completed` (numbers / blitz record it) so a quit
     * round never satisfies a quest.
     */
    async countFinishedSessions(
      mode: string,
      w: DayWindow,
      opts: { completedOnly?: boolean } = {},
    ): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(gameSessions)
        .where(
          and(
            eq(gameSessions.mode, mode),
            isNotNull(gameSessions.endedAt),
            gte(gameSessions.endedAt, w.start),
            lt(gameSessions.endedAt, w.end),
            opts.completedOnly
              ? sql`json_extract(${gameSessions.detail}, '$.completed') = 1`
              : undefined,
          ),
        );
      return rows[0]?.n ?? 0;
    },
  };
}

export type QuestsRepo = ReturnType<typeof createQuestsRepo>;
