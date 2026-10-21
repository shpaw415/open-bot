CREATE TABLE `delegation_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`creator_session_id` text NOT NULL,
	`subject_session_id` text NOT NULL,
	`council_id` text,
	`created_at` integer NOT NULL,
	`woken_at` integer,
	`pending` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delegation_watches_user_subject` ON `delegation_watches` (`user_id`,`subject_session_id`);--> statement-breakpoint
CREATE INDEX `delegation_watches_user_creator` ON `delegation_watches` (`user_id`,`creator_session_id`);