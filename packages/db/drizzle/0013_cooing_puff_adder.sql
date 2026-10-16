CREATE TABLE `team_keys` (
	`slug` text PRIMARY KEY NOT NULL,
	`api_key` text,
	`account_id` text,
	`gateway_id` text,
	`gateway_token` text,
	`gateway_slug` text,
	`base_url` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_quotas` (
	`user_id` text PRIMARY KEY NOT NULL,
	`weekly_tokens` integer,
	`updated_at` integer NOT NULL
);
