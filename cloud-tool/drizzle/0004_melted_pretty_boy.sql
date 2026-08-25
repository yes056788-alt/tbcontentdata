CREATE TABLE `run_deletions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`blob_key` text,
	`deleted_by` text NOT NULL,
	`deleted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `run_deletions_deleted_at_idx` ON `run_deletions` (`deleted_at`);
--> statement-breakpoint
CREATE TRIGGER `runs_reject_deleted_insert`
BEFORE INSERT ON `runs`
WHEN EXISTS (
	SELECT 1 FROM `run_deletions` WHERE `run_id` = NEW.`id`
)
BEGIN
	SELECT RAISE(ABORT, 'RUN_DELETED_TOMBSTONE');
END;
--> statement-breakpoint
CREATE TRIGGER `runs_reject_deleted_update`
BEFORE UPDATE ON `runs`
WHEN EXISTS (
	SELECT 1 FROM `run_deletions` WHERE `run_id` = NEW.`id`
)
BEGIN
	SELECT RAISE(ABORT, 'RUN_DELETED_TOMBSTONE');
END;
