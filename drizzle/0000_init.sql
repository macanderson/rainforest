CREATE TABLE `drizzle_migrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tag` text NOT NULL,
	`applied_at` integer NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drizzle_migrations_tag_unique` ON `drizzle_migrations` (`tag`);