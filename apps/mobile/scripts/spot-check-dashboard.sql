-- T18 dashboard spot-check queries — raw SQL mirrors of the dashboard
-- repo's definitions, for reconciling on-screen numbers against the
-- device DB (ticket item 7 + acceptance criteria). Usage:
--
--   mkdir -p /tmp/sumrak-db && cd /tmp/sumrak-db
--   for f in sumrak.db sumrak.db-shm sumrak.db-wal; do
--     adb exec-out "run-as io.winapps.sumrak cat files/SQLite/$f" > $f; done
--   sqlite3 sumrak.db < <path-to>/spot-check-dashboard.sql
--
-- Definitions (recorded T18 decisions):
--   bands by MIN reviewed ru-en/en-ru card stability: <7 shaky · 7–30 young · ≥30 mature
--   encountered = lemmas in READ sentences (finished story or orderIdx ≤ position) ∪ bank words
--   lemma level = MIN content-token level, else the bank item's own level
--   topic seen = ≥1 read sentence tagged; practiced = ≥1 topic-sentence lemma reviewed

.headers on
.mode column

SELECT '== vocab by level (dashboard Vocabulary section) ==';
WITH read_sent AS (
  SELECT s.pack_id, s.id sid FROM sentences s JOIN story_progress p
    ON p.pack_id=s.pack_id AND p.story_id=s.story_id
  WHERE p.finished_at IS NOT NULL OR s.order_idx <= p.current_sentence_idx),
clv AS (SELECT lemma_norm, MIN(CASE level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 END) l
        FROM tokens WHERE is_punct=0 AND lemma_norm IS NOT NULL AND level IS NOT NULL GROUP BY lemma_norm),
seen AS (SELECT DISTINCT t.lemma_norm FROM tokens t JOIN read_sent r ON r.pack_id=t.pack_id AND r.sid=t.sentence_id
         WHERE t.is_punct=0 AND t.lemma_norm IS NOT NULL),
bw AS (SELECT b.lemma_norm, CASE b.level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 END bl,
       (SELECT MIN(c.stability) FROM cards c WHERE c.bank_item_id=b.id AND c.direction IN ('ru-en','en-ru') AND c.reps>0) ms
       FROM bank_items b WHERE b.kind='word' AND b.lemma_norm IS NOT NULL),
u AS (SELECT lemma_norm FROM seen UNION SELECT lemma_norm FROM bw)
SELECT COALESCE(clv.l,bw.bl) lvl, COUNT(*) met, SUM(bw.lemma_norm IS NOT NULL) collected,
  SUM(bw.ms IS NOT NULL AND bw.ms<7) shaky, SUM(bw.ms>=7 AND bw.ms<30) young, SUM(bw.ms>=30) mature
FROM u LEFT JOIN clv ON clv.lemma_norm=u.lemma_norm LEFT JOIN bw ON bw.lemma_norm=u.lemma_norm
GROUP BY COALESCE(clv.l,bw.bl) ORDER BY 1;

SELECT '== weakest lemmas (What needs work · Shakiest words) ==';
SELECT b.lemma, b.translation, MIN(c.stability) minstab,
  ROUND(MIN(c.stability/(1.0+MAX(0,(strftime('%s','now')*1000-c.due_at)/86400000.0))),4) rank
FROM bank_items b JOIN cards c ON c.bank_item_id=b.id
WHERE b.kind='word' AND c.direction IN ('ru-en','en-ru') AND c.reps>0 AND c.stability<30
GROUP BY b.id ORDER BY rank LIMIT 8;

SELECT '== grammar coverage per level (topics practiced / total) ==';
WITH rl AS (SELECT DISTINCT b.lemma_norm FROM bank_items b JOIN cards c ON c.bank_item_id=b.id
            WHERE b.kind='word' AND c.reps>0 AND c.direction IN ('ru-en','en-ru')),
ts AS (SELECT p.level lvl, je.value topic, s.pack_id, s.id sid FROM sentences s JOIN packs p ON p.id=s.pack_id,
       json_each(s.grammar_topics) je WHERE s.grammar_topics IS NOT NULL)
SELECT lvl, COUNT(DISTINCT topic) total_topics,
  COUNT(DISTINCT CASE WHEN topic IN (
     SELECT ts2.topic FROM ts ts2 JOIN tokens t ON t.pack_id=ts2.pack_id AND t.sentence_id=ts2.sid
       AND t.is_punct=0 AND t.lemma_norm IS NOT NULL
     JOIN rl ON rl.lemma_norm=t.lemma_norm) THEN topic END) practiced
FROM ts GROUP BY lvl;

SELECT '== activity totals (Activity section stat tiles) ==';
SELECT SUM(reviews_done) reviews, SUM(reading_ms)/60000 minutes, SUM(stories_finished) stories FROM daily_activity;

SELECT '== pronunciation trend source (avg of pron_item_graded bestScore) ==';
SELECT COUNT(*) attempts, ROUND(AVG(CAST(json_extract(props,'$.bestScore') AS REAL))) avg_score
FROM analytics_events WHERE event='pron_item_graded' AND json_extract(props,'$.bestScore') IS NOT NULL;

SELECT '== stored assessments ==';
SELECT id, datetime(created_at/1000,'unixepoch') created, substr(payload,1,80) payload_head FROM assessments ORDER BY created_at;
