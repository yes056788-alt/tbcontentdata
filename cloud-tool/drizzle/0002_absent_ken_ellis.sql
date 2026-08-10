PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_local_accounts` (
	`member_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_iterations` integer DEFAULT 100000 NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`password_changed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "local_accounts_iterations_check" CHECK("password_iterations" = 100000),
	CONSTRAINT "local_accounts_failed_attempts_check" CHECK("failed_login_attempts" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_local_accounts`("member_id", "username", "username_normalized", "password_salt", "password_hash", "password_iterations", "must_change_password", "failed_login_attempts", "locked_until", "password_changed_at", "created_at", "updated_at") SELECT "member_id", "username", "username_normalized", "password_salt", "password_hash", "password_iterations", "must_change_password", "failed_login_attempts", "locked_until", "password_changed_at", "created_at", "updated_at" FROM `local_accounts`;--> statement-breakpoint
DROP TABLE `local_accounts`;--> statement-breakpoint
ALTER TABLE `__new_local_accounts` RENAME TO `local_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `local_accounts_username_normalized_unique` ON `local_accounts` (`username_normalized`);
