CREATE TABLE `story_progress` (
	`pack_id` text NOT NULL,
	`story_id` text NOT NULL,
	`current_sentence_idx` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	PRIMARY KEY(`pack_id`, `story_id`)
);
