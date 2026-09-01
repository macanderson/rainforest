/**
 * Daily +1-day clock-shift job — architecture.md §8, issue E6#2.
 *
 * Runs at 04:00 UTC via the authenticated cron endpoint
 * (app/api/jobs/clock-shift/route.ts). Keeps the demo perpetually "happening
 * now": every timestamp on every `data_origin='seed'` row moves forward
 * exactly one day, inside a single transaction, guarded by the
 * `job_run_ledger` idempotency ledger (one row per job per UTC calendar date;
 * the unique index makes a double run an insert-conflict the job turns into
 * a recorded no-op).
 *
 * Why reconciliation survives: seeded rows carry a quarter tag relative to
 * `DEMO_EPOCH`, and `pnpm reconcile` buckets by quarter tag — never by
 * wall-clock timestamp. The shift moves timestamps only, so the aggregate
 * the bible diffs against is unchanged. `reconcile()` still runs as a
 * postcondition inside the same transaction so the property is proven, not
 * assumed; a red reconcile rolls the whole shift back.
 *
 * Timestamps are epoch milliseconds (lib/db/columns.ts), so +1 day is a pure
 * integer add of {@link DAY_MS} — timezone-free. The quarter-tag columns and
 * the append-only `audit_log` are never shifted.
 */
import type Database from "better-sqlite3";

import { reconcile } from "../reconcile.ts";

export const DAY_MS = 86_400_000;

/** Timestamp columns shifted on `data_origin='seed'` rows (epoch ms). */
export const SHIFT_COLUMNS: Record<string, string[]> = {
  stock_levels: ["snapshot_at"],
  purchase_orders: ["ordered_at", "promised_at", "received_at"],
  sales_orders: [
    "placed_at",
    "allocated_at",
    "picked_at",
    "shipped_at",
    "delivered_at",
    "promised_at",
  ],
  shipments: ["shipped_at", "promised_at", "delivered_at"],
  support_tickets: ["opened_at"],
};

export type ClockShiftOutcome = "success" | "no-op" | "failure";

export interface ClockShiftResult {
  ok: boolean;
  /** The UTC calendar date (`YYYY-MM-DD`) the run is ledgered under. */
  date: string;
  outcome: ClockShiftOutcome;
  /** Total timestamp columns shifted across all seed rows (0 for no-op). */
  rowsShifted: number;
  durationMs: number;
  /** Postcondition: bible-vs-DB reconcile stays green across the shift. */
  reconcile: { ok: boolean; findings: number };
  detail: Record<string, unknown>;
  error?: string;
}

/** The UTC calendar date a timestamp (epoch ms) belongs to, `YYYY-MM-DD`. */
export function ledgerDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Shift every timestamp on `data_origin='seed'` rows forward one day.
 *
 * The whole run — shift, ledger insert, and the reconcile postcondition —
 * executes inside one better-sqlite3 transaction: a mid-run failure (or a
 * red reconcile) leaves the database unchanged. A second invocation for the
 * same UTC date is a recorded no-op in the ledger, not an error.
 *
 * System writer, not a user write path: it updates rows preserving their
 * existing `data_origin` and writes ledger rows with an explicit origin, so
 * it intentionally bypasses the lib/db/session.ts `insertRow` stamp (the
 * stamp would overwrite origins the rows already carry).
 */
export function runClockShift(
  sqlite: Database.Database,
  now: number = Date.now(),
): ClockShiftResult {
  const date = ledgerDate(now);
  const startedAt = Date.now();

  const ledgerStmt = sqlite.prepare(
    "INSERT INTO job_run_ledger " +
      "(job, ledger_date, outcome, rows_affected, duration_ms, detail_json, data_origin) " +
      "VALUES ('clock-shift', ?, ?, ?, ?, ?, 'seed')",
  );

  let rowsShifted = 0;
  let reconcileReport: ReturnType<typeof reconcile> | undefined;

  try {
    // Prepared inside the try so a schema-level failure is a reported failure
    // result, not an uncaught throw.
    const shiftStmts = Object.entries(SHIFT_COLUMNS).flatMap(
      ([table, columns]) =>
        columns.map((column) =>
          sqlite.prepare(
            `UPDATE ${table} SET ${column} = ${column} + ${DAY_MS} ` +
              `WHERE data_origin = 'seed' AND ${column} IS NOT NULL`,
          ),
        ),
    );

    sqlite.transaction(() => {
      for (const stmt of shiftStmts) {
        rowsShifted += stmt.run().changes;
      }

      // Postcondition: prove quarter-tag anchoring — the shift must leave the
      // bible-vs-DB diff green. Any finding aborts the transaction.
      reconcileReport = reconcile(sqlite);
      if (!reconcileReport.ok) {
        throw new Error(
          "postcondition reconcile failed: " +
            reconcileReport.findings
              .map((f) => `${f.check}: ${f.message}`)
              .join("; "),
        );
      }

      // Ledger insert LAST: the unique (job, ledger_date) index is the
      // idempotency guard — a double run fails here, inside the transaction,
      // and rolls the shift back. Caught below and reported as a no-op.
      ledgerStmt.run(
        date,
        "success",
        rowsShifted,
        Date.now() - startedAt,
        JSON.stringify({ dayMs: DAY_MS, columns: SHIFT_COLUMNS }),
      );
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: job_run_ledger/i.test(message)) {
      // Second run for the same day: refused, recorded, nothing shifted.
      const noopMs = Date.now() - startedAt;
      sqlite
        .prepare(
          "UPDATE job_run_ledger SET " +
            "outcome = 'no-op', duration_ms = duration_ms + ?, " +
            "detail_json = json_set(COALESCE(detail_json, '{}'), '$.duplicate_run_ms', ?), " +
            "updated_at = unixepoch() * 1000 " +
            "WHERE job = 'clock-shift' AND ledger_date = ?",
        )
        .run(noopMs, noopMs, date);
      return {
        ok: true,
        date,
        outcome: "no-op",
        rowsShifted: 0,
        durationMs: noopMs,
        reconcile: { ok: true, findings: 0 },
        detail: { reason: "already shifted for this date" },
      };
    }
    // Any other failure: the transaction rolled back; the DB is unchanged.
    const durationMs = Date.now() - startedAt;
    return {
      ok: false,
      date,
      outcome: "failure",
      rowsShifted: 0,
      durationMs,
      reconcile: { ok: reconcileReport?.ok ?? false, findings: reconcileReport?.findings.length ?? 0 },
      detail: {},
      error: message,
    };
  }

  const durationMs = Date.now() - startedAt;
  return {
    ok: true,
    date,
    outcome: "success",
    rowsShifted,
    durationMs,
    reconcile: {
      ok: reconcileReport?.ok ?? false,
      findings: reconcileReport?.findings.length ?? 0,
    },
    detail: { date, dayMs: DAY_MS, rowsShifted },
  };
}
