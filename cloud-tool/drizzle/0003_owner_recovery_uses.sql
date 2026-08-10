CREATE TABLE `owner_recovery_uses` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_member_id` text NOT NULL,
	`used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
