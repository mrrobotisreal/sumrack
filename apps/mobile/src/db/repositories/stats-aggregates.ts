import { sql } from 'drizzle-orm';

import type { SumrakDB } from '../types';

/**
 * Stats aggregates fill (T100, M28) — the content-side joins the dashboard
 * used to recompute on every open, done once per pack. The importer calls
 * this inside the pack transaction after the sentence/token rows land; the
 * 0022 migration runs the same two statements unscoped as its backfill
 * (a test pins them equal). Set-based SQL, so a 1,900-block pack fills in
 * two statements instead of thousands of inserts.
 */
export async function fillStatsAggregates(db: SumrakDB, packId: string): Promise<void> {
  await db.run(sql`
    INSERT OR IGNORE INTO topic_sentences (pack_id, sentence_id, story_id, order_idx, lvl, topic)
    SELECT s.pack_id, s.id, s.story_id, s.order_idx,
           CASE p.level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 END,
           je.value
    FROM sentences s
    JOIN packs p ON p.id = s.pack_id,
         json_each(s.grammar_topics) je
    WHERE s.pack_id = ${packId} AND s.grammar_topics IS NOT NULL
  `);
  await db.run(sql`
    INSERT OR IGNORE INTO topic_lemmas (pack_id, lvl, topic, lemma_norm)
    SELECT ts.pack_id, ts.lvl, ts.topic, t.lemma_norm
    FROM topic_sentences ts
    JOIN tokens t ON t.pack_id = ts.pack_id AND t.sentence_id = ts.sentence_id
    WHERE ts.pack_id = ${packId} AND t.is_punct = 0 AND t.lemma_norm IS NOT NULL
    ORDER BY ts.lvl, ts.topic, t.lemma_norm
  `);
}
