import { sql } from 'drizzle-orm';

import { computeStreak } from '@/lib/streak';

import type { SumrakDB } from '../types';

/**
 * Progress-dashboard aggregations (T18, design §7.6). Read-only: this repo
 * never writes. Every number here is designed to reconcile with a raw SQL
 * spot-check (ticket acceptance) — the queries are deliberately explicit
 * about their definitions, all recorded in the T18 session notes:
 *
 * - **Stability bands** (T18 decision): per reviewed card (reps > 0),
 *   FSRS `stability` (days) < 7 → learning ("shaky"), 7–30 → young,
 *   ≥ 30 → mature. A lemma's band is the band of the MINIMUM stability
 *   across its bank item's reviewed ru-en/en-ru cards (weakest link);
 *   listening/production cards train other skills and do not vouch for
 *   "knowing" a word. reps = 0 on all core cards → collected, no band.
 * - **Encountered** = distinct lemmas appearing in *read* sentences
 *   (story finished, or orderIdx ≤ the saved reading position — the T13
 *   sentence-source rule) ∪ collected lemmas (manual adds count even if
 *   never met in a story).
 * - **A lemma's CEFR level** = the minimum (easiest) level across all its
 *   content tokens; bank items whose lemma isn't in installed content fall
 *   back to the bank item's own level; still unknown → 'unleveled'.
 * - ё/е tolerance is inherited by construction: every join runs on the
 *   pre-computed `lemma_norm` shadow columns (T03), never on raw text.
 */

export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
export const CEFR_ORDER: Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

/** T18 stability-band thresholds, in FSRS stability days. */
export const STABILITY_YOUNG_MIN = 7;
export const STABILITY_MATURE_MIN = 30;

const LEVEL_TO_ORD = `CASE level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 END`;
const ORD_TO_LEVEL: Record<number, Cefr> = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1' };

export interface VocabLevelStats {
  level: Cefr | 'unleveled';
  /** Distinct lemmas met in read sentences or collected into the bank. */
  encountered: number;
  /** Of those, lemmas present as word bank items. */
  collected: number;
  /** Collected lemmas whose weakest reviewed core card sits in each band. */
  learning: number;
  young: number;
  mature: number;
}

export interface GrammarTopicStats {
  level: Cefr;
  topic: string;
  /** Topic comes from a course-unit lesson's own topic list (§7.6 "the level's topic list"). */
  core: boolean;
  /** Sentences in installed packs tagged with this topic. */
  sentenceCount: number;
  /** Of those, sentences the user has actually read. */
  readSentenceCount: number;
  /** Distinct annotated lemmas across the topic's sentences. */
  lemmasTotal: number;
  /** Of those, lemmas with at least one reviewed core card. */
  lemmasReviewed: number;
}

export interface ActivityTotals {
  reviewsDone: number;
  readingMs: number;
  storiesFinished: number;
  /** Consecutive days (ending today or yesterday) with any recorded activity. */
  activityStreak: number;
  /** Last 14 calendar days, oldest first, zero-filled. */
  recentDays: { date: string; reviewsDone: number; readingMs: number; storiesFinished: number }[];
}

export interface PronunciationDay {
  date: string;
  avgScore: number;
  attempts: number;
}

export interface WeakLemma {
  bankItemId: string;
  lemma: string | null;
  surface: string;
  translation: string;
  level: Cefr | null;
  /** Weakest reviewed core-card stability (days). */
  minStability: number;
  /** Staleness-weighted rank score — lower = needs work more. */
  rankScore: number;
}

