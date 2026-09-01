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
  lines.push(
    report.ok
      ? `reconcile: OK (${scope}; DB-vs-bible half ${report.dbHalf === "armed" ? "armed" : "skipped — no seed data yet"})`
      : `reconcile: FAILED (${scope})`,
  );

  // Human-readable drift report (reconciliation.md §4): per quarter × per
  // metric — bible value, DB value, relative drift, PASS/FAIL — with failing
  // cells called out. Sorted by quarter then metric so two runs over the same
  // inputs produce byte-identical reports.
  if (report.cells.length > 0) {
    lines.push("");
    lines.push("quarter   metric                  bible        db           drift     result");
    lines.push("-------   ---------------------   ----------   ----------   -------   ------");
    const cells = [...report.cells].sort(
      (a, b) =>
        a.quarter.localeCompare(b.quarter) || a.metric.localeCompare(b.metric),
    );
    for (const c of cells) {
      const drift = `${c.driftPct >= 0 ? "+" : ""}${c.driftPct.toFixed(2)}%`;
      lines.push(
        `${c.quarter.padEnd(9)} ${c.metric.padEnd(23)} ${String(c.bible).padStart(10)}   ` +
          `${c.db.toFixed(4).padStart(10)}   ${drift.padStart(7)}   ${c.pass ? "PASS" : "FAIL"}`,
      );
    }
    const failed = cells.filter((c) => !c.pass);
    if (failed.length > 0) {
      lines.push("");
      lines.push(`failing cells (${failed.length}):`);
      for (const c of failed) {
        lines.push(
          `  ${c.quarter} ${c.metric}: DB ${c.db.toFixed(4)} vs bible ${c.bible} ` +
            `(drift ${c.driftPct.toFixed(2)}%, tolerance ±2%)`,
        );
      }
    }
  }

  if (!report.ok) {
    lines.push("");
    lines.push("findings:");
    for (const f of report.findings) {
      lines.push(`  [${f.check}]${f.quarter ? ` ${f.quarter}:` : ""} ${f.message}`);
    }
  }
  // reconciliation.md §4: the human-readable drift report goes to stdout and
  // to reconcile-report.txt (gitignored; the E3#7 evidence artifact commits
  // it). Two runs over the same inputs produce byte-identical reports. It is
  // written on the passing path too — "no drift" is the result a reader most
  // often needs, and an artifact that appears only after a failure cannot show
  // when the numbers last agreed.
  writeFileSync(reportPath, lines.join("\n") + "\n");
  for (const line of lines) {
    (report.ok ? console.log : console.error)(line);
  }
  if (!report.ok) process.exitCode = 1;
} finally {
  sqlite?.close();
}
