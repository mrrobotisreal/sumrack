import { GrammarQuerySchema } from '@sumrak/schema';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import {
  LOCATION_TOPICS,
  PILOT_PACKS,
  PILOT_QUERY,
  REVIEWED_EXAMPLES,
} from '@/features/grammar-connections/model';

import { packs, sentences, stories, storyProgress, topicSentences } from '../schema';
import type { SumrakDB } from '../types';

export function createGrammarConnectionsRepo(db: SumrakDB) {
  return {
    async familiarExamples(query: unknown = PILOT_QUERY) {
      const parsed = GrammarQuerySchema.safeParse(query);
      if (!parsed.success) return [];
      const q = parsed.data;
      // Bound query cost and reject a malformed empty string as a wildcard.
      if (
        (q.pos !== undefined && !q.pos.trim()) ||
        [...(q.grammarIncludes ?? []), ...(q.lemmaIn ?? [])].some((v) => !v.trim())
      )
        return [];
      const tokenFilters = [
        sql`t.pack_id = ${sentences.packId}`,
        sql`t.sentence_id = ${sentences.id}`,
        sql`t.is_punct = 0`,
        ...(q.pos ? [sql`t.pos = ${q.pos}`] : []),
        ...(q.grammarIncludes ?? []).map(
          (part) => sql`instr(lower(coalesce(t.grammar, '')), ${part.toLowerCase()}) > 0`,
        ),
        ...(q.lemmaIn?.length
          ? [
              sql`t.lemma IN (${sql.join(
                q.lemmaIn.map((lemma) => sql`${lemma}`),
                sql`, `,
              )})`,
            ]
          : []),
      ];
      const batches = await Promise.all(
        PILOT_PACKS.map((pilot) =>
          db
            .selectDistinct({
              packId: sentences.packId,
              version: packs.version,
              storyId: sentences.storyId,
              sentenceId: sentences.id,
              orderIdx: sentences.orderIdx,
              ru: sentences.ru,
              en: sentences.en,
              title: stories.titleRu,
            })
            .from(storyProgress)
            .innerJoin(
              topicSentences,
              and(
                eq(topicSentences.packId, storyProgress.packId),
                eq(topicSentences.storyId, storyProgress.storyId),
              ),
            )
            .innerJoin(
              sentences,
              and(
                eq(sentences.packId, topicSentences.packId),
                eq(sentences.id, topicSentences.sentenceId),
              ),
            )
            .innerJoin(packs, eq(packs.id, sentences.packId))
            .innerJoin(
              stories,
              and(eq(stories.packId, sentences.packId), eq(stories.id, sentences.storyId)),
            )
            .where(
              and(
                eq(packs.type, 'stories'),
                eq(packs.level, 'A1'),
                and(eq(packs.id, pilot.id), eq(packs.version, pilot.version)),
                inArray(topicSentences.topic, [...LOCATION_TOPICS]),
                or(
                  ...REVIEWED_EXAMPLES.map((source) =>
                    and(
                      eq(sentences.packId, source.packId),
                      eq(sentences.id, source.sentenceId),
                      eq(sentences.ru, source.text),
                    ),
                  ),
                ),
                sql`(${storyProgress.finishedAt} IS NOT NULL OR ${sentences.orderIdx} <= ${storyProgress.currentSentenceIdx})`,
                sql`EXISTS (SELECT 1 FROM tokens t WHERE ${and(...tokenFilters)})`,
              ),
            )
            .orderBy(asc(sentences.packId), asc(sentences.storyId), asc(sentences.orderIdx))
            .limit(6),
        ),
      );
      return batches.flat();
    },
    async example(packId: string, storyId: string, sentenceId: string) {
      // Same eligibility at a direct-link boundary, never a raw sentence lookup.
      return (
        (await this.familiarExamples()).find(
          (s) => s.packId === packId && s.storyId === storyId && s.sentenceId === sentenceId,
        ) ?? null
      );
    },
  };
}
