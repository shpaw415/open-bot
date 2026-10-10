ALTER TABLE `installed_plugins` ADD `source` text DEFAULT 'marketplace' NOT NULL;--> statement-breakpoint
ALTER TABLE `installed_plugins` ADD `local_path` text;