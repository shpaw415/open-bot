CREATE TABLE `media_albums` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_albums_user_name` ON `media_albums` (`user_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_albums_user_session` ON `media_albums` (`user_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `media_albums_user` ON `media_albums` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`album_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`source_path` text NOT NULL,
	`session_id` text,
	`message_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_album_sha` ON `media_items` (`album_id`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_message_path` ON `media_items` (`message_id`,`source_path`);--> statement-breakpoint
CREATE INDEX `media_items_album` ON `media_items` (`album_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_items_user` ON `media_items` (`user_id`);--> statement-breakpoint
CREATE INDEX `media_items_created` ON `media_items` (`created_at`);