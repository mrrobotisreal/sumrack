CREATE TABLE `exams` (
	`pack_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`format` text NOT NULL,
	`level` text NOT NULL,
	`mode` text NOT NULL,
	`title_ru` text NOT NULL,
	`title_en` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`pack_id`, `exam_id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exams_mode_idx` ON `exams` (`mode`);--> statement-breakpoint
CREATE TABLE `exam_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`scope` text NOT NULL,
	`subtest_ids` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`state_json` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`results_json` text,
	`verdict` text,
	`xp_awarded` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exam_attempts_status_idx` ON `exam_attempts` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `exam_attempts_exam_idx` ON `exam_attempts` (`pack_id`,`exam_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `exam_item_cards` (
	`item_key` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`item_id` text NOT NULL,
	`subtest_kind` text NOT NULL,
	`topic` text NOT NULL,
	`fsrs_json` text NOT NULL,
	`due` integer NOT NULL,
	`last_result` text,
	`suspended` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exam_item_cards_due_idx` ON `exam_item_cards` (`due`);--> statement-breakpoint
CREATE INDEX `exam_item_cards_topic_idx` ON `exam_item_cards` (`topic`);--> statement-breakpoint
CREATE TABLE `exam_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`subtest_id` text NOT NULL,
	`item_id` text NOT NULL,
	`answer_json` text NOT NULL,
	`points` real,
	`max_points` real NOT NULL,
	`grading_status` text NOT NULL,
	`grading_json` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `exam_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_responses_item_uq` ON `exam_responses` (`attempt_id`,`subtest_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `exam_responses_grading_idx` ON `exam_responses` (`grading_status`);