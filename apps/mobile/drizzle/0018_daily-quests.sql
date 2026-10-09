CREATE TABLE `daily_quests` (
	`date` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target` integer NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`snapshot` text,
	`assigned_at` integer NOT NULL,
	`completed_at` integer,
	`xp` integer DEFAULT 0 NOT NULL
);
