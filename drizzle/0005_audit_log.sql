CREATE TABLE `audit_log_delete_gate` (
	`id` integer PRIMARY KEY CHECK (id = 1),
	`open` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `audit_log_delete_gate` (`id`, `open`) VALUES (1, false);
--> statement-breakpoint
CREATE TABLE `demo_wipe_audit_archive` (
	`id` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_table` text NOT NULL,
	`entity_id` integer NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`data_origin` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log` BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
WHEN (SELECT `open` FROM `audit_log_delete_gate` WHERE `id` = 1) = 0
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
