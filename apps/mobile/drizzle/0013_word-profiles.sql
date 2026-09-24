CREATE TABLE `grammar_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`lemma_norm` text NOT NULL,
	`kind` text NOT NULL,
	`headword` text NOT NULL,
	`section_id` text NOT NULL,
	`profile_id` text,
	`markdown` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`quality` text NOT NULL,
	`effort` text NOT NULL,
	`effort_applied` integer DEFAULT true NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`reasoning_tokens` integer,
	`cost_usd` real,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grammar_lessons_key_idx` ON `grammar_lessons` (`lemma_norm`,`kind`,`section_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `grammar_lessons_created_idx` ON `grammar_lessons` (`created_at`);--> statement-breakpoint
CREATE TABLE `word_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`lemma_norm` text NOT NULL,
	`kind` text NOT NULL,
	`headword` text NOT NULL,
	`pos` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`payload` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`quality` text NOT NULL,
	`effort` text NOT NULL,
	`effort_applied` integer DEFAULT true NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`reasoning_tokens` integer,
	`cost_usd` real,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `word_profiles_key_idx` ON `word_profiles` (`lemma_norm`,`kind`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `word_profiles_current_uq` ON `word_profiles` (`lemma_norm`,`kind`) WHERE is_current = 1;