CREATE TABLE `pending_skills` (
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`previous_name` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `name`)
);
--> statement-breakpoint
CREATE INDEX `pending_skills_user` ON `pending_skills` (`user_id`,`created_at`);