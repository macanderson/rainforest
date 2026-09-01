/**
 * Session context — the write-path chokepoint for `data_origin` attribution
 * (docs/architecture.md §3 "The `data_origin` column convention" and §5
 * "Auth and roles").
 *
 * Every row created by the app must go through `withSession` + `insertRow`.
 * The session role decides the stamp:
 *
 * - `sales-rep` — every row is stamped `data_origin='demo'`, so the nightly
 *   demo-wipe job (§8) can delete live-demo residue without touching `seed`
 *   or `agent` data. Callers cannot override the stamp.
 * - `admin` — rows are stamped `data_origin='seed'` (admin writes maintain
 *   the bible-governed seed world, never demo residue).
 * - `agent` — rows are stamped `data_origin='agent'`; agent writes are kept
 *   forever and are unaffected by demo stamping.
 *
 * The chokepoint is enforced two ways:
 *
 * 1. `insertRow` is the only exported insert helper, and it throws unless a
 *    session scope is active — there is no session-less write path.
 * 2. `findRawInserts` (used by the test suite) scans the repository for
 *    raw `.insert(` / `INSERT INTO` write paths outside this module and the
 *    migration runner, so a future route that bypasses the chokepoint fails
 *    CI.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { DatabaseClient } from "./client";
import type { DataOrigin } from "./columns";

/** The three roles of architecture.md §5. */
export const SESSION_ROLES = ["admin", "sales-rep", "agent"] as const;

export type SessionRole = (typeof SESSION_ROLES)[number];

export interface Session {
  role: SessionRole;
  /** Display name or agent id, for audit attribution. */
  actor: string;
}

const storage = new AsyncLocalStorage<Session>();

/**
 * The `data_origin` a session role stamps on every row it creates. This is
 * the entire stamping rule — one function, one chokepoint.
 */
export function originForRole(role: SessionRole): DataOrigin {
  switch (role) {
    case "sales-rep":
      return "demo";
    case "admin":
      return "seed";
    case "agent":
      return "agent";
  }
}

/**
 * Run `fn` inside an authenticated session scope. Every `insertRow` call
 * made by `fn` (synchronously or in awaited continuations) is stamped per
 * the session role.
 */
export function withSession<T>(session: Session, fn: () => T): T {
  if (!SESSION_ROLES.includes(session.role)) {
    throw new Error(`withSession: unknown role ${JSON.stringify(session.role)}`);
  }
  return storage.run(session, fn);
}

/** The active session, or `undefined` outside any `withSession` scope. */
export function currentSession(): Session | undefined {
  return storage.getStore();
}

function requireSession(): Session {
  const session = storage.getStore();
  if (!session) {
    throw new Error(
      "insertRow: no active session — every write must run inside withSession() " +
        "so data_origin attribution (architecture.md §3) cannot be bypassed",
    );
  }
  return session;
}

type InsertValue = Record<string, unknown>;

/**
 * The single write-path chokepoint. Stamps `data_origin` from the active
 * session role and inserts one row. `created_at`/`updated_at` are populated
 * by the shared column convention defaults (lib/db/columns.ts).
 *
 * A caller-supplied `dataOrigin` is never honored: the session role is the
 * only source of truth for attribution.
 */
export function insertRow(
  db: DatabaseClient,
  table: Parameters<DatabaseClient["insert"]>[0],
  values: InsertValue,
): void {
  const session = requireSession();
  const rest = { ...values };
  delete rest.dataOrigin;
  const stamped = { ...rest, dataOrigin: originForRole(session.role) };
  db.insert(table).values(stamped).run();
}

/* ------------------------------------------------------------------ */
/* Raw-write guard — proves no write path bypasses the chokepoint.     */
/* ------------------------------------------------------------------ */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Directories that never contain app write paths. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".stella",
  ".worktrees", // git worktrees cut inside the checkout are copies of this tree
  "drizzle", // generated SQL migrations, applied only by the runner
]);

