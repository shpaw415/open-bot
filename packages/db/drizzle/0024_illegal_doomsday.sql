CREATE TABLE `thread_models` (
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`effort` text,
	PRIMARY KEY(`user_id`, `session_id`)
);
