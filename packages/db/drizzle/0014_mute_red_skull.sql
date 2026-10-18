CREATE TABLE `council_members` (
	`council_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`council_id`, `session_id`)
);
--> statement-breakpoint
CREATE INDEX `council_members_user_session` ON `council_members` (`user_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `council_members_user` ON `council_members` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `councils` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `councils_user_name` ON `councils` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `councils_user` ON `councils` (`user_id`,`created_at`);