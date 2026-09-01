/**
 * Job observability — the data layer for the admin-facing jobs page
 * (docs/architecture.md §8, issue E6#4).
 *
 * The living-demo jobs (clock-shift at 04:00 UTC, demo-wipe at 08:00 UTC)
 * record their runs in two ledgers:
 *
 * - `job_run_ledger` — the clock-shift idempotency ledger: one row per
 *   (job, UTC calendar date) with outcome, rows shifted, duration.
 * - `job_runs` — the demo-wipe run ledger: one row per run with status,
 *   started/finished timestamps, and a JSON detail payload (rows wiped,
 *   rows restored, duration, error).
 *
 * This module reads both, normalizes them into one {@link JobStatus} per
 * job, and computes the missed-window alert: a job has missed its window
 * when the most recent scheduled slot (its daily UTC hour, today or
 * yesterday) has passed without a successful run recorded after that slot.
 * A job that has never run is treated as missed — silence is not health.
 */
import type Database from "better-sqlite3";

import { JOB_NAMES } from "../db/schema.ts";

export type JobName = (typeof JOB_NAMES)[number];

/** Daily UTC hour each job is scheduled at (architecture.md §7.2). */
export const JOB_SCHEDULES: Record<JobName, { hourUtc: number }> = {
  "clock-shift": { hourUtc: 4 },
  "demo-wipe": { hourUtc: 8 },
};

export type JobOutcome = "success" | "failure" | "no-op";

export interface JobRunSummary {
  /** When the run happened, epoch ms. */
  at: number;
  outcome: JobOutcome;
  /** Rows shifted (clock-shift) or wiped (demo-wipe). */
  rowsAffected: number;
  durationMs: number;
  /** Recorded error/outcome detail for failed runs. */
  error?: string;
  /** Extra per-job detail (rows restored, reconcile, …). */
  detail: Record<string, unknown>;
}

export interface JobStatus {
  job: JobName;
  /** Daily UTC hour the job is scheduled at. */
  scheduleHourUtc: number;
  /** The most recent recorded run, or null when the job never ran. */
  lastRun: JobRunSummary | null;
  /** The next scheduled tick after `now`, epoch ms. */
  nextTickAt: number;
  /** The most recent scheduled slot at or before `now`, epoch ms. */
  lastWindowAt: number;
  /** True when the last window passed with no successful run after it. */
  missedWindow: boolean;
}

/** The most recent scheduled slot (daily at `hourUtc`) at or before `now`. */
export function lastScheduledSlot(now: number, hourUtc: number): number {
  const dayStart = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  const todaySlot = dayStart + hourUtc * 3_600_000;
  return now >= todaySlot ? todaySlot : todaySlot - 86_400_000;
}

/** The next scheduled slot (daily at `hourUtc`) strictly after `now`. */
export function nextScheduledSlot(now: number, hourUtc: number): number {
  return lastScheduledSlot(now, hourUtc) + 86_400_000;
}

/**
 * Missed-window computation. A job is on schedule when a successful run is
 * recorded at or after the most recent scheduled slot; it has missed its
 * window when the slot passed with no success since — including the
 * never-ran case, where any passed slot counts as missed.
 */
export function computeMissedWindow(
  lastSuccessAt: number | null,
  now: number,
  hourUtc: number,
): boolean {
  return lastSuccessAt === null || lastSuccessAt < lastScheduledSlot(now, hourUtc);
}

/* ------------------------------------------------------------------ */
/* Ledger reads — one normalizer per ledger shape.                     */
/* ------------------------------------------------------------------ */

interface LedgerRow {
  outcome: string;
  rows_affected: number;
  duration_ms: number;
  detail_json: string | null;
  created_at: number;
}

interface JobRunRow {
  status: string;
  started_at: number;
  finished_at: number | null;
  detail_json: string | null;
}

function parseDetail(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function errorFromDetail(detail: Record<string, unknown>): string | undefined {
  return typeof detail.error === "string" ? detail.error : undefined;
}

/** Latest clock-shift run from the idempotency ledger (one row per date). */
function readClockShiftRun(sqlite: Database.Database): JobRunSummary | null {
  const row = sqlite
    .prepare(
      "SELECT outcome, rows_affected, duration_ms, detail_json, created_at " +
        "FROM job_run_ledger WHERE job = 'clock-shift' " +
        "ORDER BY ledger_date DESC, id DESC LIMIT 1",
    )
    .get() as LedgerRow | undefined;
  if (!row) return null;
  const detail = parseDetail(row.detail_json);
  return {
    at: row.created_at,
    outcome: row.outcome as JobOutcome,
    rowsAffected: row.rows_affected,
    durationMs: row.duration_ms,
    ...(errorFromDetail(detail) ? { error: errorFromDetail(detail) } : {}),
    detail,
  };
}

/** Latest demo-wipe run from the job_runs ledger. */
function readDemoWipeRun(sqlite: Database.Database): JobRunSummary | null {
  const row = sqlite
    .prepare(
      "SELECT status, started_at, finished_at, detail_json FROM job_runs " +
        "WHERE job = 'demo-wipe' ORDER BY started_at DESC, id DESC LIMIT 1",
    )
    .get() as JobRunRow | undefined;
  if (!row) return null;
  const detail = parseDetail(row.detail_json);
  const durationMs =
    typeof detail.durationMs === "number"
      ? detail.durationMs
      : row.finished_at !== null
        ? row.finished_at - row.started_at
        : 0;
  const rowsAffected =
    typeof detail.totalWiped === "number" ? detail.totalWiped : 0;
  return {
    at: row.started_at,
    outcome: row.status as JobOutcome,
    rowsAffected,
    durationMs,
    ...(errorFromDetail(detail) ? { error: errorFromDetail(detail) } : {}),
    detail,
  };
}

/** Last *successful* run instant per job, for the missed-window check. */
function readLastSuccessAt(
  sqlite: Database.Database,
  job: JobName,
): number | null {
  if (job === "clock-shift") {
    const row = sqlite
      .prepare(
        "SELECT MAX(created_at) AS at FROM job_run_ledger " +
          "WHERE job = 'clock-shift' AND outcome = 'success'",
      )
      .get() as { at: number | null };
    return row.at;
  }
  const row = sqlite
    .prepare(
      "SELECT MAX(started_at) AS at FROM job_runs " +
        "WHERE job = 'demo-wipe' AND status = 'success'",
    )
    .get() as { at: number | null };
  return row.at;
}

/**
 * Assemble the observability snapshot for every living-demo job. Pure read:
 * never throws on an empty ledger — jobs with no recorded runs come back
 * with `lastRun: null` and `missedWindow: true`.
 */
export function getJobStatuses(
  sqlite: Database.Database,
  now: number = Date.now(),
): JobStatus[] {
  return JOB_NAMES.map((job) => {
    const { hourUtc } = JOB_SCHEDULES[job];
    const lastRun =
      job === "clock-shift" ? readClockShiftRun(sqlite) : readDemoWipeRun(sqlite);
    const lastSuccessAt = readLastSuccessAt(sqlite, job);
    return {
      job,
      scheduleHourUtc: hourUtc,
      lastRun,
      nextTickAt: nextScheduledSlot(now, hourUtc),
      lastWindowAt: lastScheduledSlot(now, hourUtc),
      missedWindow: computeMissedWindow(lastSuccessAt, now, hourUtc),
    };
  });
}
