CREATE TABLE `thread_relay_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_session_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`remaining_uses` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_relay_grants_token_hash_unique` ON `thread_relay_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `thread_relay_grants_user_target` ON `thread_relay_grants` (`user_id`,`target_session_id`,`created_at`);