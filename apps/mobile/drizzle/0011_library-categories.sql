ALTER TABLE `packs` ADD `category` text;--> statement-breakpoint
ALTER TABLE `packs` ADD `genre` text;--> statement-breakpoint
ALTER TABLE `stories` ADD `subtitle_ru` text;--> statement-breakpoint
ALTER TABLE `stories` ADD `subtitle_en` text;--> statement-breakpoint
ALTER TABLE `stories` ADD `source_name` text;--> statement-breakpoint
ALTER TABLE `stories` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `stories` ADD `source_published_at` text;--> statement-breakpoint
ALTER TABLE `stories` ADD `source_author` text;--> statement-breakpoint
CREATE INDEX `stories_source_date_idx` ON `stories` (`pack_id`,`source_published_at`);