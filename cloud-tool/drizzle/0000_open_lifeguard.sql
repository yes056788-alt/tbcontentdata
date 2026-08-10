CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_member_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by` text NOT NULL,
	`accepted_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`accepted_at` integer,
	CONSTRAINT "invites_role_check" CHECK("invites"."role" in ('owner', 'admin', 'operator', 'viewer')),
	CONSTRAINT "invites_status_check" CHECK("invites"."status" in ('pending', 'accepted', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_email_unique` ON `invites` (`email`);--> statement-breakpoint
CREATE INDEX `invites_status_idx` ON `invites` (`status`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer,
	CONSTRAINT "members_role_check" CHECK("members"."role" in ('owner', 'admin', 'operator', 'viewer')),
	CONSTRAINT "members_status_check" CHECK("members"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_id_unique` ON `members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE INDEX `members_role_status_idx` ON `members` (`role`,`status`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text DEFAULT '' NOT NULL,
	`run_mode` text DEFAULT '' NOT NULL,
	`account_id` text DEFAULT '' NOT NULL,
	`account_name` text DEFAULT '' NOT NULL,
	`username_masked` text DEFAULT '' NOT NULL,
	`account_group_id` text DEFAULT '' NOT NULL,
	`account_group_name` text DEFAULT '' NOT NULL,
	`store_id` text DEFAULT '' NOT NULL,
	`store_name` text DEFAULT '' NOT NULL,
	`store_group_id` text DEFAULT '' NOT NULL,
	`store_group_name` text DEFAULT '' NOT NULL,
	`task_type` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`source_updated_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`blob_key` text NOT NULL,
	`payload_bytes` integer NOT NULL,
	`payload_sha256` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_blob_key_unique` ON `runs` (`blob_key`);--> statement-breakpoint
CREATE INDEX `runs_created_at_idx` ON `runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `runs_store_created_idx` ON `runs` (`store_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shared_documents` (
	`key` text PRIMARY KEY NOT NULL,
	`json_payload` text NOT NULL,
	`payload_bytes` integer NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_vault` (
	`id` integer PRIMARY KEY NOT NULL,
	`encrypted_payload` text NOT NULL,
	`payload_bytes` integer NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
