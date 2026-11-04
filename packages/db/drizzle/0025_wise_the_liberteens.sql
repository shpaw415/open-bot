CREATE TABLE `thread_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`text` text NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_queue_session` ON `thread_queue` (`user_id`,`session_id`,`seq`);