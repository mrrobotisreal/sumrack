import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, like, or, sql } from 'drizzle-orm';

import { WordProfileSchema, type WordProfile } from '@/features/word-forms/profile-schema';
import { track } from '@/services/analytics';

import { newId } from '../ids';
import { normalizeRu } from '../normalize';
import { bankItems, grammarLessons, wordProfiles, type ProfileKind } from '../schema';
import type { SumrakDB } from '../types';
import type { BankItemRow } from './bank';

/**
 * Word profiles + grammar lessons repository (M16/T52, WORD_FORMS §5.4).
 * Owns every read/write of `word_profiles` and `grammar_lessons`.
 *
 * Invariants:
 * - exactly one CURRENT profile per (lemma_norm, kind) — the partial unique
 *   index enforces it, and `insertProfile` / `promoteProfile` clear the old
 *   current inside the SAME transaction so the index never rejects a write
 *   under a stale current (ticket technical note);
 * - every payload read goes through `WordProfileSchema.safeParse`; an
 *   unreadable payload (a future schema change) is treated as ABSENT — never
 *   a crash — and counted once per row as `app_error {scope:
 *   'word-profile-parse', fatal: false}` (§8). Tracked through `track()`
 *   directly rather than `logError` (which pulls in expo-file-system and
 *   would make this repo untestable under Node);
 * - lessons are append-only (decision 10); `profileId` is unenforced.
 */

export type WordProfileRow = typeof wordProfiles.$inferSelect;
export type GrammarLessonRow = typeof grammarLessons.$inferSelect;

/** A profile row with its payload parsed (null when the payload is unreadable). */
export interface WordProfileRecord extends WordProfileRow {
  profile: WordProfile | null;
}

/** What the service hands in after a successful generation (id/createdAt/isCurrent are owned here). */
export type NewWordProfile = Omit<
  typeof wordProfiles.$inferInsert,
  'id' | 'isCurrent' | 'createdAt'
> & { id?: string; createdAt?: number };

export type NewGrammarLesson = Omit<typeof grammarLessons.$inferInsert, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

export interface ListLessonsOptions {
  /** ё/е-tolerant substring match on the headword (normalized) / lemma key. */
  search?: string;
  limit: number;
  offset: number;
}

/** The (lemma_norm ?? normalized) key expression of a bank item, as SQL (§5.4). */
const BANK_PROFILE_KEY = sql`CASE WHEN ${bankItems.kind} = 'word' THEN ${bankItems.lemmaNorm} ELSE ${bankItems.normalized} END`;

