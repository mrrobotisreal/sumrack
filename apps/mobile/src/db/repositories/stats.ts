import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { newId } from '../ids';
import {
  achievements,
  analyticsEvents,
  assessments,
  checkpointResults,
  dailyActivity,
  frozenDays,
  gameSessions,
  scenarioRuns,
  scenarios,
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
      delta: { reviewsDone?: number; readingMs?: number; storiesFinished?: number; xp?: number },
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
          xp: delta.xp ?? 0,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: dailyActivity.date,
          set: {
            reviewsDone: sql`${dailyActivity.reviewsDone} + ${delta.reviewsDone ?? 0}`,
            readingMs: sql`${dailyActivity.readingMs} + ${delta.readingMs ?? 0}`,
            storiesFinished: sql`${dailyActivity.storiesFinished} + ${delta.storiesFinished ?? 0}`,
            xp: sql`${dailyActivity.xp} + ${delta.xp ?? 0}`,
            updatedAt: now,
          },
        });
    },

    /**
     * Stamp the day's goal as met (once — the stamp never moves, and a later
     * goal-config change never un-stamps history). Returns true when newly
     * stamped, so the caller can fire goal-met side effects exactly once.
     */
    async markGoalMet(date: string = localDateKey()): Promise<boolean> {
      const now = Date.now();
      const rows = await db
        .select({ goalMetAt: dailyActivity.goalMetAt })
        .from(dailyActivity)
        .where(eq(dailyActivity.date, date))
        .limit(1);
      const row = rows[0];
      if (!row || row.goalMetAt != null) return false;
      await db
        .update(dailyActivity)
        .set({ goalMetAt: now, updatedAt: now })
        .where(eq(dailyActivity.date, date));
      return true;
    },

    /** All goal-met + frozen day keys — the streak walk's inputs (lib/streak). */
    async getStreakDays(): Promise<{ met: Set<string>; frozen: Set<string> }> {
      const [metRows, frozenRows] = await Promise.all([
        db
          .select({ date: dailyActivity.date })
          .from(dailyActivity)
          .where(isNotNull(dailyActivity.goalMetAt)),
        db.select({ date: frozenDays.date }).from(frozenDays),
      ]);
      return {
        met: new Set(metRows.map((r) => r.date)),
        frozen: new Set(frozenRows.map((r) => r.date)),
      };
    },

    /** Record freeze coverage for missed days (idempotent per date). */
    async insertFrozenDays(dates: string[]): Promise<void> {
      if (dates.length === 0) return;
      const now = Date.now();
      await db
        .insert(frozenDays)
        .values(dates.map((date) => ({ date, consumedAt: now })))
        .onConflictDoNothing();
    },

    /** Frozen days, most recent first (Today/settings "freeze used on …" UI). */
    async listFrozenDays(limit = 10) {
      return db.select().from(frozenDays).orderBy(desc(frozenDays.date)).limit(limit);
    },

    /** Lifetime XP — SUM of the per-day xp counters. */
    async getTotalXp(): Promise<number> {
      const rows = await db
        .select({ total: sql<number>`COALESCE(SUM(${dailyActivity.xp}), 0)` })
        .from(dailyActivity);
      return rows[0]?.total ?? 0;
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

    async startGameSession(
      /**
       * `game_sessions.mode`. The known values are the `GameSessionMode`
       * union below (T58 declares 'scenario' there — the one place the
       * games-mode set is written down); the column stays a plain string.
       */
      mode: GameSessionMode | (string & {}),
      // T27: dialogue runs survive force-close and must find their open row
      // again on resume — an identifying detail (e.g. { runId }) enables that.
      detail?: Record<string, unknown>,
    ): Promise<GameSessionRow> {
      const row: typeof gameSessions.$inferInsert = {
        id: newId(),
        mode,
        startedAt: Date.now(),
        endedAt: null,
        itemCount: 0,
        correctCount: 0,
        detail: detail ?? null,
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

    /** Finished sessions of one mode, newest first (T34 per-game aggregators). */
    async listFinishedGameSessions(
      mode: GameSessionMode | (string & {}),
      opts: { limit?: number; since?: number } = {},
    ): Promise<GameSessionRow[]> {
      return db
        .select()
        .from(gameSessions)
        .where(
          and(
            eq(gameSessions.mode, mode),
            isNotNull(gameSessions.endedAt),
            opts.since != null ? gte(gameSessions.startedAt, opts.since) : undefined,
          ),
        )
        .orderBy(desc(gameSessions.startedAt))
        .limit(opts.limit ?? 500);
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

    /**
     * T58 (SPEAKING_SCENARIOS §9.1 achievements, for T62): finished runs,
     * clean runs (a finished run whose stats say every turn was clean), and
     * how many families have every INSTALLED rung finished at least once —
     * sweep-friendly counts, like the T27 dialogue stats. An uninstalled
     * family can't qualify (its runs survive but prove nothing about "all").
     */
    async getScenarioStats(): Promise<{
      finishedRunCount: number;
      cleanRunCount: number;
      familiesCompleted: number;
    }> {
      const finished = await db
        .select({
          scenarioId: scenarioRuns.scenarioId,
          familyId: scenarioRuns.familyId,
          statsJson: scenarioRuns.statsJson,
        })
        .from(scenarioRuns)
        .where(isNotNull(scenarioRuns.finishedAt));
      let cleanRunCount = 0;
      const finishedScenarioIds = new Set<string>();
      for (const run of finished) {
        finishedScenarioIds.add(run.scenarioId);
        if (!run.statsJson) continue;
        try {
          const stats = JSON.parse(run.statsJson) as { turns?: number; cleanTurns?: number };
          if (
            typeof stats.turns === 'number' &&
            stats.turns > 0 &&
            stats.cleanTurns === stats.turns
          ) {
            cleanRunCount += 1;
          }
        } catch {
          // Unreadable stats never count as clean (the repo reports the parse error).
        }
      }
      const installed = await db
        .select({ familyId: scenarios.familyId, id: scenarios.id })
        .from(scenarios);
      const rungsByFamily = new Map<string, string[]>();
      for (const s of installed) {
        const list = rungsByFamily.get(s.familyId) ?? [];
        list.push(s.id);
        rungsByFamily.set(s.familyId, list);
      }
      let familiesCompleted = 0;
      for (const rungs of rungsByFamily.values()) {
        if (rungs.every((id) => finishedScenarioIds.has(id))) familiesCompleted += 1;
      }
      return { finishedRunCount: finished.length, cleanRunCount, familiesCompleted };
    },
  };
}

/**
 * The known `game_sessions.mode` values (T58 records this union — the
 * previous convention was "by string"): the T06 review modes, the T12–T14
 * games, the T17 unit quiz, the T27 dialogue run, the M17 scenario run and
 * the M18 exam drill / rehearsal.
 */
export type GameSessionMode =
  | 'flashcards'
  | 'review-mixed'
  | 'review-daily'
  | 'pronunciation'
  | 'cloze'
  | 'sentence-builder'
  | 'listening'
  | 'unit-quiz'
  | 'dialogue'
  | 'scenario'
  // T40: the typing trainer (2-minute burst). Stats live in settings; no FSRS writes.
  | 'typing'
  // T34: the numbers drill (10-item rounds; band tallies in detail) and the
  // match blitz «Молния» (60 s sprint; score in detail). Both FSRS-free.
  | 'numbers'
  | 'match-blitz'
  // M18 (declared in T68): the TORFL drill runner (T70) and «Мои ответы» rehearsal (T74).
  | 'exam-drill'
  | 'torfl-rehearsal';

export type StatsRepo = ReturnType<typeof createStatsRepo>;
