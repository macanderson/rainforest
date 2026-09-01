import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";

const dir = mkdtempSync(join(tmpdir(), "rf-migrate-"));
const dbPath = join(dir, "test.db");

after(() => rmSync(dir, { recursive: true, force: true }));

describe("db/migrate — migration runner", () => {
  it("applies the migrations cleanly to a fresh database", () => {
    const applied = runMigrations(dbPath);
    assert.deepEqual(applied, [
      "0000_init",
      "0001_core_schema",
      "0002_job_runs",
      "0003_job_run_ledger",
    ]);

    const sqlite = new Database(dbPath);
    const table = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'drizzle_migrations'")
      .get();
    assert.ok(table, "drizzle_migrations table exists");
    assert.match(table.sql, /data_origin/);
    assert.match(table.sql, /created_at/);
    assert.match(table.sql, /updated_at/);
    assert.match(table.sql, /CHECK\(data_origin in \('seed', 'demo', 'agent'\)\)/);

    const rows = sqlite
      .prepare("SELECT tag, data_origin FROM drizzle_migrations ORDER BY tag")
      .all();
    assert.deepEqual(rows, [
      { tag: "0000_init", data_origin: "seed" },
      { tag: "0001_core_schema", data_origin: "seed" },
      { tag: "0002_job_runs", data_origin: "seed" },
      { tag: "0003_job_run_ledger", data_origin: "seed" },
    ]);
    sqlite.close();
  });

  it("is idempotent — a second run applies nothing", () => {
    assert.deepEqual(runMigrations(dbPath), []);
  });

  it("enforces the data_origin CHECK constraint at the database layer", () => {
    const sqlite = new Database(dbPath);
    assert.throws(
      () =>
        sqlite
          .prepare(
            "INSERT INTO drizzle_migrations (tag, applied_at, data_origin) VALUES ('x', 1, 'bogus')",
          )
          .run(),
      /CHECK constraint failed/,
    );
    for (const origin of ["seed", "demo", "agent"]) {
      sqlite
        .prepare(
          "INSERT INTO drizzle_migrations (tag, applied_at, data_origin) VALUES (?, 1, ?)",
        )
        .run(`ok-${origin}`, origin);
    }
    sqlite.close();
  });
});
