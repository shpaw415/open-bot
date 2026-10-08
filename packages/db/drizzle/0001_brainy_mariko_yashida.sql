CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cron_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`job_name` text NOT NULL,
	`run_session_id` text,
	`summary` text,
	`created_at` integer NOT NULL,
	`viewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `cron_notices_user` ON `cron_notices` (`user_id`,`viewed_at`);--> statement-breakpoint
CREATE TABLE `improvements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`kind` text NOT NULL,
	`surface` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`fingerprint` text NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `improvements_fingerprint_status` ON `improvements` (`fingerprint`,`status`);--> statement-breakpoint
CREATE INDEX `improvements_user_time` ON `improvements` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `installed_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`version` text NOT NULL,
	`manifest` text NOT NULL,
	`readme` text,
	`enabled` integer DEFAULT true NOT NULL,
	`applied` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `installed_plugins_user` ON `installed_plugins` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `installed_plugins_user_plugin` ON `installed_plugins` (`user_id`,`plugin_id`);--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`instruction` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `personas_user` ON `personas` (`user_id`);--> statement-breakpoint
CREATE TABLE `plugin_settings` (
	`user_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `plugin_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_user` ON `projects` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_user_name` ON `projects` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `thread_personas` (
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`persona_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `session_id`)
);
--> statement-breakpoint
CREATE TABLE `thread_screens` (
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`display` integer NOT NULL,
	`rfb_port` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `session_id`)
);
--> statement-breakpoint
CREATE TABLE `thread_titles` (
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `session_id`)
);
--> statement-breakpoint
CREATE TABLE `user_keys` (
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`api_key` text,
	`account_id` text,
	`gateway_id` text,
	`gateway_token` text,
	`gateway_slug` text,
	`base_url` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `slug`)
);
--> statement-breakpoint
ALTER TABLE `cron_jobs` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `cron_jobs` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `cron_jobs` ADD `persona_id` text;--> statement-breakpoint
ALTER TABLE `cron_jobs` ADD `run_kind` text DEFAULT 'prompt' NOT NULL;--> statement-breakpoint
ALTER TABLE `cron_jobs` ADD `script` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `image_provider` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `image_account_id` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `image_api_key` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `image_model` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `video_provider` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `video_account_id` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `video_api_key` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `video_model` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `model3d_provider` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `model3d_account_id` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `model3d_api_key` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `model3d_model` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_provider` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_endpoint` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_api_key` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_gateway_token` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_model` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_account_id` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_gateway_id` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `system1_slug` text;