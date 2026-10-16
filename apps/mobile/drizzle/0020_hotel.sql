CREATE TABLE `course_floors` (
	`pack_id` text PRIMARY KEY NOT NULL,
	`ladder` text NOT NULL,
	`level` text NOT NULL,
	`floor` integer NOT NULL,
	`title_ru` text NOT NULL,
	`title_en` text NOT NULL,
	`json` text NOT NULL,
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_floors_ladder_idx` ON `course_floors` (`ladder`,`level`,`floor`);--> statement-breakpoint
CREATE TABLE `course_items` (
	`pack_id` text NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`topic` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`pack_id`, `item_id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `course_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`unit_id` text,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`percent` integer,
	`passed` integer,
	`item_ids` text NOT NULL,
	`responses_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `course_attempts_pack_idx` ON `course_attempts` (`pack_id`,`unit_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `course_progress` (
	`key` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`unit_id` text,
	`best_percent` integer DEFAULT 0 NOT NULL,
	`passed_at` integer,
	`passed_via` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`cooldown_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `course_progress_pack_idx` ON `course_progress` (`pack_id`);