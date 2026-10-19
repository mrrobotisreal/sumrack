import { sql } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STABILITY_MATURE_MIN, STABILITY_YOUNG_MIN } from '@/lib/mastery';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import type { SumrakDB } from '../types';
import { createTestDb } from './helpers';

/**
 * T100 golden equality: the dashboard's grammar / core-coverage / gaps /
 * vocab queries were rewritten onto the import-time aggregates
 * (topic_sentences, topic_lemmas) and a read_sent-driven `seen`. These are
 * the pre-T100 SQL bodies, verbatim (kept ONLY here), run against the same
 * DB: every fixture pack, partial + finished progress, bank words in every
 * band. Results must be deep-equal.
 */

const LEVEL_TO_ORD = `CASE level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 END`;

const READ_SENTENCES = sql`
  read_sent AS (
    SELECT s.pack_id, s.id AS sentence_id
    FROM sentences s
    JOIN story_progress p ON p.pack_id = s.pack_id AND p.story_id = s.story_id
    WHERE p.finished_at IS NOT NULL OR s.order_idx <= p.current_sentence_idx
  )`;

const REVIEWED_LEMMAS = sql`
  reviewed_lemmas AS (
    SELECT DISTINCT b.lemma_norm
    FROM bank_items b
    JOIN cards c ON c.bank_item_id = b.id
    WHERE b.kind = 'word' AND b.lemma_norm IS NOT NULL
      AND c.direction IN ('ru-en', 'en-ru') AND c.reps > 0
  )`;

const CORE_JOIN = sql`
  core AS (
    SELECT DISTINCT level, lemma_norm FROM core_lemmas
  ),
  seen AS (
    SELECT DISTINCT t.lemma_norm
    FROM tokens t
    JOIN read_sent rs ON rs.pack_id = t.pack_id AND rs.sentence_id = t.sentence_id
    WHERE t.is_punct = 0 AND t.lemma_norm IS NOT NULL
  ),
  bank_words AS (
    SELECT b.lemma_norm,
           MIN((SELECT MIN(c.stability) FROM cards c
                 WHERE c.bank_item_id = b.id
                   AND c.direction IN ('ru-en', 'en-ru') AND c.reps > 0)) AS min_stab
    FROM bank_items b
    WHERE b.kind = 'word' AND b.lemma_norm IS NOT NULL
    GROUP BY b.lemma_norm
  )`;

const FIXTURES = join(__dirname, '../../../../../packages/schema/fixtures/packs');
const fixture = (id: string) => JSON.parse(readFileSync(join(FIXTURES, id, 'pack.json'), 'utf8'));

async function seeded(): Promise<{ db: SumrakDB; repos: ReturnType<typeof createRepositories> }> {
  const db = createTestDb();
  const repos = createRepositories(db);
  for (const id of readdirSync(FIXTURES).sort()) {
    await importPack(db, fixture(id), { source: 'local-file' });
  }
  return { db, repos };
}

async function readSomething(db: SumrakDB, repos: ReturnType<typeof createRepositories>) {
  const stories = await db.all<{ pack_id: string; id: string; n: number }>(sql`
    SELECT st.pack_id, st.id, (SELECT COUNT(*) FROM sentences s
                               WHERE s.pack_id = st.pack_id AND s.story_id = st.id) AS n
    FROM stories st ORDER BY st.pack_id, st.order_idx`);
  // Every other story: finished, half-read, or untouched.
  for (const [i, st] of stories.entries()) {
    if (i % 3 === 0) await repos.reading.markFinished(st.pack_id, st.id);
    else if (i % 3 === 1) await repos.reading.savePosition(st.pack_id, st.id, Math.floor(st.n / 2));
  }
  // Bank words from content lemmas (+ one bank-only), cards in every band.
  const lemmas = await db.all<{ lemma: string }>(sql`
    SELECT DISTINCT lemma FROM tokens WHERE lemma IS NOT NULL AND is_punct = 0
    ORDER BY lemma LIMIT 40`);
  const bands = [null, 2, STABILITY_YOUNG_MIN, 12, STABILITY_MATURE_MIN, 90];
  for (const [i, { lemma }] of [...lemmas, { lemma: 'небывалоеслово' }].entries()) {
    const { item } = await repos.bank.addWord({ lemma, surface: lemma, translation: 'x' });
    const stability = bands[i % bands.length];
    if (stability == null) continue;
    for (const c of await repos.reviews.listCardsForItem(item.id)) {
      if (c.direction === 'ru-en' || (c.direction === 'en-ru' && i % 2 === 0)) {
        await repos.reviews.saveCard({ ...c, stability, reps: 1, state: 2 });
      }
    }
  }
}

