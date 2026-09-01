/**
 * Job observability page — docs/architecture.md §8, issue E6#4.
 *
 * The living-demo machinery's trust surface: per job, the last run, rows
 * shifted/wiped, duration, failures with their recorded detail, the next
 * scheduled tick, and a red banner when a job missed its scheduled window
 * (04:00 UTC clock-shift, 08:00 UTC demo-wipe — §7.2).
 *
 * Role-gated: this is an ops surface, not a sales-rep surface. Until the
 * iron-session login (E8) lands, the gate is the `JOBS_OBSERVABILITY_TOKEN`
 * env var — the page renders only for `?token=` (or an
 * `x-jobs-token` header) matching it, and 404s otherwise. When the env var
 * is unset the page is dark entirely: fail closed, never open by default.
 * Red is reserved for the alert states per the locked token sheet (§2).
 */
import { createDatabase } from "@/lib/db/client";
import {
  getJobStatuses,
  type JobStatus,
} from "@/lib/jobs/observability";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const JOB_LABELS: Record<JobStatus["job"], string> = {
  "clock-shift": "Clock shift",
  "demo-wipe": "Demo wipe",
};

const ROWS_LABELS: Record<JobStatus["job"], string> = {
  "clock-shift": "Rows shifted",
  "demo-wipe": "Rows wiped",
};

function formatInstant(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function authorized(
  params: Record<string, string | string[] | undefined>,
  headerToken: string | null,
): boolean {
  const expected = process.env.JOBS_OBSERVABILITY_TOKEN;
  if (!expected) return false;
  const presented =
    (typeof params.token === "string" ? params.token : undefined) ??
    headerToken;
  return presented === expected;
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "failure") {
    return (
      <span className="rounded border border-red-600 bg-white px-2 py-0.5 text-xs font-semibold text-red-700">
        failure
      </span>
    );
  }
  return (
    <span className="rounded border border-grey-300 bg-grey-50 px-2 py-0.5 text-xs font-medium text-grey-700">
      {outcome}
    </span>
  );
}

function JobCard({ status }: { status: JobStatus }) {
  const { lastRun } = status;
  return (
    <section className="rounded-lg border border-grey-200 bg-white">
      <header className="flex items-center justify-between border-b border-grey-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-black">
            {JOB_LABELS[status.job]}
          </h2>
          <p className="text-xs text-grey-500">
            daily {String(status.scheduleHourUtc).padStart(2, "0")}:00 UTC
          </p>
        </div>
        {lastRun ? (
          <OutcomeBadge outcome={lastRun.outcome} />
        ) : (
          <span className="rounded border border-grey-300 bg-grey-50 px-2 py-0.5 text-xs font-medium text-grey-500">
            no runs recorded
          </span>
        )}
      </header>

      {lastRun ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-grey-500">
              Last run
            </dt>
            <dd className="mt-0.5 text-grey-900">{formatInstant(lastRun.at)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-grey-500">
              {ROWS_LABELS[status.job]}
            </dt>
            <dd className="mt-0.5 text-grey-900">
              {lastRun.rowsAffected.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-grey-500">
              Duration
            </dt>
            <dd className="mt-0.5 text-grey-900">
              {formatDuration(lastRun.durationMs)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-grey-500">
              Next tick
            </dt>
            <dd className="mt-0.5 text-grey-900">
              {formatInstant(status.nextTickAt)}
            </dd>
          </div>
          {lastRun.outcome === "failure" && (
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs uppercase tracking-wider text-red-700">
                Failure detail
              </dt>
              <dd className="mt-0.5 rounded border border-red-300 bg-white p-2 font-mono text-xs text-red-800">
                {lastRun.error ?? "recorded without an error message"}
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="px-4 py-6 text-sm text-grey-500">
          No runs recorded yet. The first scheduled tick is{" "}
          {formatInstant(status.nextTickAt)}.
        </p>
      )}
    </section>
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const headerList = await headers();
  const params = await searchParams;
  if (!authorized(params, headerList.get("x-jobs-token"))) {
    notFound();
  }

  let statuses: JobStatus[] | null = null;
  let loadError: string | null = null;
  try {
    const db = createDatabase();
    try {
      statuses = getJobStatuses(db.$client);
    } finally {
      db.$client.close();
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
  }

  const missed = statuses?.filter((s) => s.missedWindow) ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-black px-6 py-3">
        <span className="text-sm font-semibold tracking-wide text-white">
          RAINFOREST <span className="text-grey-400">/ job observability</span>
        </span>
        <span className="rounded border border-grey-600 px-2 py-0.5 text-xs font-medium text-grey-300">
          admin · ops
        </span>
      </header>

      <main className="flex-1 bg-white p-6">
        <h1 className="text-xl font-semibold text-black">Living-demo jobs</h1>
        <p className="mt-1 max-w-prose text-sm text-grey-600">
          Last run, rows shifted/wiped, duration, and the next scheduled tick
          for the clock-shift (04:00 UTC) and demo-wipe (08:00 UTC) jobs.
        </p>

        {loadError !== null ? (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-600 bg-white p-4"
          >
            <p className="text-sm font-semibold text-red-700">
              Job run data could not be loaded
            </p>
            <p className="mt-1 font-mono text-xs text-red-800">{loadError}</p>
          </div>
        ) : (
          <>
            {missed.length > 0 && (
              <div
                role="alert"
                className="mt-6 rounded-lg border border-red-600 bg-white p-4"
              >
                <p className="text-sm font-semibold text-red-700">
                  {missed.length === 1
                    ? "A job missed its scheduled window"
                    : `${missed.length} jobs missed their scheduled window`}
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-red-800">
                  {missed.map((s) => (
                    <li key={s.job}>
                      {JOB_LABELS[s.job]} — no successful run since the{" "}
                      {formatInstant(s.lastWindowAt)} slot
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 space-y-4">
              {(statuses ?? []).map((status) => (
                <JobCard key={status.job} status={status} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
