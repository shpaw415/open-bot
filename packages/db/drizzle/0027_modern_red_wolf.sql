ALTER TABLE `desktops` ADD `viking_vlm_source` text;--> statement-breakpoint
ALTER TABLE `desktops` ADD `viking_vlm_provider` text;--> statement-breakpoint
ALTER TABLE `viking_provider` ADD `vlm_source` text;--> statement-breakpoint
ALTER TABLE `viking_provider` ADD `vlm_provider` text;