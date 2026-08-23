CREATE TABLE `frozen_days` (
	`date` text PRIMARY KEY NOT NULL,
	`consumed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `daily_activity` ADD `goal_met_at` integer;--> statement-breakpoint
ALTER TABLE `daily_activity` ADD `xp` integer DEFAULT 0 NOT NULL;