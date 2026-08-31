/**
 * Migration runner — applies the SQL migrations in drizzle/ to the SQLite
 * database at DATABASE_PATH (default ./data/rainforest.db), recording each
 * applied migration in the `drizzle_migrations` ledger so re-runs are no-ops.
 *
 * Usage: npm run db:migrate   (DATABASE_PATH=... to override the file)
 */
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export function runMigrations(dbPath) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Bootstrap the ledger (chicken-and-egg: the first migration creates the
  // full table with the shared convention columns). If the table already
  // exists this is a no-op.
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS drizzle_migrations (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
      "tag TEXT NOT NULL, " +
      "applied_at INTEGER NOT NULL, " +
      "data_origin TEXT NOT NULL DEFAULT 'seed', " +
      "created_at INTEGER DEFAULT (unixepoch() * 1000) NOT NULL, " +
      "updated_at INTEGER DEFAULT (unixepoch() * 1000) NOT NULL, " +
      "CONSTRAINT data_origin_check CHECK(data_origin in ('seed', 'demo', 'agent'))" +
      ")",
  );
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS drizzle_migrations_tag_unique " +
      "ON drizzle_migrations (tag)",
  );

  const applied = new Set(
    sqlite
      .prepare("SELECT tag FROM drizzle_migrations")
      .all()
      .map((row) => row.tag),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied = [];
  for (const file of files) {
    const tag = file.replace(/\.sql$/, "");
    if (applied.has(tag)) continue;

    const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      // The bootstrap above already created the ledger; skip re-creating it.
      .filter((s) => !/drizzle_migrations/i.test(s));

    const apply = sqlite.transaction(() => {
      for (const statement of statements) sqlite.exec(statement);
      sqlite
        .prepare(
          "INSERT INTO drizzle_migrations (tag, applied_at, data_origin) VALUES (?, ?, 'seed')",
        )
        .run(tag, Date.now());
    });
    apply();
    newlyApplied.push(tag);
  }

  sqlite.close();
  return newlyApplied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dbPath = process.env.DATABASE_PATH ?? "./data/rainforest.db";
  const applied = runMigrations(dbPath);
  console.log(
    applied.length > 0
      ? `Applied ${applied.length} migration(s) to ${dbPath}: ${applied.join(", ")}`
      : `No pending migrations for ${dbPath}`,
  );
}
