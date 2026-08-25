CREATE TABLE `dialogue_choices` (
	`pack_id` text NOT NULL,
	`dialogue_id` text NOT NULL,
	`node_id` text NOT NULL,
	`id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`sentence_id` text NOT NULL,
	`next_node_id` text NOT NULL,
	`asr_alternates` text,
	`hint_ru` text,
	`hint_en` text,
	PRIMARY KEY(`pack_id`, `dialogue_id`, `node_id`, `id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dialogue_choices_node_idx` ON `dialogue_choices` (`pack_id`,`dialogue_id`,`node_id`,`order_idx`);--> statement-breakpoint
CREATE TABLE `dialogue_endings` (
	`pack_id` text NOT NULL,
	`dialogue_id` text NOT NULL,
	`id` text NOT NULL,
	`title_ru` text NOT NULL,
	`title_en` text NOT NULL,
	`recap_ru` text NOT NULL,
	`recap_en` text NOT NULL,
	`tone` text NOT NULL,
	PRIMARY KEY(`pack_id`, `dialogue_id`, `id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dialogue_node_audio` (
	`pack_id` text NOT NULL,
	`dialogue_id` text NOT NULL,
	`node_id` text NOT NULL,
	`choice_id` text,
	`sentence_id` text NOT NULL,
	`file` text NOT NULL,
	`local_uri` text,
	`duration_ms` integer NOT NULL,
	PRIMARY KEY(`pack_id`, `sentence_id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dialogue_node_audio_dialogue_idx` ON `dialogue_node_audio` (`pack_id`,`dialogue_id`);--> statement-breakpoint
CREATE TABLE `dialogue_node_stamps` (
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
CREATE TABLE `dialogue_nodes` (
	`pack_id` text NOT NULL,
	`dialogue_id` text NOT NULL,
	`id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`speaker_id` text NOT NULL,
	`sentence_id` text NOT NULL,
	`kind` text NOT NULL,
	`next_node_id` text,
	`ending_id` text,
	PRIMARY KEY(`pack_id`, `dialogue_id`, `id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dialogue_nodes_dialogue_idx` ON `dialogue_nodes` (`pack_id`,`dialogue_id`,`order_idx`);--> statement-breakpoint
CREATE TABLE `dialogues` (
	`pack_id` text NOT NULL,
	`id` text NOT NULL,
	`order_idx` integer NOT NULL,
	`title_ru` text NOT NULL,
	`title_en` text NOT NULL,
	`level` text NOT NULL,
	`start_node_id` text NOT NULL,
	`characters` text NOT NULL,
	PRIMARY KEY(`pack_id`, `id`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dialogues_id_idx` ON `dialogues` (`id`);--> statement-breakpoint
CREATE TABLE `dialogue_endings_seen` (
	`dialogue_id` text NOT NULL,
	`ending_id` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`dialogue_id`, `ending_id`)
);
--> statement-breakpoint
CREATE TABLE `dialogue_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`dialogue_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`ending_id` text,
	`path_json` text NOT NULL,
	`spoken_score_avg` real
);
--> statement-breakpoint
CREATE INDEX `dialogue_runs_dialogue_idx` ON `dialogue_runs` (`dialogue_id`,`started_at`);