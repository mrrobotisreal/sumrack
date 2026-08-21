import { desc, eq, gte, sql } from 'drizzle-orm';

import { newId } from '../ids';
import {
  achievements,
  analyticsEvents,
  assessments,
  checkpointResults,
  dailyActivity,
  gameSessions,
} from '../schema';
import type { SumrakDB } from '../types';

export type DailyActivityRow = typeof dailyActivity.$inferSelect;
export type GameSessionRow = typeof gameSessions.$inferSelect;

/** Local date key for daily_activity, device timezone: 'YYYY-MM-DD'. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Activity counters, game sessions, checkpoints, assessments, achievements,
 * and the local analytics event log. Downstream shapes (T13–T19) stay
 * minimal here — tables exist so later tickets aren't blocked on migrations.
 */
export function createStatsRepo(db: SumrakDB) {
  return {
    /** Increment today's counters (upsert). */
    async bumpDailyActivity(
      delta: { reviewsDone?: number; readingMs?: number; storiesFinished?: number },
      date: string = localDateKey(),
    ): Promise<void> {
      const now = Date.now();
      await db
        .insert(dailyActivity)
        .values({
          date,
          reviewsDone: delta.reviewsDone ?? 0,
          readingMs: delta.readingMs ?? 0,
          storiesFinished: delta.storiesFinished ?? 0,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: dailyActivity.date,
          set: {
            reviewsDone: sql`${dailyActivity.reviewsDone} + ${delta.reviewsDone ?? 0}`,
            readingMs: sql`${dailyActivity.readingMs} + ${delta.readingMs ?? 0}`,
            storiesFinished: sql`${dailyActivity.storiesFinished} + ${delta.storiesFinished ?? 0}`,
            updatedAt: now,
          },
        });
    },

    async getDailyActivity(date: string = localDateKey()): Promise<DailyActivityRow | null> {
      const rows = await db
        .select()
        .from(dailyActivity)
        .where(eq(dailyActivity.date, date))
        .limit(1);
      return rows[0] ?? null;
    },

    async listDailyActivitySince(fromDate: string): Promise<DailyActivityRow[]> {
      return db
        .select()
        .from(dailyActivity)
        .where(gte(dailyActivity.date, fromDate))
        .orderBy(desc(dailyActivity.date));
    },

    async startGameSession(mode: string): Promise<GameSessionRow> {
      const row: typeof gameSessions.$inferInsert = {
        id: newId(),
        mode,
        startedAt: Date.now(),
        endedAt: null,
        itemCount: 0,
        correctCount: 0,
        detail: null,
      };
      await db.insert(gameSessions).values(row);
      return row as GameSessionRow;
    },

    async finishGameSession(
      id: string,
      result: { itemCount: number; correctCount: number; detail?: Record<string, unknown> },
    ): Promise<void> {
      await db
        .update(gameSessions)
        .set({
          endedAt: Date.now(),
          itemCount: result.itemCount,
          correctCount: result.correctCount,
          detail: result.detail ?? null,
        })
        .where(eq(gameSessions.id, id));
    },

    async listGameSessions(limit = 100): Promise<GameSessionRow[]> {
      return db.select().from(gameSessions).orderBy(desc(gameSessions.startedAt)).limit(limit);
    },

    async recordCheckpointResult(input: {
      checkpointPackId: string;
      scorePercent: number;
      passed: boolean;
      detail?: Record<string, unknown>;
    }) {
      const row = {
        id: newId(),
        checkpointPackId: input.checkpointPackId,
        scorePercent: input.scorePercent,
        passed: input.passed,
        detail: input.detail ?? null,
        completedAt: Date.now(),
      };
      await db.insert(checkpointResults).values(row);
      return row;
    },

    async listCheckpointResults() {
      return db.select().from(checkpointResults).orderBy(desc(checkpointResults.completedAt));
    },

    async recordAssessment(payload: Record<string, unknown>) {
      const row = { id: newId(), payload, createdAt: Date.now() };
      await db.insert(assessments).values(row);
      return row;
    },

    async listAssessments() {
      return db.select().from(assessments).orderBy(desc(assessments.createdAt));
    },

    /** Idempotent unlock — returns true when newly unlocked. */
    async unlockAchievement(id: string): Promise<boolean> {
      const existing = await db.select().from(achievements).where(eq(achievements.id, id)).limit(1);
      if (existing.length) return false;
      await db.insert(achievements).values({ id, unlockedAt: Date.now() });
      return true;
    },

    async listAchievements() {
      return db.select().from(achievements).orderBy(desc(achievements.unlockedAt));
    },

    /** Persist one analytics event (called by src/services/analytics.ts). */
    async logEvent(
      event: string,
      props?: Record<string, string | number | boolean>,
    ): Promise<void> {
      await db
        .insert(analyticsEvents)
        .values({ event, props: props ?? null, createdAt: Date.now() });
    },

    async listRecentEvents(limit = 100) {
      return db.select().from(analyticsEvents).orderBy(desc(analyticsEvents.id)).limit(limit);
    },
  };
}

export type StatsRepo = ReturnType<typeof createStatsRepo>;
