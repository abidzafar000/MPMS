CREATE TABLE `pms_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `pms_properties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pms_membership_email_idx` ON `pms_memberships` (`email`,`active`);--> statement-breakpoint
CREATE INDEX `pms_membership_user_idx` ON `pms_memberships` (`user_id`,`active`);--> statement-breakpoint
CREATE INDEX `pms_membership_property_idx` ON `pms_memberships` (`property_id`);--> statement-breakpoint
CREATE TABLE `pms_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`state_json` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`mutation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pms_owner_idx` ON `pms_properties` (`owner_user_id`);