const sortRows = <T>(rows: T[]) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('T100 golden equality — old SQL ≡ new SQL', () => {
  it('has enough content to mean something', async () => {
    const { db } = await seeded();
    const n = await db.all<{ ts: number; tl: number; cl: number }>(sql`
      SELECT (SELECT COUNT(*) FROM topic_sentences) AS ts,
             (SELECT COUNT(*) FROM topic_lemmas) AS tl,
             (SELECT COUNT(*) FROM core_lemmas) AS cl`);
    expect(n[0]!.ts).toBeGreaterThan(30);
    expect(n[0]!.tl).toBeGreaterThan(100);
    expect(n[0]!.cl).toBeGreaterThan(0);
  });

  for (const state of ['empty progress', 'partial + finished progress, banded bank'] as const) {
    it(`grammar coverage rows match (${state})`, async () => {
      const { db, repos } = await seeded();
      if (state !== 'empty progress') await readSomething(db, repos);
      const oldRows = await db.all<{
        lvl: number;
        topic: string;
        sentences: number;
        read_sentences: number;
        lemmas: number;
        reviewed: number;
      }>(sql`
        WITH ${READ_SENTENCES},
        ${REVIEWED_LEMMAS},
        topic_sent AS (
          SELECT ${sql.raw(LEVEL_TO_ORD.replace(/level/g, 'p.level'))} AS lvl,
                 je.value AS topic, s.pack_id, s.id AS sentence_id,
                 EXISTS (SELECT 1 FROM read_sent rs
                          WHERE rs.pack_id = s.pack_id AND rs.sentence_id = s.id) AS is_read
          FROM sentences s
          JOIN packs p ON p.id = s.pack_id,
               json_each(s.grammar_topics) je
          WHERE s.grammar_topics IS NOT NULL
        )
        SELECT ts.lvl, ts.topic,
               COUNT(DISTINCT ts.pack_id || '|' || ts.sentence_id) AS sentences,
               COUNT(DISTINCT CASE WHEN ts.is_read THEN ts.pack_id || '|' || ts.sentence_id END)
                 AS read_sentences,
               COUNT(DISTINCT t.lemma_norm) AS lemmas,
               COUNT(DISTINCT CASE WHEN rl.lemma_norm IS NOT NULL THEN t.lemma_norm END)
                 AS reviewed
        FROM topic_sent ts
        LEFT JOIN tokens t ON t.pack_id = ts.pack_id AND t.sentence_id = ts.sentence_id
                          AND t.is_punct = 0 AND t.lemma_norm IS NOT NULL
        LEFT JOIN reviewed_lemmas rl ON rl.lemma_norm = t.lemma_norm
        GROUP BY ts.lvl, ts.topic
      `);
      const got = await repos.dashboard.getGrammarCoverage();
      const fromOld = sortRows(
        oldRows.map((r) => ({
          topic: r.topic,
          sentenceCount: r.sentences,
          readSentenceCount: r.read_sentences,
          lemmasTotal: r.lemmas,
          lemmasReviewed: r.reviewed,
          lvl: r.lvl,
        })),
      );
      const ORD: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
      const fromNew = sortRows(
        got
          .filter((g) => g.sentenceCount > 0)
          .map((g) => ({
            topic: g.topic,
            sentenceCount: g.sentenceCount,
            readSentenceCount: g.readSentenceCount,
            lemmasTotal: g.lemmasTotal,
            lemmasReviewed: g.lemmasReviewed,
            lvl: ORD[g.level]!,
          })),
      );
      expect(fromNew.length).toBeGreaterThan(5);
      expect(fromNew).toEqual(fromOld);
      if (state !== 'empty progress') {
        expect(fromNew.some((r) => r.readSentenceCount > 0)).toBe(true);
        expect(fromNew.some((r) => r.lemmasReviewed > 0)).toBe(true);
      }
    });

    it(`core coverage, gaps and vocab-by-level match (${state})`, async () => {
      const { db, repos } = await seeded();
      if (state !== 'empty progress') await readSomething(db, repos);

      const oldCov = await db.all(sql`
        WITH ${READ_SENTENCES}, ${CORE_JOIN}
        SELECT core.level AS level,
               COUNT(*) AS total,
               SUM(CASE WHEN s.lemma_norm IS NOT NULL OR bw.lemma_norm IS NOT NULL
                        THEN 1 ELSE 0 END) AS encountered,
               SUM(CASE WHEN bw.lemma_norm IS NOT NULL THEN 1 ELSE 0 END) AS collected,
               SUM(CASE WHEN bw.min_stab >= ${STABILITY_MATURE_MIN} THEN 1 ELSE 0 END) AS mastered
        FROM core
        LEFT JOIN seen s ON s.lemma_norm = core.lemma_norm
        LEFT JOIN bank_words bw ON bw.lemma_norm = core.lemma_norm
        GROUP BY core.level
      `);
      const newCov = await repos.dashboard.getCoreCoverage();
      expect(sortRows(newCov)).toEqual(sortRows(oldCov));

      for (const level of ['A1', 'A2'] as const) {
        const oldGaps = await db.all(sql`
        WITH ${READ_SENTENCES}, ${CORE_JOIN},
        first_entry AS (
          SELECT cl.lemma_norm, cl.lemma, cl.pos, cl.translation,
                 ROW_NUMBER() OVER (PARTITION BY cl.lemma_norm
                                    ORDER BY cl.pack_id, cl.list_id, cl.entry_idx) AS rn,
                 MIN(cl.pack_id || '|' || cl.list_id || '|' || printf('%06d', cl.entry_idx))
                   OVER (PARTITION BY cl.lemma_norm) AS ord
          FROM core_lemmas cl
          WHERE cl.level = ${level}
        )
        SELECT fe.lemma, fe.pos, fe.translation
        FROM first_entry fe
        LEFT JOIN seen s ON s.lemma_norm = fe.lemma_norm
        LEFT JOIN bank_words bw ON bw.lemma_norm = fe.lemma_norm
        WHERE fe.rn = 1 AND s.lemma_norm IS NULL AND bw.lemma_norm IS NULL
        ORDER BY fe.ord
      `);
        expect(await repos.dashboard.getCoreGaps(level)).toEqual(oldGaps);
      }

      const oldVocab = await db.all<{ lvl: number | null }>(sql`
        WITH ${READ_SENTENCES},
        content_levels AS (
          SELECT lemma_norm, MIN(${sql.raw(LEVEL_TO_ORD)}) AS lvl
          FROM tokens
          WHERE is_punct = 0 AND lemma_norm IS NOT NULL AND level IS NOT NULL
          GROUP BY lemma_norm
        ),
        seen AS (
          SELECT DISTINCT t.lemma_norm
          FROM tokens t
          JOIN read_sent rs ON rs.pack_id = t.pack_id AND rs.sentence_id = t.sentence_id
          WHERE t.is_punct = 0 AND t.lemma_norm IS NOT NULL
        ),
        bank_words AS (
          SELECT b.lemma_norm,
                 ${sql.raw(LEVEL_TO_ORD.replace(/level/g, 'b.level'))} AS b_lvl,
                 (SELECT MIN(c.stability) FROM cards c
                   WHERE c.bank_item_id = b.id
                     AND c.direction IN ('ru-en', 'en-ru') AND c.reps > 0) AS min_stab
          FROM bank_items b
          WHERE b.kind = 'word' AND b.lemma_norm IS NOT NULL
        ),
        universe AS (
          SELECT lemma_norm FROM seen
          UNION
          SELECT lemma_norm FROM bank_words
        )
        SELECT COALESCE(cl.lvl, bw.b_lvl) AS lvl,
               COUNT(*) AS encountered,
               SUM(CASE WHEN bw.lemma_norm IS NOT NULL THEN 1 ELSE 0 END) AS collected,
               SUM(CASE WHEN bw.min_stab IS NOT NULL AND bw.min_stab < ${STABILITY_YOUNG_MIN}
                        THEN 1 ELSE 0 END) AS learning,
               SUM(CASE WHEN bw.min_stab >= ${STABILITY_YOUNG_MIN} AND bw.min_stab < ${STABILITY_MATURE_MIN}
                        THEN 1 ELSE 0 END) AS young,
               SUM(CASE WHEN bw.min_stab >= ${STABILITY_MATURE_MIN} THEN 1 ELSE 0 END) AS mature
        FROM universe u
        LEFT JOIN content_levels cl ON cl.lemma_norm = u.lemma_norm
        LEFT JOIN bank_words bw ON bw.lemma_norm = u.lemma_norm
        -- the full expression, NOT the bare alias: 'lvl' would resolve to
        -- content_levels.lvl and split bank-only lemmas into a NULL group
        GROUP BY COALESCE(cl.lvl, bw.b_lvl)
        ORDER BY COALESCE(cl.lvl, bw.b_lvl) IS NULL, COALESCE(cl.lvl, bw.b_lvl)
      `);
      const newVocab = await repos.dashboard.getVocabByLevel();
      expect(newVocab.map((v) => v.encountered)).toEqual(
        oldVocab.map((v) => (v as unknown as { encountered: number }).encountered),
      );
      expect(newVocab.length).toBe(oldVocab.length);
      if (state !== 'empty progress') expect(newVocab.length).toBeGreaterThan(0);
    });
  }
});
