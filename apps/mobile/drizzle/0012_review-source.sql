ALTER TABLE `review_log` ADD `source` text;--> statement-breakpoint
CREATE INDEX `review_log_source_idx` ON `review_log` (`card_id`,`source`,`reviewed_at`);