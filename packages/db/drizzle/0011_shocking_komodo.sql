CREATE TABLE `watchdog_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`source` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`fingerprint` text NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`verdict` text,
	`action` text DEFAULT 'alerted' NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `watchdog_findings_user_time` ON `watchdog_findings` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `watchdog_findings_fingerprint` ON `watchdog_findings` (`user_id`,`fingerprint`);--> statement-breakpoint
ALTER TABLE `desktops` ADD `watchdog_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `desktops` ADD `watchdog_stop_on_high` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `desktops` ADD `watchdog_provider` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `watchdog_account_id` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `watchdog_api_key` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `watchdog_model` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `watchdog_base_url` text;