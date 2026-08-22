CREATE TABLE `unit_progress` (
	`pack_id` text PRIMARY KEY NOT NULL,
	`lesson_read_at` integer,
	`quiz_passed_at` integer,
	`quiz_best_score_percent` real,
	`completed_at` integer,
	`updated_at` integer NOT NULL
);