export interface WeakPronunciationItem {
  bankItemId: string;
  surface: string;
  lemma: string | null;
  translation: string;
  stability: number;
  /** Average of recent per-attempt scores when T18+ sessions recorded them. */
  recentAvgScore: number | null;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The read-sentence CTE fragment shared by several queries (T13 rule). */
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

export function createDashboardRepo(db: SumrakDB) {
  return {
    /** Vocab-by-level rollup (§7.6) — one row per CEFR level with lemmas. */
    async getVocabByLevel(): Promise<VocabLevelStats[]> {
      const rows = await db.all<{
        lvl: number | null;
        encountered: number;
        collected: number;
        learning: number;
        young: number;
        mature: number;
      }>(sql`
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
      return rows.map((r) => ({
        level: r.lvl != null ? ORD_TO_LEVEL[r.lvl]! : 'unleveled',
        encountered: r.encountered,
        collected: r.collected,
        learning: r.learning,
        young: r.young,
        mature: r.mature,
      }));
    },

    /**
     * Grammar coverage (§7.6): every topic shipped in installed packs at
     * each level — union of sentence tags and lesson topic lists (lesson
     * topics flagged `core`). "Seen" = the topic has ≥ 1 read sentence;
     * "practiced" = ≥ 1 of its sentence lemmas has a reviewed core card.
     */
    async getGrammarCoverage(): Promise<GrammarTopicStats[]> {
      const sentenceRows = await db.all<{
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
      const lessonRows = await db.all<{ lvl: number; topic: string }>(sql`
        SELECT ${sql.raw(LEVEL_TO_ORD.replace(/level/g, 'p.level'))} AS lvl, je.value AS topic
        FROM lessons l
        JOIN packs p ON p.id = l.pack_id,
             json_each(l.grammar_topics) je
        WHERE l.grammar_topics IS NOT NULL
      `);

      const core = new Set(lessonRows.map((r) => `${r.lvl}|${r.topic}`));
      const byKey = new Map<string, GrammarTopicStats>();
      for (const r of sentenceRows) {
        byKey.set(`${r.lvl}|${r.topic}`, {
          level: ORD_TO_LEVEL[r.lvl]!,
          topic: r.topic,
          core: core.has(`${r.lvl}|${r.topic}`),
          sentenceCount: r.sentences,
          readSentenceCount: r.read_sentences,
          lemmasTotal: r.lemmas,
          lemmasReviewed: r.reviewed,
        });
      }
      // Lesson topics with no tagged sentence still belong to the universe.
      for (const r of lessonRows) {
        const key = `${r.lvl}|${r.topic}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            level: ORD_TO_LEVEL[r.lvl]!,
            topic: r.topic,
            core: true,
            sentenceCount: 0,
            readSentenceCount: 0,
            lemmasTotal: 0,
            lemmasReviewed: 0,
          });
        }
      }
      return [...byKey.values()].sort(
        (a, b) =>
          CEFR_ORDER.indexOf(a.level) - CEFR_ORDER.indexOf(b.level) ||
          a.topic.localeCompare(b.topic),
      );
    },

    /**
     * Lifetime + recent activity from `daily_activity` (the acceptance
     * criterion's reconciliation source). Since T19 the streak is the REAL
     * goal-met streak (goal_met_at + frozen_days via lib/streak) — the same
     * walk the Today ring uses, so the two can never disagree.
     */
    async getActivityTotals(now: Date = new Date()): Promise<ActivityTotals> {
      const totals = await db.all<{ reviews: number; reading: number; stories: number }>(sql`
        SELECT COALESCE(SUM(reviews_done), 0) AS reviews,
               COALESCE(SUM(reading_ms), 0) AS reading,
               COALESCE(SUM(stories_finished), 0) AS stories
        FROM daily_activity
      `);
      const days = await db.all<{
        date: string;
        reviews_done: number;
        reading_ms: number;
        stories_finished: number;
      }>(sql`
        SELECT date, reviews_done, reading_ms, stories_finished
        FROM daily_activity
        WHERE reviews_done > 0 OR reading_ms > 0 OR stories_finished > 0
        ORDER BY date DESC
      `);

      const metRows = await db.all<{ date: string }>(
        sql`SELECT date FROM daily_activity WHERE goal_met_at IS NOT NULL`,
      );
      const frozenRows = await db.all<{ date: string }>(sql`SELECT date FROM frozen_days`);
      const activityStreak = computeStreak(localDateKey(now), {
        met: new Set(metRows.map((r) => r.date)),
        frozen: new Set(frozenRows.map((r) => r.date)),
      }).current;

      const byDate = new Map(days.map((d) => [d.date, d]));
      const recentDays: ActivityTotals['recentDays'] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = localDateKey(d);
        const row = byDate.get(key);
        recentDays.push({
          date: key,
          reviewsDone: row?.reviews_done ?? 0,
          readingMs: row?.reading_ms ?? 0,
          storiesFinished: row?.stories_finished ?? 0,
        });
      }

      const t = totals[0];
      return {
        reviewsDone: t?.reviews ?? 0,
        readingMs: t?.reading ?? 0,
        storiesFinished: t?.stories ?? 0,
        activityStreak,
        recentDays,
      };
    },

    /**
     * Pronunciation score-over-time (§7.6). Source: the local analytics log
     * (`pron_item_graded.bestScore` — every graded attempt since T12,
     * including history from before T18 started writing per-item scores
     * into `game_sessions.detail`). Grouped by device-local day.
     *
     * T22: windowed to the last 180 days — analytics_events grows without
     * bound and the chart is a recent-trend view, not an archive. The
     * overall average is computed over the same window.
     */
    async getPronunciationTrend(): Promise<{
      days: PronunciationDay[];
      overallAvg: number | null;
    }> {
      const windowStart = Date.now() - 180 * 24 * 60 * 60 * 1000;
      const rows = await db.all<{ created_at: number; score: number }>(sql`
        SELECT created_at, CAST(json_extract(props, '$.bestScore') AS REAL) AS score
        FROM analytics_events
        WHERE event = 'pron_item_graded'
          AND created_at >= ${windowStart}
          AND json_extract(props, '$.bestScore') IS NOT NULL
        ORDER BY created_at ASC
      `);
      if (rows.length === 0) return { days: [], overallAvg: null };
      const byDay = new Map<string, { sum: number; n: number }>();
      let sum = 0;
      for (const r of rows) {
        const key = localDateKey(new Date(r.created_at));
        const agg = byDay.get(key) ?? { sum: 0, n: 0 };
        agg.sum += r.score;
        agg.n += 1;
        byDay.set(key, agg);
        sum += r.score;
      }
      const days = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, agg]) => ({
          date,
          avgScore: Math.round(agg.sum / agg.n),
          attempts: agg.n,
        }));
      return { days, overallAvg: Math.round(sum / rows.length) };
    },

    /**
     * "What needs work" (a): worst-stability lemmas among learning/young
     * band cards, staleness-weighted (T18 decision): rank score =
     * min over core cards of stability / (1 + days overdue) — a weak card
     * that is also long overdue sorts first. Mature cards are excluded
     * (they're the "known" set).
     */
    async getWeakestLemmas(limit = 8, now = Date.now()): Promise<WeakLemma[]> {
      const rows = await db.all<{
        id: string;
        lemma: string | null;
        surface: string;
        translation: string;
        level: Cefr | null;
        min_stability: number;
        rank_score: number;
      }>(sql`
        SELECT b.id, b.lemma, b.surface, b.translation, b.level,
               MIN(c.stability) AS min_stability,
               MIN(c.stability / (1.0 + MAX(0, (${now} - c.due_at) / 86400000.0))) AS rank_score
        FROM bank_items b
        JOIN cards c ON c.bank_item_id = b.id
        WHERE b.kind = 'word'
          AND c.direction IN ('ru-en', 'en-ru')
          AND c.reps > 0 AND c.stability < ${STABILITY_MATURE_MIN}
        GROUP BY b.id
        ORDER BY rank_score ASC
        LIMIT ${limit}
      `);
      return rows.map((r) => ({
        bankItemId: r.id,
        lemma: r.lemma,
        surface: r.surface,
        translation: r.translation,
        level: r.level,
        minStability: r.min_stability,
        rankScore: r.rank_score,
      }));
    },

    /**
     * "What needs work" (c): weakest pronunciation items — production cards
     * with review history, weakest stability first. `recentAvgScore` merges
     * in per-item scores from `game_sessions.detail` (written by T18+
     * pronunciation sessions; older sessions never recorded them, so null
     * is common and the stability ranking carries those).
     */
    async getWeakestPronunciation(limit = 6): Promise<WeakPronunciationItem[]> {
      const rows = await db.all<{
        id: string;
        surface: string;
        lemma: string | null;
        translation: string;
        stability: number;
      }>(sql`
        SELECT b.id, b.surface, b.lemma, b.translation, c.stability
        FROM bank_items b
        JOIN cards c ON c.bank_item_id = b.id
        WHERE c.direction = 'production' AND c.reps > 0
        ORDER BY c.stability ASC
        LIMIT ${limit}
      `);
      const sessions = await db.all<{ detail: string }>(sql`
        SELECT detail FROM game_sessions
        WHERE mode = 'pronunciation' AND detail IS NOT NULL
        ORDER BY started_at DESC
        LIMIT 20
      `);
      const scores = new Map<string, { sum: number; n: number }>();
      for (const s of sessions) {
        try {
          const parsed = JSON.parse(s.detail) as {
            scores?: { bankItemId?: unknown; score?: unknown }[];
          };
          for (const entry of parsed.scores ?? []) {
            if (typeof entry.bankItemId !== 'string' || typeof entry.score !== 'number') continue;
            const agg = scores.get(entry.bankItemId) ?? { sum: 0, n: 0 };
            agg.sum += entry.score;
            agg.n += 1;
            scores.set(entry.bankItemId, agg);
          }
        } catch {
          // detail written by another mode/shape — ignore.
        }
      }
      return rows.map((r) => {
        const agg = scores.get(r.id);
        return {
          bankItemId: r.id,
          surface: r.surface,
          lemma: r.lemma,
          translation: r.translation,
          stability: r.stability,
          recentAvgScore: agg ? Math.round(agg.sum / agg.n) : null,
        };
      });
    },

    /**
     * Bank items to practice for one grammar topic — the "practice now"
     * payload for the topic list: word items whose lemma occurs in a
     * sentence tagged with the topic, weakest core card first.
     */
    async getTopicPracticeItemIds(level: Cefr, topic: string, limit = 12): Promise<string[]> {
      const rows = await db.all<{ id: string }>(sql`
        WITH topic_sent AS (
          SELECT s.pack_id, s.id AS sentence_id
          FROM sentences s
          JOIN packs p ON p.id = s.pack_id,
               json_each(s.grammar_topics) je
          WHERE je.value = ${topic} AND p.level = ${level}
        )
        SELECT b.id
        FROM bank_items b
        JOIN tokens t ON t.lemma_norm = b.lemma_norm AND t.is_punct = 0
        JOIN topic_sent ts ON ts.pack_id = t.pack_id AND ts.sentence_id = t.sentence_id
        WHERE b.kind = 'word' AND b.lemma_norm IS NOT NULL
        GROUP BY b.id
        ORDER BY (SELECT MIN(c.stability) FROM cards c
                   WHERE c.bank_item_id = b.id AND c.direction IN ('ru-en', 'en-ru')) ASC
        LIMIT ${limit}
      `);
      return rows.map((r) => r.id);
    },
  };
}

export type DashboardRepo = ReturnType<typeof createDashboardRepo>;
