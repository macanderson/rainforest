/**
 * Unit tests for the job-observability data layer (issue E6#4) — above all
 * the missed-window computation: on-time, missed, and never-ran cases for
 * both living-demo jobs, against both ledger shapes (job_run_ledger for
 * clock-shift, job_runs for demo-wipe).
 */
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import {
  computeMissedWindow,
  getJobStatuses,
  lastScheduledSlot,
  nextScheduledSlot,
} from "../lib/jobs/observability.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-jobs-observability-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);
const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const HOUR = 3_600_000;
const DAY = 86_400_000;
// A fixed "now": 2027-01-15T12:00:00Z — after both daily slots (04:00, 08:00).
const NOW = Date.UTC(2027, 0, 15, 12, 0, 0);
const CLOCK_SHIFT_SLOT = Date.UTC(2027, 0, 15, 4, 0, 0);
const DEMO_WIPE_SLOT = Date.UTC(2027, 0, 15, 8, 0, 0);

const insertLedgerRow = (row) => {
  sqlite
    .prepare(
      "INSERT INTO job_run_ledger (job, ledger_date, outcome, rows_affected, duration_ms, detail_json, data_origin, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'agent', ?, ?)",
    )
    .run(
      row.job,
      row.ledgerDate,
      row.outcome,
      row.rowsAffected,
      row.durationMs,
      row.detailJson ?? null,
      row.at,
      row.at,
    );
};

const insertJobRun = (row) => {
  sqlite
    .prepare(
      "INSERT INTO job_runs (job, status, started_at, finished_at, detail_json, data_origin) " +
        "VALUES (?, ?, ?, ?, ?, 'agent')",
    )
    .run(
      row.job,
      row.status,
      row.startedAt,
      row.finishedAt ?? null,
      row.detailJson ?? null,
    );
};

const clearLedgers = () => {
  sqlite.exec("DELETE FROM job_run_ledger");
  sqlite.exec("DELETE FROM job_runs");
};

const statusFor = (statuses, job) => {
  const found = statuses.find((s) => s.job === job);
  assert.ok(found, `expected a status for ${job}`);
  return found;
};

describe("slot math", () => {
  it("lastScheduledSlot is today's slot once it has passed", () => {
    assert.equal(lastScheduledSlot(NOW, 4), CLOCK_SHIFT_SLOT);
    assert.equal(lastScheduledSlot(NOW, 8), DEMO_WIPE_SLOT);
  });

  it("lastScheduledSlot is yesterday's slot before today's slot", () => {
    const early = Date.UTC(2027, 0, 15, 3, 0, 0); // 03:00, before 04:00
    assert.equal(lastScheduledSlot(early, 4), CLOCK_SHIFT_SLOT - DAY);
  });

  it("nextScheduledSlot is strictly after now", () => {
    assert.equal(nextScheduledSlot(NOW, 4), CLOCK_SHIFT_SLOT + DAY);
    const early = Date.UTC(2027, 0, 15, 3, 0, 0);
    assert.equal(nextScheduledSlot(early, 4), CLOCK_SHIFT_SLOT);
  });
});

describe("computeMissedWindow", () => {
  it("on-time: a success after the last slot means no miss", () => {
    assert.equal(
      computeMissedWindow(CLOCK_SHIFT_SLOT + 5 * 60_000, NOW, 4),
      false,
    );
  });

  it("missed: the last success predates the last slot", () => {
    assert.equal(
      computeMissedWindow(CLOCK_SHIFT_SLOT - DAY + 5 * 60_000, NOW, 4),
      true,
    );
  });

  it("never ran: any passed slot counts as missed", () => {
    assert.equal(computeMissedWindow(null, NOW, 4), true);
  });

  it("never ran and the first slot has not passed yet: not missed", () => {
    const beforeFirstSlot = Date.UTC(2027, 0, 15, 3, 0, 0);
    // Slot math still yields yesterday's slot, so a never-ran job is missed
    // whenever any daily slot exists in the past — which is always. This
    // pins that deliberate choice: silence is not health.
    assert.equal(computeMissedWindow(null, beforeFirstSlot, 4), true);
  });
});

