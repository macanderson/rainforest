/**
 * Drizzle schema — foundation tables.
 *
 * The thirteen domain tables land in E2#1; this file currently holds only
 * the migration ledger, which exists to prove the shared column convention
 * (lib/db/columns.ts) and the migration runner end to end. Later tables
 * reuse `sharedColumns` / `dataOriginCheck` rather than redeclaring columns.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { dataOriginCheck, sharedColumns } from "./columns";

/**
 * Ledger of applied migrations. The runner (lib/db/migrate.mjs) records each
 * applied migration here so re-runs are no-ops and the applied set is
 * inspectable from SQL.
 */
export const drizzleMigrations = sqliteTable(
  "drizzle_migrations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tag: text("tag").notNull().unique(),
    appliedAt: integer("applied_at").notNull(),
    ...sharedColumns,
  },
  () => [dataOriginCheck],
);
