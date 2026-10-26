ALTER TABLE `builtin_persona_scopes` ADD `skills_none` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `builtin_persona_scopes` ADD `mcp_none` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `personas` ADD `skills_none` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `personas` ADD `mcp_none` integer DEFAULT false NOT NULL;