describe("getJobStatuses", () => {
  it("empty ledgers: both jobs report no runs and a missed window", () => {
    clearLedgers();
    const statuses = getJobStatuses(sqlite, NOW);
    assert.equal(statuses.length, 2);
    for (const status of statuses) {
      assert.equal(status.lastRun, null);
      assert.equal(status.missedWindow, true);
    }
    assert.equal(statusFor(statuses, "clock-shift").nextTickAt, CLOCK_SHIFT_SLOT + DAY);
    assert.equal(statusFor(statuses, "demo-wipe").nextTickAt, DEMO_WIPE_SLOT + DAY);
  });

  it("on-time: successful runs after today's slots clear the banner", () => {
    clearLedgers();
    insertLedgerRow({
      job: "clock-shift",
      ledgerDate: "2027-01-15",
      outcome: "success",
      rowsAffected: 1234,
      durationMs: 87,
      at: CLOCK_SHIFT_SLOT + 60_000,
    });
    insertJobRun({
      job: "demo-wipe",
      status: "success",
      startedAt: DEMO_WIPE_SLOT + 30_000,
      finishedAt: DEMO_WIPE_SLOT + 32_000,
      detailJson: JSON.stringify({
        rowsWiped: { sales_orders: 3 },
        totalWiped: 3,
        rowsRestored: 1,
        durationMs: 2000,
      }),
    });

    const statuses = getJobStatuses(sqlite, NOW);
    const clockShift = statusFor(statuses, "clock-shift");
    const demoWipe = statusFor(statuses, "demo-wipe");

    assert.equal(clockShift.missedWindow, false);
    assert.equal(clockShift.lastRun.outcome, "success");
    assert.equal(clockShift.lastRun.rowsAffected, 1234);
    assert.equal(clockShift.lastRun.durationMs, 87);

    assert.equal(demoWipe.missedWindow, false);
    assert.equal(demoWipe.lastRun.outcome, "success");
    assert.equal(demoWipe.lastRun.rowsAffected, 3);
    assert.equal(demoWipe.lastRun.durationMs, 2000);
  });

  it("missed: a stale success leaves the window missed", () => {
    clearLedgers();
    insertLedgerRow({
      job: "clock-shift",
      ledgerDate: "2027-01-14",
      outcome: "success",
      rowsAffected: 100,
      durationMs: 50,
      at: CLOCK_SHIFT_SLOT - DAY + 60_000, // yesterday's run
    });
    const statuses = getJobStatuses(sqlite, NOW);
    assert.equal(statusFor(statuses, "clock-shift").missedWindow, true);
  });

  it("a failed latest run still surfaces its error detail", () => {
    clearLedgers();
    insertJobRun({
      job: "demo-wipe",
      status: "failure",
      startedAt: DEMO_WIPE_SLOT + 10_000,
      finishedAt: DEMO_WIPE_SLOT + 11_000,
      detailJson: JSON.stringify({
        rowsWiped: {},
        totalWiped: 0,
        rowsRestored: 0,
        durationMs: 1000,
        error: "reconcile postcondition failed",
      }),
    });
    const statuses = getJobStatuses(sqlite, NOW);
    const demoWipe = statusFor(statuses, "demo-wipe");
    assert.equal(demoWipe.lastRun.outcome, "failure");
    assert.equal(demoWipe.lastRun.error, "reconcile postcondition failed");
    // A failure is not a success: the window is still missed.
    assert.equal(demoWipe.missedWindow, true);
  });

  it("a no-op ledger row does not count as a successful run", () => {
    clearLedgers();
    insertLedgerRow({
      job: "clock-shift",
      ledgerDate: "2027-01-15",
      outcome: "no-op",
      rowsAffected: 0,
      durationMs: 1,
      at: CLOCK_SHIFT_SLOT + 60_000,
    });
    const statuses = getJobStatuses(sqlite, NOW);
    const clockShift = statusFor(statuses, "clock-shift");
    assert.equal(clockShift.lastRun.outcome, "no-op");
    assert.equal(clockShift.missedWindow, true);
  });

  it("a success earlier today followed by a failure is still on schedule", () => {
    clearLedgers();
    insertJobRun({
      job: "demo-wipe",
      status: "success",
      startedAt: DEMO_WIPE_SLOT + 5_000,
      finishedAt: DEMO_WIPE_SLOT + 6_000,
      detailJson: JSON.stringify({ totalWiped: 2, durationMs: 1000 }),
    });
    insertJobRun({
      job: "demo-wipe",
      status: "failure",
      startedAt: DEMO_WIPE_SLOT + HOUR,
      finishedAt: DEMO_WIPE_SLOT + HOUR + 1_000,
      detailJson: JSON.stringify({ totalWiped: 0, durationMs: 1000, error: "boom" }),
    });
    const statuses = getJobStatuses(sqlite, NOW);
    const demoWipe = statusFor(statuses, "demo-wipe");
    // Latest run is the failure (shown with its detail)…
    assert.equal(demoWipe.lastRun.outcome, "failure");
    assert.equal(demoWipe.lastRun.error, "boom");
    // …but the window was satisfied by the earlier success.
    assert.equal(demoWipe.missedWindow, false);
  });
});
