import { and, desc, eq, inArray, like, ne, not, or, sql } from 'drizzle-orm';

import { newId } from '../ids';
import { normalizePhrase, normalizeRu } from '../normalize';
import { bankItems, encounters } from '../schema';
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

export interface BankFilter {
  kind?: 'word' | 'phrase';
  level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  pos?: string;
  sourceStoryId?: string;
  needsEnrichment?: boolean;
  /** Substring match on surface/lemma/translation (ё/е-tolerant on Russian). */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BankListItem extends BankItemRow {
  encounterCount: number;
}

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

    async listItems(filter: BankFilter = {}): Promise<BankListItem[]> {
      const conds = [];
      if (filter.kind) conds.push(eq(bankItems.kind, filter.kind));
      if (filter.level) conds.push(eq(bankItems.level, filter.level));
      if (filter.pos) conds.push(eq(bankItems.pos, filter.pos));
      if (filter.sourceStoryId) conds.push(eq(bankItems.sourceStoryId, filter.sourceStoryId));
      if (filter.needsEnrichment !== undefined)
        conds.push(eq(bankItems.needsEnrichment, filter.needsEnrichment));
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
        })
        .from(bankItems)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(bankItems.createdAt))
        .limit(filter.limit ?? 200)
        .offset(filter.offset ?? 0);
      return rows.map((r) => ({ ...r.item, encounterCount: r.encounterCount }));
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
