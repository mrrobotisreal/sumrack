import { and, asc, desc, eq, inArray, like, ne, not, or, sql, type SQL } from 'drizzle-orm';

import { STABILITY_MATURE_MIN, STABILITY_YOUNG_MIN, type MasteryBand } from '@/lib/mastery';

import { newId } from '../ids';
import { normalizePhrase, normalizeRu } from '../normalize';
import { bankItems, encounters, type ProfileKind } from '../schema';
import type { SumrakDB } from '../types';

export type BankItemRow = typeof bankItems.$inferSelect;
export type EncounterRow = typeof encounters.$inferSelect;

export interface EncounterSource {
  sentenceId?: string;
  journalEntryId?: string;
}

export interface AddWordInput extends EncounterSource {
  lemma: string;
  /** Surface form as highlighted (e.g. "словами" for lemma "слово"). */
  surface: string;
  translation: string;
  grammar?: string;
  pos?: string;
  level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  sourceStoryId?: string;
  note?: string;
  needsEnrichment?: boolean;
}

export interface AddPhraseInput extends EncounterSource {
  /** The phrase text as highlighted. */
  surface: string;
  translation: string;
  sourceStoryId?: string;
  note?: string;
  needsEnrichment?: boolean;
}

export interface AddResult {
  item: BankItemRow;
  /** false = the lemma/phrase already existed; only an encounter was added. */
  created: boolean;
  encounter: EncounterRow;
}

/** Mastery chip value: a T18 band, or 'collected' = no reviewed core card yet. */
export type MasteryFilter = MasteryBand | 'collected';

