CREATE TABLE `sandbox_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`profile` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_profiles_user_name` ON `sandbox_profiles` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `sandbox_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`profile_id` text,
	`profile` text NOT NULL,
	`container` text NOT NULL,
	`network` text NOT NULL,
	`token_hash` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_active_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_threads_user` ON `sandbox_threads` (`user_id`,`state`);--> statement-breakpoint
CREATE INDEX `sandbox_threads_session` ON `sandbox_threads` (`session_id`);