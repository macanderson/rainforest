/**
 * Shared column convention — docs/architecture.md §3.
 *
 * Every table in the schema carries these three columns, spread in via
 * `...sharedColumns`. `data_origin` is what powers the living demo:
 * the clock-shift job moves only 'seed' rows, the nightly wipe deletes
 * only 'demo' rows, and 'agent' rows are kept forever.
 */
import { sql } from "drizzle-orm";
import { check, integer, text } from "drizzle-orm/sqlite-core";

/** The only values `data_origin` may ever hold. */
export const DATA_ORIGINS = ["seed", "demo", "agent"] as const;

export type DataOrigin = (typeof DATA_ORIGINS)[number];

/**
 * The shared columns every table must carry. Spread into every table
 * definition, e.g. `sqliteTable("widgets", { id: ..., ...sharedColumns })`.
 *
 * Timestamps are stored as Unix epoch milliseconds (integer, mode
 * "timestamp_ms") and default to the insert time.
 */
export const sharedColumns = {
  dataOrigin: text("data_origin", { enum: DATA_ORIGINS }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
};

/**
 * CHECK constraint enforcing the `data_origin` literal set at the database
 * layer, so no write path — ORM or raw SQL — can store an invalid origin.
 * Add to every table's constraints alongside `...sharedColumns`.
 */
export const dataOriginCheck = check(
  "data_origin_check",
  sql`data_origin in ('seed', 'demo', 'agent')`,
);
