/**
 * Health endpoint — architecture.md §7.2, issue E7#1 (#15).
 *
 * The container HEALTHCHECK (Dockerfile) and the deploy verifier (E7#5) hit
 * this. It verifies DB reachability by counting migrations applied to the
 * SQLite file at DATABASE_PATH, and reports last-job freshness from the
 * run ledger (§8). Responds 200 only when the database answers; 503 with
 * the error otherwise so an unreachable DB fails the healthcheck.
 */
import { sql } from "drizzle-orm";

import { createDatabase, databasePath } from "@/lib/db/client.ts";
import { jobRuns } from "@/lib/db/schema.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = createDatabase();
    const migrations = db.all<{ tag: string }>(
      sql`SELECT tag FROM drizzle_migrations ORDER BY tag`,
    );
    const lastJob = db
      .select({
        job: jobRuns.job,
        status: jobRuns.status,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
      })
      .from(jobRuns)
      .orderBy(sql`${jobRuns.startedAt} DESC`)
      .limit(1)
      .all();

    return Response.json({
      status: "ok",
      database: {
        path: databasePath(),
        reachable: true,
        migrations: migrations.length,
      },
      lastJobRun: lastJob[0] ?? null,
    });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        database: {
          path: databasePath(),
          reachable: false,
          error: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 503 },
    );
  }
}
