CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`pack_id` text NOT NULL,
	`story_id` text NOT NULL,
	`sentence_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_story_uq` ON `bookmarks` (`pack_id`,`story_id`) WHERE kind = 'story';--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_sentence_uq` ON `bookmarks` (`pack_id`,`sentence_id`) WHERE kind = 'sentence';--> statement-breakpoint
CREATE INDEX `bookmarks_created_idx` ON `bookmarks` (`created_at`);