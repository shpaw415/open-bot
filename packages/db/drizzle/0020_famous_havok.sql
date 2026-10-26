CREATE TABLE `builtin_persona_scopes` (
	`user_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`skills_extra` text,
	`mcp_extra` text,
	PRIMARY KEY(`user_id`, `persona_id`)
);
