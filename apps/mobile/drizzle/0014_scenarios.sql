CREATE TABLE `scenario_assets` (
	`pack_id` text NOT NULL,
	`file` text NOT NULL,
	`local_uri` text,
	`bytes` integer,
	PRIMARY KEY(`pack_id`, `file`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scenario_glossary` (
	`pack_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`id` text NOT NULL,
	`ru` text NOT NULL,
	`ru_norm` text NOT NULL,
	`en` text NOT NULL,
	`forms_json` text NOT NULL,
	`translit_json` text NOT NULL,
	`explain_sentence_id` text NOT NULL,
	`how_to_say_sentence_id` text NOT NULL,
	PRIMARY KEY(`pack_id`, `scenario_id`, `id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenario_glossary_norm_idx` ON `scenario_glossary` (`pack_id`,`scenario_id`,`ru_norm`);--> statement-breakpoint
CREATE TABLE `scenario_line_audio` (
	`pack_id` text NOT NULL,
	`sentence_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`variant` text NOT NULL,
	`file` text NOT NULL,
	`local_uri` text,
	`duration_ms` integer NOT NULL,
	`mouth` text,
	PRIMARY KEY(`pack_id`, `sentence_id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenario_line_audio_scenario_idx` ON `scenario_line_audio` (`pack_id`,`scenario_id`);--> statement-breakpoint
CREATE TABLE `scenario_line_stamps` (
	`pack_id` text NOT NULL,
	`sentence_id` text NOT NULL,
	`stamp_index` integer NOT NULL,
	`token_index` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	PRIMARY KEY(`pack_id`, `sentence_id`, `stamp_index`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scenario_turns` (
	`pack_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`speaker_id` text NOT NULL,
	`say_json` text NOT NULL,
	`expect_json` text,
	`retry_json` text,
	`next_json` text,
	`ending_id` text,
	PRIMARY KEY(`pack_id`, `scenario_id`, `id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenario_turns_scenario_idx` ON `scenario_turns` (`pack_id`,`scenario_id`,`order_idx`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`pack_id` text NOT NULL,
	`id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`family_id` text NOT NULL,
	`title_ru` text NOT NULL,
	`title_en` text NOT NULL,
	`level` text NOT NULL,
	`language` text NOT NULL,
	`brief_ru` text NOT NULL,
	`brief_en` text NOT NULL,
	`cast_json` text NOT NULL,
	`scene_json` text NOT NULL,
	`start_turn_id` text NOT NULL,
	`endings_json` text NOT NULL,
	`nudges_json` text NOT NULL,
	`glossary_count` integer NOT NULL,
	PRIMARY KEY(`pack_id`, `id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenarios_id_idx` ON `scenarios` (`id`);--> statement-breakpoint
CREATE TABLE `scenario_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`kind` text NOT NULL,
	`outcome` text NOT NULL,
	`transcript` text NOT NULL,
	`detail_json` text NOT NULL,
	`audio_file` text,
	`audio_duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `scenario_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenario_attempts_run_idx` ON `scenario_attempts` (`run_id`,`turn_id`,`attempt_no`);--> statement-breakpoint
CREATE TABLE `scenario_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`family_id` text NOT NULL,
	`level` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`ending_id` text,
	`path_json` text NOT NULL,
	`stats_json` text,
	`pinned` integer DEFAULT false NOT NULL,
	`media_local` integer DEFAULT true NOT NULL,
	`media_bundle_state` text,
	`media_bundle_name` text,
	`game_session_id` text
);
--> statement-breakpoint
CREATE INDEX `scenario_runs_scenario_idx` ON `scenario_runs` (`scenario_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `scenario_runs_finished_idx` ON `scenario_runs` (`finished_at`);