import { and, asc, eq, sql } from 'drizzle-orm';

import { normalizeRu, toFtsQuery } from '../normalize';
import {
  audioTracks,
  exerciseSpecs,
  journalPrompts,
  lessons,
  packs,
  sentences,
  stories,
  tokens,
  wordStamps,
} from '../schema';
import type { SumrakDB } from '../types';

export type PackRow = typeof packs.$inferSelect;
export type StoryRow = typeof stories.$inferSelect;
export type SentenceRow = typeof sentences.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type AudioTrackRow = typeof audioTracks.$inferSelect;
export type WordStampRow = typeof wordStamps.$inferSelect;

export interface StoryListItem extends StoryRow {
  packTitleEn: string;
  packTitleRu: string;
  sentenceCount: number;
}

export interface SentenceWithTokens extends SentenceRow {
  tokens: TokenRow[];
}

export interface StoryDetail {
  story: StoryRow;
  sentences: SentenceWithTokens[];
  audio: AudioTrackRow[];
}

/** A resolved user-data content reference (bank item → its source sentence). */
export interface ResolvedSentence {
  sentence: SentenceRow;
  story: StoryRow | null;
}

export interface TokenSearchHit {
  packId: string;
  sentenceId: string;
  tokenIndex: number;
  storyId: string;
  text: string;
  lemma: string | null;
  translation: string | null;
  pos: string | null;
  level: string | null;
}

/**
 * Read access to everything that arrived in packs. Content rows are
 * disposable (rebuilt on reimport) — nothing here mutates; writes happen
 * only in the importer.
 */
