CREATE TABLE `cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`message` text NOT NULL,
	`kind` text NOT NULL,
	`cron_expr` text,
	`every_seconds` integer,
	`at_ms` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`delete_after_run` integer DEFAULT false NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `cron_user_due` ON `cron_jobs` (`user_id`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `desktops` (
	`user_id` text PRIMARY KEY NOT NULL,
	`llm_token` text NOT NULL,
	`opencode_password` text NOT NULL,
	`viking_key` text NOT NULL,
	`selected_provider` text,
	`selected_model` text,
	`last_active_at` integer NOT NULL,
	`viking_base_url` text,
	`viking_api_key` text,
	`viking_embed_model` text,
	`viking_embed_dimension` integer,
	`viking_vlm_model` text
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`code` text PRIMARY KEY NOT NULL,
	`email` text,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_user_time` ON `usage_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`disabled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `viking_provider` (
	`id` integer PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text NOT NULL,
	`embed_model` text NOT NULL,
	`embed_dimension` integer NOT NULL,
	`vlm_model` text NOT NULL,
	CONSTRAINT "viking_provider_id" CHECK("viking_provider"."id" = 1)
);
