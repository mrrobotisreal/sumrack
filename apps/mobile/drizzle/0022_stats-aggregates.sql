-- T100: both tables are pure functions of installed content, so start clean —
-- a half-applied earlier attempt (seen once on a dev client mid hot-reload)
-- can never wedge the upgrade with "table already exists".
DROP TABLE IF EXISTS `topic_lemmas`;--> statement-breakpoint
DROP TABLE IF EXISTS `topic_sentences`;--> statement-breakpoint
CREATE TABLE `topic_lemmas` (
	`pack_id` text NOT NULL,
	`lvl` integer NOT NULL,
	`topic` text NOT NULL,
	`lemma_norm` text NOT NULL,
	PRIMARY KEY(`lvl`, `topic`, `lemma_norm`, `pack_id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `topic_sentences` (
	`pack_id` text NOT NULL,
	`sentence_id` text NOT NULL,
	`story_id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`lvl` integer NOT NULL,
	`topic` text NOT NULL,
	PRIMARY KEY(`pack_id`, `sentence_id`, `topic`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `topic_sentences_story_idx` ON `topic_sentences` (`pack_id`,`story_id`,`order_idx`);--> statement-breakpoint
-- T100 backfill (hand-appended): fill both aggregates for every pack already
-- installed, so existing phones need no re-sync. Same SQL as
-- src/db/repositories/stats-aggregates.ts (a test pins them equal).
INSERT OR IGNORE INTO `topic_sentences` (`pack_id`, `sentence_id`, `story_id`, `order_idx`, `lvl`, `topic`)
SELECT s.pack_id, s.id, s.story_id, s.order_idx,
       CASE p.level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 END,
       je.value
FROM sentences s
JOIN packs p ON p.id = s.pack_id,
     json_each(s.grammar_topics) je
WHERE s.grammar_topics IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `topic_lemmas` (`pack_id`, `lvl`, `topic`, `lemma_norm`)
SELECT ts.pack_id, ts.lvl, ts.topic, t.lemma_norm
FROM topic_sentences ts
JOIN tokens t ON t.pack_id = ts.pack_id AND t.sentence_id = ts.sentence_id
WHERE t.is_punct = 0 AND t.lemma_norm IS NOT NULL
ORDER BY ts.lvl, ts.topic, t.lemma_norm, ts.pack_id;
