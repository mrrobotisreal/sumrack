CREATE INDEX `tokens_story_idx` ON `tokens` (`pack_id`,`story_id`,`token_index`);--> statement-breakpoint
CREATE INDEX `tokens_level_lemma_idx` ON `tokens` (`lemma_norm`,`level`) WHERE is_punct = 0 AND lemma_norm IS NOT NULL AND level IS NOT NULL;--> statement-breakpoint
CREATE INDEX `journal_entries_updated_idx` ON `journal_entries` (`updated_at`);--> statement-breakpoint
CREATE INDEX `review_log_reviewed_at_idx` ON `review_log` (`reviewed_at`);