export function createWordFormsRepo(db: SumrakDB) {
  const parseWarned = new Set<string>();

  function toRecord(row: WordProfileRow): WordProfileRecord {
    const parsed = WordProfileSchema.safeParse(row.payload);
    if (parsed.success) return { ...row, profile: parsed.data };
    if (!parseWarned.has(row.id)) {
      parseWarned.add(row.id);
      track('app_error', { scope: 'word-profile-parse', fatal: false });
    }
    return { ...row, profile: null };
  }

  async function inTransaction<T>(body: () => Promise<T>): Promise<T> {
    await db.run(sql`BEGIN`);
    try {
      const result = await body();
      await db.run(sql`COMMIT`);
      return result;
    } catch (err) {
      await db.run(sql`ROLLBACK`);
      throw err;
    }
  }

  const keyIs = (lemmaNorm: string, kind: ProfileKind) =>
    and(eq(wordProfiles.lemmaNorm, lemmaNorm), eq(wordProfiles.kind, kind));

  return {
    // --- profiles -----------------------------------------------------------

    /** The current version's parsed record, or null when none / unreadable (treated as absent). */
    async getCurrentProfile(
      lemmaNorm: string,
      kind: ProfileKind,
    ): Promise<WordProfileRecord | null> {
      const rows = await db
        .select()
        .from(wordProfiles)
        .where(and(keyIs(lemmaNorm, kind), eq(wordProfiles.isCurrent, true)))
        .limit(1);
      if (!rows[0]) return null;
      const record = toRecord(rows[0]);
      return record.profile ? record : null;
    },

    /** Every version for the key, newest first (unreadable ones listed with `profile: null`). */
    async listProfileVersions(lemmaNorm: string, kind: ProfileKind): Promise<WordProfileRecord[]> {
      const rows = await db
        .select()
        .from(wordProfiles)
        .where(keyIs(lemmaNorm, kind))
        .orderBy(desc(wordProfiles.createdAt), desc(wordProfiles.id));
      return rows.map(toRecord);
    },

    async getProfileById(id: string): Promise<WordProfileRecord | null> {
      const rows = await db.select().from(wordProfiles).where(eq(wordProfiles.id, id)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    /** One transaction: clear `is_current` on the key, insert the new row as current. */
    async insertProfile(input: NewWordProfile): Promise<WordProfileRow> {
      const row: typeof wordProfiles.$inferInsert = {
        ...input,
        id: input.id ?? newId(),
        isCurrent: true,
        createdAt: input.createdAt ?? Date.now(),
      };
      return inTransaction(async () => {
        await db
          .update(wordProfiles)
          .set({ isCurrent: false })
          .where(and(keyIs(row.lemmaNorm, row.kind), eq(wordProfiles.isCurrent, true)));
        const inserted = await db.insert(wordProfiles).values(row).returning();
        return inserted[0]!;
      });
    },

    /** Make an older version current again (transaction: clear + set). False when the id is unknown. */
    async promoteProfile(id: string): Promise<boolean> {
      const rows = await db.select().from(wordProfiles).where(eq(wordProfiles.id, id)).limit(1);
      const target = rows[0];
      if (!target) return false;
      if (target.isCurrent) return true;
      await inTransaction(async () => {
        await db
          .update(wordProfiles)
          .set({ isCurrent: false })
          .where(and(keyIs(target.lemmaNorm, target.kind), eq(wordProfiles.isCurrent, true)));
        await db.update(wordProfiles).set({ isCurrent: true }).where(eq(wordProfiles.id, id));
      });
      return true;
    },

    async countProfiles(): Promise<{ total: number; current: number; keys: number }> {
      const rows = await db.all<{ total: number; current: number; keys: number }>(
        sql`SELECT COUNT(*) AS total,
                   SUM(CASE WHEN is_current = 1 THEN 1 ELSE 0 END) AS current,
                   COUNT(DISTINCT lemma_norm || '|' || kind) AS keys
            FROM word_profiles`,
      );
      const r = rows[0];
      return { total: r?.total ?? 0, current: r?.current ?? 0, keys: r?.keys ?? 0 };
    },

    /** Newest profile rows across every key — the dev readout's receipt list (T52). */
    async listRecentProfiles(limit: number): Promise<WordProfileRow[]> {
      return db
        .select()
        .from(wordProfiles)
        .orderBy(desc(wordProfiles.createdAt), desc(wordProfiles.id))
        .limit(limit);
    },

    /**
     * Bank items whose key has no CURRENT profile: words via `lemma_norm`,
     * phrases via `normalized`; lemma-less words (needs-enrichment) are
     * excluded — they have no key (§5.4). Ordered the way the Словарь
     * default is (met-order), so a batch walks the bank front to back.
     */
    async listItemsWithoutProfile(limit: number): Promise<BankItemRow[]> {
      return db
        .select(getTableColumns(bankItems))
        .from(bankItems)
        .leftJoin(
          wordProfiles,
          and(
            eq(wordProfiles.lemmaNorm, BANK_PROFILE_KEY),
            eq(wordProfiles.kind, bankItems.kind),
            eq(wordProfiles.isCurrent, true),
          ),
        )
        .where(
          and(
            isNull(wordProfiles.id),
            or(eq(bankItems.kind, 'phrase'), isNotNull(bankItems.lemmaNorm)),
          ),
        )
        .orderBy(asc(bankItems.createdAt), asc(bankItems.id))
        .limit(limit);
    },

    /** Words without a lemma — they have no profile key (§5.4) and the batch skips them. */
    async countItemsWithoutLemma(): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(bankItems)
        .where(and(eq(bankItems.kind, 'word'), isNull(bankItems.lemmaNorm)));
      return rows[0]?.n ?? 0;
    },

    async countItemsWithoutProfile(): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(bankItems)
        .leftJoin(
          wordProfiles,
          and(
            eq(wordProfiles.lemmaNorm, BANK_PROFILE_KEY),
            eq(wordProfiles.kind, bankItems.kind),
            eq(wordProfiles.isCurrent, true),
          ),
        )
        .where(
          and(
            isNull(wordProfiles.id),
            or(eq(bankItems.kind, 'phrase'), isNotNull(bankItems.lemmaNorm)),
          ),
        );
      return rows[0]?.n ?? 0;
    },

    // --- lessons (append-only) ----------------------------------------------

    async insertLesson(input: NewGrammarLesson): Promise<GrammarLessonRow> {
      const inserted = await db
        .insert(grammarLessons)
        .values({ ...input, id: input.id ?? newId(), createdAt: input.createdAt ?? Date.now() })
        .returning();
      return inserted[0]!;
    },

    async getLesson(id: string): Promise<GrammarLessonRow | null> {
      const rows = await db.select().from(grammarLessons).where(eq(grammarLessons.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** Lessons about one word × one section, newest first. */
    async listLessonsForSection(
      lemmaNorm: string,
      kind: ProfileKind,
      sectionId: string,
    ): Promise<GrammarLessonRow[]> {
      return db
        .select()
        .from(grammarLessons)
        .where(
          and(
            eq(grammarLessons.lemmaNorm, lemmaNorm),
            eq(grammarLessons.kind, kind),
            eq(grammarLessons.sectionId, sectionId),
          ),
        )
        .orderBy(desc(grammarLessons.createdAt), desc(grammarLessons.id));
    },

    /** Every lesson for one key, newest first (the item's Lessons tab groups them by section). */
    async listLessonsForKey(lemmaNorm: string, kind: ProfileKind): Promise<GrammarLessonRow[]> {
      return db
        .select()
        .from(grammarLessons)
        .where(and(eq(grammarLessons.lemmaNorm, lemmaNorm), eq(grammarLessons.kind, kind)))
        .orderBy(desc(grammarLessons.createdAt), desc(grammarLessons.id));
    },

    /** Lesson counts per section id for one key (drives the per-section badges, T54). */
    async countLessonsForKey(
      lemmaNorm: string,
      kind: ProfileKind,
    ): Promise<Record<string, number>> {
      const rows = await db
        .select({ sectionId: grammarLessons.sectionId, n: sql<number>`COUNT(*)` })
        .from(grammarLessons)
        .where(and(eq(grammarLessons.lemmaNorm, lemmaNorm), eq(grammarLessons.kind, kind)))
        .groupBy(grammarLessons.sectionId);
      return Object.fromEntries(rows.map((r) => [r.sectionId, r.n]));
    },

    async countLessons(): Promise<number> {
      const rows = await db.select({ n: sql<number>`COUNT(*)` }).from(grammarLessons);
      return rows[0]?.n ?? 0;
    },

    /**
     * Global lessons list, newest first. `search` is ё/е-tolerant: it matches
     * the already-normalized lemma key OR the headword with ё folded
     * (SQLite's LIKE is ASCII-case-insensitive only, so the key column carries
     * the lowercase match and the headword fold covers capitalized names).
     */
    async listLessons(opts: ListLessonsOptions): Promise<GrammarLessonRow[]> {
      const conds = [];
      const q = opts.search?.trim();
      if (q) {
        const pattern = `%${normalizeRu(q)}%`;
        conds.push(
          or(
            like(grammarLessons.lemmaNorm, pattern),
            like(sql`replace(replace(${grammarLessons.headword}, 'ё', 'е'), 'Ё', 'Е')`, pattern),
          ),
        );
      }
      return db
        .select()
        .from(grammarLessons)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(grammarLessons.createdAt), desc(grammarLessons.id))
        .limit(opts.limit)
        .offset(opts.offset);
    },
  };
}

export type WordFormsRepo = ReturnType<typeof createWordFormsRepo>;
