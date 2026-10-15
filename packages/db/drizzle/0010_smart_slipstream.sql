CREATE TABLE `thread_dir_assignments` (
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`dir_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `session_id`)
);
--> statement-breakpoint
CREATE INDEX `thread_dir_assignments_dir` ON `thread_dir_assignments` (`user_id`,`dir_id`);--> statement-breakpoint
CREATE TABLE `thread_dirs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_dirs_user_name` ON `thread_dirs` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `thread_dirs_user` ON `thread_dirs` (`user_id`,`created_at`);