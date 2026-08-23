CREATE TABLE `frozen_days` (
	`date` text PRIMARY KEY NOT NULL,
	`consumed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `daily_activity` ADD `goal_met_at` integer;--> statement-breakpoint
ALTER TABLE `daily_activity` ADD `xp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- One-time historic backfill: days recorded before T19 shipped are stamped
-- goal-met when they satisfied the DEFAULT goal (20 reviews + 10 min reading
-- — the exact targets the T06 placeholder displayed), so an honest streak
-- survives the upgrade. New days are stamped live by the motivation service.
UPDATE `daily_activity` SET `goal_met_at` = `updated_at`
  WHERE `goal_met_at` IS NULL AND `reviews_done` >= 20 AND `reading_ms` >= 600000;
