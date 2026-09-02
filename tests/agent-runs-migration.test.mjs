/**
 * Migration coverage for 0006_agent_runs — the operational-agent run ledger
 * (docs/architecture.md §9.2, issue E5#5).
 */
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";

const dir = mkdtempSync(join(tmpdir(), "rf-agent-runs-migration-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);
const sqlite = new Database(dbPath);

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const OUTCOMES = ["success", "failure", "dry_run"];

describe("agent_runs migration (0006)", () => {
  it("creates the agent_runs table with the run-ledger shape", () => {
    const cols = sqlite.prepare("PRAGMA table_info(agent_runs)").all();
    const names = cols.map((c) => c.name);
    for (const col of [
      "agent",
      "outcome",
      "dry_run",
      "started_at",
      "finished_at",
      "detail_json",
    ]) {
      assert.ok(names.includes(col), `missing column ${col}`);
    }
  });

  it("accepts every run-ledger outcome and records dry_run", () => {
    for (const outcome of OUTCOMES) {
      sqlite
        .prepare(
          "INSERT INTO agent_runs (agent, outcome, dry_run, started_at, data_origin) " +
            "VALUES ('auto-reorder', ?, ?, 1, 'agent')",
        )
        .run(outcome, outcome === "dry_run" ? 1 : 0);
    }
    const rows = sqlite.prepare("SELECT COUNT(*) AS n FROM agent_runs").get();
    assert.equal(rows.n, OUTCOMES.length);
  });

  it("rejects an outcome outside the enum (CHECK constraint)", () => {
    assert.throws(() =>
      sqlite
        .prepare(
          "INSERT INTO agent_runs (agent, outcome, started_at, data_origin) " +
            "VALUES ('auto-reorder', 'bogus', 1, 'agent')",
        )
        .run(),
    );
  });
});
