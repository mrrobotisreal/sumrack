CREATE TABLE `pack_full_audio` (
	`pack_id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`voice` text NOT NULL,
	`style` text NOT NULL,
	`file` text NOT NULL,
	`local_uri` text,
	`duration_ms` integer NOT NULL,
	`gap_ms` integer NOT NULL,
	`segments` text NOT NULL,
	FOREIGN KEY (`pack_id`) REFERENCES `packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `packs` ADD `cover_file` text;--> statement-breakpoint
ALTER TABLE `packs` ADD `cover_local_uri` text;