/**
 * Files allowed to contain raw inserts, with the reason each is exempt.
 * Everything else in the repo must write through `insertRow`.
 */
const RAW_INSERT_ALLOWLIST: Record<string, string> = {
  "lib/db/audit.ts":
    "the audit-trail mutation chokepoint itself (architecture §9.3): createRow/updateRow/deleteRow " +
    "are the single write path for domain mutations and write the audit_log row in the same " +
    "transaction — the .insert/.update/.delete call sites here ARE the sanctioned write path",
  "lib/db/migrate.mjs": "migration runner; ledger rows are stamped 'seed' explicitly",
  "tests/db-migrate.test.mjs": "exercises the runner and the CHECK constraint directly",
  "tests/db-schema.test.mjs": "exercises DDL/cascade behavior with raw SQL fixtures",
  "tests/db-session.test.mjs": "tests the chokepoint; its raw-insert mentions are scanner fixtures",
  "lib/db/demo-wipe.ts":
    "system writer, not a user write path: it restores snapshot rows with their original data_origin, " +
    "writes the snapshot table, and logs job_runs with an explicit origin — the session stamp would " +
    "overwrite an origin these rows already carry",
  "lib/db/clock-shift.ts":
    "system writer, not a user write path: it shifts seed rows in place preserving their data_origin " +
    "and writes the job_run_ledger with an explicit origin — the session stamp would overwrite origins " +
    "these rows already carry",
  "tests/demo-wipe.test.mjs": "seeds wipe/restore fixtures across tables with raw SQL",
  "tests/clock-shift.test.mjs": "seeds clock-shift fixtures across tables with raw SQL",
  "tests/reconcile.test.mjs": "seeds catalog fixtures with raw SQL to aggregate against the bible",
  "tests/jobs-observability.test.mjs":
    "seeds job_run_ledger/job_runs fixtures with raw SQL to test the observability reads",
  "lib/auth/seed-users.mjs":
    "credential-account seeder, not a user write path: idempotently inserts the §5 demo " +
    "accounts with an explicit 'seed' origin — accounts are seed data, not session-attributed rows",
  "tests/auth.test.mjs":
    "exercises the users-table CHECK constraint with a raw SQL fixture",
  "lib/seed/orchestrator.ts":
    "system writer, not a user write path: the master seed orchestrator wipes and reseeds " +
    "data_origin='seed' rows with an explicit origin — there is no interactive session during " +
    "a seed, and the session stamp would overwrite the origin these rows must carry",
  "lib/seed/generators.ts":
    "the built-in domain generators write exclusively through the orchestrator's SeedHandle " +
    "(lib/seed/orchestrator.ts), which stamps data_origin='seed' — the handle.insert call " +
    "sites are not write paths of their own",
  "tests/seed-orchestrator.test.mjs":
    "exercises the orchestrator with raw SQL fixtures and content digests",
};

const RAW_INSERT_PATTERNS = [
  /\.insert\s*\(/, // Drizzle query-builder insert
  /\bINSERT\s+INTO\b/i, // raw SQL
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      yield full;
    }
  }
}

export interface RawInsertViolation {
  file: string;
  line: number;
  source: string;
}

/**
 * Scan the repository for raw insert write paths outside this module and
 * the allowlist. Returns every violation; the test suite asserts the result
 * is empty, so a new mutation route that bypasses `insertRow` fails CI.
 */
export function findRawInserts(root: string = REPO_ROOT): RawInsertViolation[] {
  const violations: RawInsertViolation[] = [];
  for (const full of walk(root)) {
    const rel = relative(root, full).split("\\").join("/");
    if (rel === "lib/db/session.ts") continue; // the chokepoint itself
    if (rel in RAW_INSERT_ALLOWLIST) continue;
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((source, i) => {
      if (RAW_INSERT_PATTERNS.some((p) => p.test(source))) {
        violations.push({ file: rel, line: i + 1, source: source.trim() });
      }
    });
  }
  return violations;
}
