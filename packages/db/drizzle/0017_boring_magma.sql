CREATE TABLE `catalog_dir_items` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`dir_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `name`)
);
--> statement-breakpoint
CREATE INDEX `catalog_dir_items_dir` ON `catalog_dir_items` (`user_id`,`dir_id`);--> statement-breakpoint
CREATE TABLE `catalog_dirs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_dirs_user_kind_label` ON `catalog_dirs` (`user_id`,`kind`,`label`);--> statement-breakpoint
CREATE INDEX `catalog_dirs_user_kind` ON `catalog_dirs` (`user_id`,`kind`,`position`);