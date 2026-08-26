CREATE TABLE `import_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`title` text NOT NULL,
	`source_label` text,
	`status` text NOT NULL,
	`annotation_json` text,
	`error` text,
	`pack_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_requests_status_idx` ON `import_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `imported_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_label` text,
	`pack_json_gz` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `packs` ADD `origin` text DEFAULT 'remote' NOT NULL;