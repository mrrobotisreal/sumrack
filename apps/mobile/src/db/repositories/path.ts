import { asc, eq, inArray, sql } from 'drizzle-orm';

import { packs, unitProgress } from '../schema';
import type { SumrakDB } from '../types';

export type UnitProgressRow = typeof unitProgress.$inferSelect;

/**
 * Vocabulary credit for one course-unit pack, derived live (T17's
 * out-of-order rule): lemmas are counted against the unit's own annotated
 * tokens, bank membership against `bank_items`, and "reviewed" against FSRS
 * card state — none of it cares whether the user ever opened the Path tab.
 */
export interface UnitLemmaStats {
  /** Distinct annotated lemmas across the unit's stories. */
  totalLemmas: number;
  /** Of those, lemmas present in the word bank (kind='word'). */
  collected: number;
  /** Of those, lemmas whose bank item has at least one reviewed FSRS card. */
  reviewed: number;
}

/**
 * Guided-path data (T17): the course-unit/checkpoint pack list, the
 * non-derivable unit facts (lesson read, quiz outcome, first completion),
 * and the derived vocabulary-credit queries. Everything else the Path tab
 * shows comes from existing repos (reading progress, checkpoint_results).
 */
export function createPathRepo(db: SumrakDB) {
  return {
    /** Course-unit + checkpoint packs, path order: level then id. */
    async listPathPacks() {
      return db
        .select()
        .from(packs)
        .where(inArray(packs.type, ['course-unit', 'checkpoint']))
        .orderBy(asc(packs.level), asc(packs.id));
    },

    async listUnitProgress(): Promise<UnitProgressRow[]> {
      return db.select().from(unitProgress);
    },

    async getUnitProgress(packId: string): Promise<UnitProgressRow | null> {
      const rows = await db
        .select()
        .from(unitProgress)
        .where(eq(unitProgress.packId, packId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Idempotent: records the first lesson read; rereads never move it. */
    async markLessonRead(packId: string): Promise<boolean> {
      const now = Date.now();
      const existing = await this.getUnitProgress(packId);
      if (existing?.lessonReadAt != null) return false;
      await db
        .insert(unitProgress)
        .values({ packId, lessonReadAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: unitProgress.packId,
          set: { lessonReadAt: now, updatedAt: now },
        });
      return true;
    },

    /**
     * Record a unit-quiz outcome: best score is monotone, `quizPassedAt` is
     * set on the first passing run and never cleared by later failures.
     */
    async recordQuizResult(
      packId: string,
      scorePercent: number,
      passed: boolean,
    ): Promise<UnitProgressRow> {
      const now = Date.now();
      const existing = await this.getUnitProgress(packId);
      const best = Math.max(scorePercent, existing?.quizBestScorePercent ?? 0);
      const passedAt = existing?.quizPassedAt ?? (passed ? now : null);
      await db
        .insert(unitProgress)
        .values({
          packId,
          quizBestScorePercent: best,
          quizPassedAt: passedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: unitProgress.packId,
          set: { quizBestScorePercent: best, quizPassedAt: passedAt, updatedAt: now },
        });
      return (await this.getUnitProgress(packId))!;
    },

    /** Idempotent first-completion stamp — returns true exactly once per unit. */
    async markUnitCompleted(packId: string): Promise<boolean> {
      const now = Date.now();
      const existing = await this.getUnitProgress(packId);
      if (existing?.completedAt != null) return false;
      await db
        .insert(unitProgress)
        .values({ packId, completedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: unitProgress.packId,
          set: { completedAt: now, updatedAt: now },
        });
      return true;
    },

    /**
     * Derived vocabulary credit for a unit. ё/е-tolerant by construction:
     * both sides of every join are the pre-computed `lemma_norm` shadows.
     */
    async getUnitLemmaStats(packId: string): Promise<UnitLemmaStats> {
      const rows = await db.all<{ total: number; collected: number; reviewed: number }>(sql`
        WITH unit_lemmas AS (
          SELECT DISTINCT lemma_norm FROM tokens
          WHERE pack_id = ${packId} AND lemma_norm IS NOT NULL AND is_punct = 0
        )
        SELECT
          (SELECT COUNT(*) FROM unit_lemmas) AS total,
          (SELECT COUNT(*) FROM unit_lemmas u
             WHERE EXISTS (SELECT 1 FROM bank_items b
                           WHERE b.kind = 'word' AND b.lemma_norm = u.lemma_norm)) AS collected,
          (SELECT COUNT(*) FROM unit_lemmas u
             WHERE EXISTS (SELECT 1 FROM bank_items b
                           JOIN cards c ON c.bank_item_id = b.id
                           WHERE b.kind = 'word' AND b.lemma_norm = u.lemma_norm
                             AND c.reps > 0)) AS reviewed
      `);
      const row = rows[0];
      return {
        totalLemmas: row?.total ?? 0,
        collected: row?.collected ?? 0,
        reviewed: row?.reviewed ?? 0,
      };
    },
  };
}

export type PathRepo = ReturnType<typeof createPathRepo>;
