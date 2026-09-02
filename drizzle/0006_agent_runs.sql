CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent` text NOT NULL,
	`outcome` text NOT NULL,
	`dry_run` integer NOT NULL DEFAULT 0,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`detail_json` text,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "agent_runs_outcome_check" CHECK(outcome in ('success', 'failure', 'dry_run')),
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `agent_runs_agent_idx` ON `agent_runs` (`agent`);--> statement-breakpoint
CREATE INDEX `agent_runs_started_idx` ON `agent_runs` (`started_at`);
