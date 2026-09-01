#!/usr/bin/env node
/**
 * `pnpm reconcile` CLI — runs the reconciliation engine
 * (docs/data-specs/reconciliation.md) against the numbers bible and, when a
 * database file exists at DATABASE_PATH, the seeded DB. Exit code 1 on any
 * finding so CI and the demo-wipe postcondition fail closed.
 */
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

import { reconcile } from "./reconcile.ts";

const dbPath = process.env.DATABASE_PATH ?? "./data/rainforest.db";

let sqlite;
if (existsSync(dbPath)) {
  sqlite = new Database(dbPath, { readonly: true });
}

try {
  const report = reconcile(sqlite);
  const scope = sqlite ? `bible + ${dbPath}` : "bible only (no database file)";
  if (report.ok) {
    console.log(
      `reconcile: OK (${scope}; DB-vs-bible half ${report.dbHalf === "armed" ? "armed" : "skipped — no seed data yet"})`,
    );
  } else {
    console.error(`reconcile: FAILED (${scope})`);
    for (const f of report.findings) {
      console.error(`  [${f.check}]${f.quarter ? ` ${f.quarter}:` : ""} ${f.message}`);
    }
    process.exitCode = 1;
  }
} finally {
  sqlite?.close();
}
