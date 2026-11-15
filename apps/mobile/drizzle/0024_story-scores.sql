CREATE TABLE `story_scores` (
	`pack_id` text NOT NULL,
	`story_id` text NOT NULL,
	`id` text NOT NULL,
	`track_id` text NOT NULL,
	`file` text NOT NULL,
	`local_uri` text,
	`duration_ms` integer NOT NULL,
	PRIMARY KEY(`pack_id`, `story_id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
