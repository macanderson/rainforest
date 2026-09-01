CREATE TABLE `job_run_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`ledger_date` text NOT NULL,
	`outcome` text NOT NULL,
	`rows_affected` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`detail_json` text,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_run_ledger_job_date_unique` ON `job_run_ledger` (`job`,`ledger_date`);