export interface BankFilter {
  kind?: 'word' | 'phrase';
  level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  pos?: string;
  sourceStoryId?: string;
  needsEnrichment?: boolean;
  /**
   * T24 mastery chips — band of the item's weakest reviewed ru-en/en-ru card
   * (lib/mastery, the same definition the dashboard reconciles against).
   */
  mastery?: MasteryFilter;
  /** Substring match on surface/lemma/translation (ё/е-tolerant on Russian). */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MasteryCounts {
  learning: number;
  young: number;
  mature: number;
  collected: number;
}

export interface BankListItem extends BankItemRow {
  encounterCount: number;
  /**
   * T50 familiarity ∈ [0, 1]: mean of `(rating − 1) / 3` over the item's last
   * 10 qualifying grades (WORD_FORMS §3.2); null when unpracticed.
   */
  familiarity: number | null;
  /** Number of qualifying grades, all time (0 = unpracticed). */
  practiceCount: number;
  /** Rating (1–4) of the most recent qualifying grade; null when unpracticed. */
  latestRating: number | null;
}

/** Словарь sort keys (T50, WORD_FORMS §3.1). */
export type BankSortKey =
  | 'added-asc' // default — the order words were met (oldest first)
  | 'added-desc' // newest first
  | 'alpha-asc' // А → Я
  | 'alpha-desc' // Я → А
  | 'unpracticed-first' // unpracticed (added-asc) … then practiced (least familiar first, fixed)
  | 'practiced-first'; // practiced (by `familiarity`) … then unpracticed (added-asc)
export type FamiliaritySort = 'least' | 'most';
export interface BankSort {
  key: BankSortKey;
  /** Sub-sort for `practiced-first`; stored regardless so it is remembered. */
  familiarity: FamiliaritySort;
}
export const BANK_SORT_KEYS: readonly BankSortKey[] = [
  'added-asc',
  'added-desc',
  'alpha-asc',
  'alpha-desc',
  'unpracticed-first',
  'practiced-first',
];
export const DEFAULT_BANK_SORT: BankSort = { key: 'added-asc', familiarity: 'least' };

/** Distinct values present in the bank — drives the Словарь filter chips (T05). */
export interface BankFilterOptions {
  pos: string[];
  levels: ('A1' | 'A2' | 'B1' | 'B2' | 'C1')[];
  sourceStoryIds: string[];
}

export interface BankRepoHooks {
  /**
   * Runs after every successful addWord/addPhrase (created or deduped).
   * T06 wires FSRS card creation here (see createRepositories) so every
   * write path — popup, phrase sheet, manual add, future journal highlights —
   * gets cards without knowing about the reviews repo.
   */
  afterAdd?: (item: BankItemRow, created: boolean) => Promise<void>;
}

/**
 * Weakest-link core stability per bank item (T18 definition via lib/mastery):
 * MIN stability over the item's reviewed ru-en/en-ru cards, NULL when none.
 * Literal SQL with explicit qualification (the listPacks pitfall — see
 * content.ts): the correlated `bank_items.id` must stay qualified.
 */
const MIN_CORE_STABILITY = sql`(SELECT MIN(c.stability) FROM cards c
  WHERE c.bank_item_id = bank_items.id
    AND c.direction IN ('ru-en', 'en-ru') AND c.reps > 0)`;

/**
 * T50 qualifying grades (WORD_FORMS §3.2, decision 4): a review_log row on one
 * of the item's core cards (ru-en / en-ru) that came from a flashcard press —
 * or from a pre-T50 row (`source IS NULL`, unattributable, counted
 * best-effort). MC/cloze/SB/listening/pronunciation/dialogue never count, nor
 * does anything on a listening/production card. Same explicit-qualification
 * rule as MIN_CORE_STABILITY: `bank_items.id` is the outer row.
 */
const QUALIFYING_GRADES_FROM = sql`FROM review_log r JOIN cards c ON c.id = r.card_id
  WHERE c.bank_item_id = bank_items.id
    AND c.direction IN ('ru-en', 'en-ru')
    AND (r.source = 'flashcard' OR r.source IS NULL)`;

/** Mean of (rating − 1) / 3 over the last 10 qualifying grades; NULL when none. */
const FAMILIARITY = sql<number | null>`(SELECT AVG((q.rating - 1) / 3.0) FROM (
  SELECT r.rating ${QUALIFYING_GRADES_FROM}
  ORDER BY r.reviewed_at DESC LIMIT 10) q)`;
const PRACTICE_COUNT = sql<number>`(SELECT COUNT(*) ${QUALIFYING_GRADES_FROM})`;
const LATEST_RATING = sql<number | null>`(SELECT r.rating ${QUALIFYING_GRADES_FROM}
  ORDER BY r.reviewed_at DESC LIMIT 1)`;

/**
 * ORDER BY for one sort (WORD_FORMS §3.2 table). The three familiarity
 * columns are selected with `.as(...)` (an SQL.Aliased) and referenced here
 * BY ALIAS — drizzle emits the bare alias outside the select list and SQLite
 * resolves result-column aliases inside ORDER BY expressions. The un-aliased
 * `encounterCount` select proves the alternative (bare `sql`) would fail with
 * "no such column". NULL familiarity only exists in the unpracticed group,
 * which the leading practiced flag segregates, so NULL ordering never matters.
 */
function bankOrderBy(sort: BankSort, cols: typeof SORT_COLUMNS): SQL[] {
  const alphaKey = sql`COALESCE(${bankItems.lemmaNorm}, ${bankItems.normalized})`;
  const practiced = sql`(${cols.practiceCount} > 0)`;
  switch (sort.key) {
    case 'added-asc':
      return [asc(bankItems.createdAt), asc(bankItems.id)];
    case 'added-desc':
      return [desc(bankItems.createdAt), desc(bankItems.id)];
    case 'alpha-asc':
      return [asc(alphaKey), asc(bankItems.createdAt)];
    case 'alpha-desc':
      return [desc(alphaKey), asc(bankItems.createdAt)];
    case 'unpracticed-first':
      return [
        asc(practiced),
        asc(cols.familiarity),
        asc(cols.latestRating),
        desc(cols.practiceCount),
        asc(bankItems.createdAt),
      ];
    case 'practiced-first':
      return sort.familiarity === 'most'
        ? [
            desc(practiced),
            desc(cols.familiarity),
            desc(cols.latestRating),
            desc(cols.practiceCount),
            asc(bankItems.createdAt),
          ]
        : [
            desc(practiced),
            asc(cols.familiarity),
            asc(cols.latestRating),
            desc(cols.practiceCount),
            asc(bankItems.createdAt),
          ];
  }
}

const SORT_COLUMNS = {
  familiarity: FAMILIARITY.as('familiarity'),
  practiceCount: PRACTICE_COUNT.as('practice_count'),
  latestRating: LATEST_RATING.as('latest_rating'),
};

/** WHERE fragment for one mastery chip. NULL comparisons are false in SQLite,
 * so band conditions implicitly exclude never-reviewed items. */
function masteryCondition(mastery: MasteryFilter) {
  switch (mastery) {
    case 'collected':
      return sql`${MIN_CORE_STABILITY} IS NULL`;
    case 'learning':
      return sql`${MIN_CORE_STABILITY} < ${STABILITY_YOUNG_MIN}`;
    case 'young':
      return sql`${MIN_CORE_STABILITY} >= ${STABILITY_YOUNG_MIN} AND ${MIN_CORE_STABILITY} < ${STABILITY_MATURE_MIN}`;
    case 'mature':
      return sql`${MIN_CORE_STABILITY} >= ${STABILITY_MATURE_MIN}`;
  }
}

/**
 * The word bank. Owns the dedup invariant (design §5): words are unique by
 * normalized lemma, phrases by normalized text — adding a known lemma again
 * attaches a new encounter, never a duplicate item.
 */
export function createBankRepo(db: SumrakDB, hooks: BankRepoHooks = {}) {
  async function insertEncounter(
    bankItemId: string,
    surface: string,
    source: EncounterSource,
  ): Promise<EncounterRow> {
    const row: typeof encounters.$inferInsert = {
      id: newId(),
      bankItemId,
      sentenceId: source.sentenceId ?? null,
      journalEntryId: source.journalEntryId ?? null,
      surface,
      createdAt: Date.now(),
    };
    await db.insert(encounters).values(row);
    return row as EncounterRow;
  }

  async function getById(id: string): Promise<BankItemRow | null> {
    const rows = await db.select().from(bankItems).where(eq(bankItems.id, id)).limit(1);
    return rows[0] ?? null;
  }

  return {
    getItem: getById,

    /** Batch fetch by id, order not guaranteed. Missing ids are silently absent. */
    async getItemsByIds(ids: string[]): Promise<BankItemRow[]> {
      if (ids.length === 0) return [];
      return db.select().from(bankItems).where(inArray(bankItems.id, ids));
    },

    /**
     * Distractor pool for multiple choice (design §7.3 mode 2): candidates
     * matched to the target in tiers — same POS + level first, then same
     * POS, then same level, then same kind — randomized within each tier.
     * Items without a translation (needsEnrichment) never qualify: their
     * option text would be empty. Callers overfetch and dedup display
     * strings; fewer than 3 usable distractors means "play flashcard
     * instead", decided by the session builder.
     */
    async findDistractors(target: BankItemRow, count: number): Promise<BankItemRow[]> {
      const picked: BankItemRow[] = [];
      const excluded = new Set<string>([target.id]);

      type Cond = ReturnType<typeof and>;
      const tiers: (() => Cond)[] = [];
      // Tier conditions are lazy so each query excludes everything picked so far.
      const base = () => [not(inArray(bankItems.id, [...excluded])), ne(bankItems.translation, '')];
      if (target.pos && target.level) {
        tiers.push(() =>
          and(...base(), eq(bankItems.pos, target.pos!), eq(bankItems.level, target.level!)),
        );
      }
      if (target.pos) tiers.push(() => and(...base(), eq(bankItems.pos, target.pos!)));
      if (target.level) tiers.push(() => and(...base(), eq(bankItems.level, target.level!)));
      tiers.push(() => and(...base(), eq(bankItems.kind, target.kind)));
      tiers.push(() => and(...base()));

      for (const tier of tiers) {
        if (picked.length >= count) break;
        const rows = await db
          .select()
          .from(bankItems)
          .where(tier())
          .orderBy(sql`RANDOM()`)
          .limit(count - picked.length);
        for (const row of rows) {
          excluded.add(row.id);
          picked.push(row);
        }
      }
      return picked;
    },

    async getItemWithEncounters(id: string) {
      const item = await getById(id);
      if (!item) return null;
      const enc = await db
        .select()
        .from(encounters)
        .where(eq(encounters.bankItemId, id))
        .orderBy(desc(encounters.createdAt));
      return { ...item, encounters: enc };
    },

    async findWordByLemma(lemma: string): Promise<BankItemRow | null> {
      const rows = await db
        .select()
        .from(bankItems)
        .where(and(eq(bankItems.kind, 'word'), eq(bankItems.lemmaNorm, normalizeRu(lemma))))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * The bank item behind a profile/lesson key (WORD_FORMS §5.4): words by
     * `lemma_norm`, phrases by `normalized` — lessons outlive bank rows, so
     * null means «Word not in bank» (§8), never an error.
     */
    async findByProfileKey(lemmaNorm: string, kind: ProfileKind): Promise<BankItemRow | null> {
      const rows = await db
        .select()
        .from(bankItems)
        .where(
          kind === 'word'
            ? and(eq(bankItems.kind, 'word'), eq(bankItems.lemmaNorm, lemmaNorm))
            : and(eq(bankItems.kind, 'phrase'), eq(bankItems.normalized, lemmaNorm)),
        )
        .orderBy(asc(bankItems.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async findPhrase(text: string): Promise<BankItemRow | null> {
      const rows = await db
        .select()
        .from(bankItems)
        .where(and(eq(bankItems.kind, 'phrase'), eq(bankItems.normalized, normalizePhrase(text))))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Add a word by lemma — dedup rule lives here. */
    async addWord(input: AddWordInput): Promise<AddResult> {
      const lemmaNorm = normalizeRu(input.lemma);
      const existingRows = await db
        .select()
        .from(bankItems)
        .where(and(eq(bankItems.kind, 'word'), eq(bankItems.lemmaNorm, lemmaNorm)))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        const encounter = await insertEncounter(existing.id, input.surface, input);
        await hooks.afterAdd?.(existing, false);
        return { item: existing, created: false, encounter };
      }
      const row: typeof bankItems.$inferInsert = {
        id: newId(),
        kind: 'word',
        lemma: input.lemma,
        lemmaNorm,
        surface: input.surface,
        normalized: normalizePhrase(input.surface),
        translation: input.translation,
        grammar: input.grammar ?? null,
        pos: input.pos ?? null,
        level: input.level ?? null,
        sourceSentenceId: input.sentenceId ?? null,
        sourceStoryId: input.sourceStoryId ?? null,
        note: input.note ?? null,
        needsEnrichment: input.needsEnrichment ?? false,
        createdAt: Date.now(),
      };
      await db.insert(bankItems).values(row);
      const encounter = await insertEncounter(row.id, input.surface, input);
      const item = (await getById(row.id))!;
      await hooks.afterAdd?.(item, true);
      return { item, created: true, encounter };
    },

    /** Add a phrase — dedup on normalized text. */
    async addPhrase(input: AddPhraseInput): Promise<AddResult> {
      const normalized = normalizePhrase(input.surface);
      const existingRows = await db
        .select()
        .from(bankItems)
        .where(and(eq(bankItems.kind, 'phrase'), eq(bankItems.normalized, normalized)))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        const encounter = await insertEncounter(existing.id, input.surface, input);
        await hooks.afterAdd?.(existing, false);
        return { item: existing, created: false, encounter };
      }
      const row: typeof bankItems.$inferInsert = {
        id: newId(),
        kind: 'phrase',
        lemma: null,
        lemmaNorm: null,
        surface: input.surface,
        normalized,
        translation: input.translation,
        grammar: null,
        pos: null,
        level: null,
        sourceSentenceId: input.sentenceId ?? null,
        sourceStoryId: input.sourceStoryId ?? null,
        note: input.note ?? null,
        needsEnrichment: input.needsEnrichment ?? false,
        createdAt: Date.now(),
      };
      await db.insert(bankItems).values(row);
      const encounter = await insertEncounter(row.id, input.surface, input);
      const item = (await getById(row.id))!;
      await hooks.afterAdd?.(item, true);
      return { item, created: true, encounter };
    },

    /** Record an additional encounter for an existing item. */
    async addEncounter(
      bankItemId: string,
      surface: string,
      source: EncounterSource,
    ): Promise<EncounterRow> {
      return insertEncounter(bankItemId, surface, source);
    },

    /**
     * The Словарь list. `sort` (T50) orders the page; the familiarity columns
     * are correlated subqueries (no window functions) so limit/offset paging
     * stays exact under every key and every filter/search combination.
     */
    async listItems(
      filter: BankFilter = {},
      sort: BankSort = DEFAULT_BANK_SORT,
    ): Promise<BankListItem[]> {
      const conds = [];
      if (filter.kind) conds.push(eq(bankItems.kind, filter.kind));
      if (filter.level) conds.push(eq(bankItems.level, filter.level));
      if (filter.pos) conds.push(eq(bankItems.pos, filter.pos));
      if (filter.sourceStoryId) conds.push(eq(bankItems.sourceStoryId, filter.sourceStoryId));
      if (filter.needsEnrichment !== undefined)
        conds.push(eq(bankItems.needsEnrichment, filter.needsEnrichment));
      if (filter.mastery) conds.push(masteryCondition(filter.mastery));
      if (filter.search) {
        const q = `%${normalizePhrase(filter.search)}%`;
        conds.push(
          or(
            like(bankItems.normalized, q),
            like(bankItems.lemmaNorm, q),
            like(sql`lower(${bankItems.translation})`, q),
          ),
        );
      }
      const rows = await db
        .select({
          item: bankItems,
          // Literal SQL with explicit qualification (same pitfall as content.listPacks).
          encounterCount: sql<number>`(SELECT COUNT(*) FROM encounters WHERE encounters.bank_item_id = bank_items.id)`,
          familiarity: SORT_COLUMNS.familiarity,
          practiceCount: SORT_COLUMNS.practiceCount,
          latestRating: SORT_COLUMNS.latestRating,
        })
        .from(bankItems)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(...bankOrderBy(sort, SORT_COLUMNS))
        .limit(filter.limit ?? 200)
        .offset(filter.offset ?? 0);
      return rows.map((r) => ({
        ...r.item,
        encounterCount: r.encounterCount,
        familiarity: r.familiarity,
        practiceCount: r.practiceCount,
        latestRating: r.latestRating,
      }));
    },

    /**
     * Per-band item counts for the mastery chips (T24). Same weakest-link
     * definition as the dashboard (lib/mastery): with kind='word' applied
     * UI-side, band counts reconcile with getVocabByLevel's summed bands
     * (word lemmas are unique per item by the dedup invariant).
     */
    async getMasteryCounts(): Promise<MasteryCounts> {
      const rows = await db.all<{ band: string; n: number }>(sql`
        SELECT CASE
                 WHEN ms IS NULL THEN 'collected'
                 WHEN ms < ${STABILITY_YOUNG_MIN} THEN 'learning'
                 WHEN ms < ${STABILITY_MATURE_MIN} THEN 'young'
                 ELSE 'mature'
               END AS band,
               COUNT(*) AS n
        FROM (SELECT ${MIN_CORE_STABILITY} AS ms FROM bank_items)
        GROUP BY band
      `);
      const counts: MasteryCounts = { learning: 0, young: 0, mature: 0, collected: 0 };
      for (const r of rows) {
        if (r.band in counts) counts[r.band as keyof MasteryCounts] = r.n;
      }
      return counts;
    },

    /** Distinct filter values actually present, so chips never dead-end. */
    async getFilterOptions(): Promise<BankFilterOptions> {
      const posRows = await db
        .selectDistinct({ pos: bankItems.pos })
        .from(bankItems)
        .where(sql`${bankItems.pos} IS NOT NULL`);
      const levelRows = await db
        .selectDistinct({ level: bankItems.level })
        .from(bankItems)
        .where(sql`${bankItems.level} IS NOT NULL`);
      const storyRows = await db
        .selectDistinct({ id: bankItems.sourceStoryId })
        .from(bankItems)
        .where(sql`${bankItems.sourceStoryId} IS NOT NULL`);
      const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
      return {
        pos: posRows
          .map((r) => r.pos)
          .filter((p): p is string => !!p)
          .sort(),
        levels: levelRows
          .map((r) => r.level)
          .filter((l): l is (typeof levelOrder)[number] => !!l)
          .sort((a, b) => levelOrder.indexOf(a) - levelOrder.indexOf(b)),
        sourceStoryIds: storyRows.map((r) => r.id).filter((s): s is string => !!s),
      };
    },

    async countItems(kind?: 'word' | 'phrase'): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(bankItems)
        .where(kind ? eq(bankItems.kind, kind) : undefined);
      return rows[0]?.n ?? 0;
    },

    async updateItem(
      id: string,
      patch: Partial<
        Pick<
          BankItemRow,
          'lemma' | 'translation' | 'grammar' | 'pos' | 'level' | 'note' | 'needsEnrichment'
        >
      >,
    ): Promise<BankItemRow | null> {
      const full: Record<string, unknown> = { ...patch };
      if (patch.lemma !== undefined) full.lemmaNorm = patch.lemma ? normalizeRu(patch.lemma) : null;
      await db.update(bankItems).set(full).where(eq(bankItems.id, id));
      return getById(id);
    },

    /** Cascades to encounters, cards, and review_log (user-group FKs). */
    async deleteItem(id: string): Promise<void> {
      await db.delete(bankItems).where(eq(bankItems.id, id));
    },
  };
}

export type BankRepo = ReturnType<typeof createBankRepo>;
