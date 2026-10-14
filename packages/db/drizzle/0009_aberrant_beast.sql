ALTER TABLE `installed_plugins` ADD `webhook_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `installed_plugins_webhook_token` ON `installed_plugins` (`webhook_token`);