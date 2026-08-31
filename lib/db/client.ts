/**
 * Database client — Drizzle ORM over better-sqlite3.
 *
 * The SQLite file path is configurable via the `DATABASE_PATH` environment
 * variable (docs/architecture.md §7.2 puts the production file at
 * /var/lib/rainforest/rainforest.db; locally it defaults to
 * ./data/rainforest.db). Use `:memory:` for tests.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export const DEFAULT_DATABASE_PATH = "./data/rainforest.db";

/** Resolve the SQLite file path from the environment. */
export function databasePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

export type DatabaseClient = ReturnType<typeof createDatabase>;

/** Open (creating if needed) the SQLite database and return a Drizzle client. */
export function createDatabase(path: string = databasePath()) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