export function createContentRepo(db: SumrakDB) {
  return {
    async listPacks(): Promise<(PackRow & { storyCount: number })[]> {
      // NB: written as literal SQL with explicit qualification — interpolating
      // drizzle columns into a correlated subquery renders them UNQUALIFIED
      // ("pack_id" = "id"), silently correlating against the wrong table.
      const rows = await db
        .select({
          pack: packs,
          storyCount: sql<number>`(SELECT COUNT(*) FROM stories WHERE stories.pack_id = packs.id)`,
        })
        .from(packs)
        .orderBy(asc(packs.id));
      return rows.map((r) => ({ ...r.pack, storyCount: r.storyCount }));
    },

    async getPack(packId: string): Promise<PackRow | null> {
      const rows = await db.select().from(packs).where(eq(packs.id, packId)).limit(1);
      return rows[0] ?? null;
    },

    async listStories(): Promise<StoryListItem[]> {
      const rows = await db
        .select({
          story: stories,
          packTitleEn: packs.titleEn,
          packTitleRu: packs.titleRu,
          sentenceCount: sql<number>`(SELECT COUNT(*) FROM sentences WHERE sentences.pack_id = stories.pack_id AND sentences.story_id = stories.id)`,
        })
        .from(stories)
        .innerJoin(packs, eq(stories.packId, packs.id))
        .orderBy(asc(stories.packId), asc(stories.orderIdx));
      return rows.map((r) => ({
        ...r.story,
        packTitleEn: r.packTitleEn,
        packTitleRu: r.packTitleRu,
        sentenceCount: r.sentenceCount,
      }));
    },

    /** Full reader payload: story, ordered sentences with ordered tokens, audio tracks. */
    async getStoryDetail(packId: string, storyId: string): Promise<StoryDetail | null> {
      const storyRows = await db
        .select()
        .from(stories)
        .where(and(eq(stories.packId, packId), eq(stories.id, storyId)))
        .limit(1);
      const story = storyRows[0];
      if (!story) return null;

      const sentenceRows = await db
        .select()
        .from(sentences)
        .where(and(eq(sentences.packId, packId), eq(sentences.storyId, storyId)))
        .orderBy(asc(sentences.orderIdx));
      const tokenRows = await db
        .select()
        .from(tokens)
        .where(and(eq(tokens.packId, packId), eq(tokens.storyId, storyId)))
        .orderBy(asc(tokens.tokenIndex));
      const audio = await db
        .select()
        .from(audioTracks)
        .where(and(eq(audioTracks.packId, packId), eq(audioTracks.storyId, storyId)));

      const bySentence = new Map<string, TokenRow[]>();
      for (const tok of tokenRows) {
        const list = bySentence.get(tok.sentenceId) ?? [];
        list.push(tok);
        bySentence.set(tok.sentenceId, list);
      }
      return {
        story,
        sentences: sentenceRows.map((s) => ({ ...s, tokens: bySentence.get(s.id) ?? [] })),
        audio,
      };
    },

    /**
     * Resolve a stable sentence ref held by user data (bank item encounter).
     * Sentence ids are unique pack-wide; the authoring pipeline keeps them
     * globally distinct in practice, so first match wins.
     */
    async resolveSentence(sentenceId: string): Promise<ResolvedSentence | null> {
      const rows = await db.select().from(sentences).where(eq(sentences.id, sentenceId)).limit(1);
      const sentence = rows[0];
      if (!sentence) return null;
      const storyRows = await db
        .select()
        .from(stories)
        .where(and(eq(stories.packId, sentence.packId), eq(stories.id, sentence.storyId)))
        .limit(1);
      return { sentence, story: storyRows[0] ?? null };
    },

    async getSentenceTokens(packId: string, sentenceId: string): Promise<TokenRow[]> {
      return db
        .select()
        .from(tokens)
        .where(and(eq(tokens.packId, packId), eq(tokens.sentenceId, sentenceId)))
        .orderBy(asc(tokens.tokenIndex));
    },

    /** All sentences containing a lemma (ё/е-tolerant) — cloze generation (T13). */
    async findSentencesWithLemma(lemma: string): Promise<SentenceRow[]> {
      const norm = normalizeRu(lemma);
      return db
        .selectDistinct({
          packId: sentences.packId,
          id: sentences.id,
          storyId: sentences.storyId,
          orderIdx: sentences.orderIdx,
          ru: sentences.ru,
          en: sentences.en,
          grammarTopics: sentences.grammarTopics,
        })
        .from(sentences)
        .innerJoin(
          tokens,
          and(eq(tokens.packId, sentences.packId), eq(tokens.sentenceId, sentences.id)),
        )
        .where(eq(tokens.lemmaNorm, norm));
    },

    /** FTS5 search over token lemma/text (already ё-folded in the index). */
    async searchTokens(query: string, limit = 50): Promise<TokenSearchHit[]> {
      const match = toFtsQuery(query);
      if (!match) return [];
      const rows = await db.all<{
        pack_id: string;
        sentence_id: string;
        token_index: number;
        story_id: string;
        text: string;
        lemma: string | null;
        translation: string | null;
        pos: string | null;
        level: string | null;
      }>(sql`
        SELECT t.pack_id, t.sentence_id, t.token_index, t.story_id,
               t.text, t.lemma, t.translation, t.pos, t.level
        FROM tokens_fts f
        JOIN tokens t ON t.rowid = f.rowid
        WHERE tokens_fts MATCH ${match}
        ORDER BY rank
        LIMIT ${limit}
      `);
      return rows.map((r) => ({
        packId: r.pack_id,
        sentenceId: r.sentence_id,
        tokenIndex: r.token_index,
        storyId: r.story_id,
        text: r.text,
        lemma: r.lemma,
        translation: r.translation,
        pos: r.pos,
        level: r.level,
      }));
    },

    async getWordStamps(packId: string, storyId: string, trackId: string): Promise<WordStampRow[]> {
      return db
        .select()
        .from(wordStamps)
        .where(
          and(
            eq(wordStamps.packId, packId),
            eq(wordStamps.storyId, storyId),
            eq(wordStamps.trackId, trackId),
          ),
        )
        .orderBy(asc(wordStamps.stampIndex));
    },

    async getLesson(packId: string) {
      const rows = await db.select().from(lessons).where(eq(lessons.packId, packId)).limit(1);
      return rows[0] ?? null;
    },

    async listJournalPrompts(level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1') {
      const base = db.select().from(journalPrompts);
      return level ? base.where(eq(journalPrompts.level, level)) : base;
    },

    async listExerciseSpecs(packId: string) {
      return db
        .select()
        .from(exerciseSpecs)
        .where(eq(exerciseSpecs.packId, packId))
        .orderBy(asc(exerciseSpecs.orderIdx));
    },
  };
}

export type ContentRepo = ReturnType<typeof createContentRepo>;
