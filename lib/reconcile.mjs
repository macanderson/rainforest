#!/usr/bin/env node
/**
 * `pnpm reconcile` CLI — runs the reconciliation engine
 * (docs/data-specs/reconciliation.md) against the numbers bible and, when a
 * database file exists at DATABASE_PATH, the seeded DB. Exit code 1 on any
 * finding so CI and the demo-wipe postcondition fail closed.
 */
import { existsSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";

import { reconcile } from "./reconcile.ts";

const dbPath = process.env.DATABASE_PATH ?? "./data/rainforest.db";
const reportPath = process.env.RECONCILE_REPORT_PATH ?? "./reconcile-report.txt";

let sqlite;
if (existsSync(dbPath)) {
  sqlite = new Database(dbPath, { readonly: true });
}

try {
  const report = reconcile(sqlite);
  const scope = sqlite ? `bible + ${dbPath}` : "bible only (no database file)";
  const lines = [];
  if (report.ok) {
    lines.push(
      `reconcile: OK (${scope}; DB-vs-bible half ${report.dbHalf === "armed" ? "armed" : "skipped — no seed data yet"})`,
    );
    console.log(lines[0]);
  } else {
    lines.push(`reconcile: FAILED (${scope})`);
    for (const f of report.findings) {
      lines.push(`  [${f.check}]${f.quarter ? ` ${f.quarter}:` : ""} ${f.message}`);
    }
    for (const line of lines) console.error(line);
    process.exitCode = 1;
  }
  // The drift report is an artifact CI uploads on every data change, so it is
  // written on the passing path too: "no drift" is the result a reader most
  // often needs to see, and an upload that only exists after a failure cannot
  // show when the numbers last agreed. Two runs over the same inputs produce
  // byte-identical reports (reconciliation.md §4).
  writeFileSync(reportPath, `${lines.join("\n")}\n`);
} finally {
  sqlite?.close();
}
