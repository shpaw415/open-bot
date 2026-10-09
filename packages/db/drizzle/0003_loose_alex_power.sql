CREATE TABLE `workspace_media` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_media_message_path` ON `workspace_media` (`message_id`,`path`);--> statement-breakpoint
CREATE INDEX `workspace_media_session` ON `workspace_media` (`user_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `workspace_media_created` ON `workspace_media` (`created_at`);