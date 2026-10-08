CREATE TABLE `core_lemmas` (
	`pack_id` text NOT NULL,
	`list_id` text NOT NULL,
	`level` text NOT NULL,
	`entry_idx` integer NOT NULL,
	`lemma` text NOT NULL,
	`lemma_norm` text NOT NULL,
	`pos` text,
	`translation` text,
	PRIMARY KEY(`pack_id`, `list_id`, `entry_idx`),
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `core_lemmas_norm_idx` ON `core_lemmas` (`lemma_norm`);--> statement-breakpoint
CREATE INDEX `core_lemmas_level_idx` ON `core_lemmas` (`level`);--> statement-breakpoint
CREATE TABLE `leech_dismissals` (
	`card_id` text PRIMARY KEY NOT NULL,
	`dismissed_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
