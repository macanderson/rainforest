/**
 * Nightly demo-wipe job — architecture.md §8, issue E6#3.
 *
 * Runs at 08:00 UTC via the authenticated cron endpoint
 * (app/api/jobs/demo-wipe/route.ts). Three phases, one transaction:
 *
 * 1. **Snapshot-diff.** Every `data_origin='seed'` row mutated since the
 *    previous wipe is restored to the state that snapshot recorded. This is
 *    the chosen restore mechanism (the issue allows snapshot-diff or
 *    re-derivation): each wipe snapshots all seed rows before deleting
 *    anything, and the *next* run diffs current seed rows against that
 *    snapshot. Re-derivation was rejected — the E3 generators are not
 *    deterministic per-row yet, and a snapshot is exact by construction.
 * 2. **Wipe.** All `data_origin='demo'` rows are deleted in dependency
 *    order (children before parents) so the delete is cascade-safe even
 *    where FKs are RESTRICT. `seed` and `agent` rows are never touched.
 *    `audit_log` is append-only (architecture §9.3): its demo rows are
 *    archived into `demo_wipe_audit_archive` before deletion, so the trail
 *    survives the wipe it describes and the database triggers that reject
 *    DELETE on `audit_log` are never tripped.
 * 3. **Postcondition.** `reconcile()` must be green on the wiped database
 *    or the whole transaction rolls back — the next demo never starts from
 *    a drifted database.
 *
 * Every run writes a `job_runs` ledger row (job observability, E6#4) with
 * rows wiped/restored per table, duration, and outcome. The ledger write is
 * outside the wipe transaction so failures are still recorded. A run with
 * zero demo rows and no seed drift is a clean no-op.
 */
import type Database from "better-sqlite3";

import { reconcile, type BibleRow, type ReconcileReport } from "../reconcile.ts";

/**
 * Wipe order: children before parents so no delete ever dangles a FK, even
 * on the RESTRICT relations. `agent_actions` has no outbound FKs and goes
 * first; `job_runs` is the ledger itself and is wiped last (its rows are
 * origin-stamped like everything else). `audit_log` is deliberately absent:
 * it is append-only (architecture §9.3), so its demo rows are archived to
 * `demo_wipe_audit_archive` before the wipe loop instead of deleted.
 */
export const WIPE_ORDER = [
  "agent_actions",
  "support_tickets",
  "shipments",
  "sales_order_lines",
  "sales_orders",
  "purchase_order_lines",
  "purchase_orders",
  "stock_levels",
  "products",
  "categories",
  "warehouses",
  "suppliers",
  "job_runs",
] as const;

/** Tables whose seed rows participate in the snapshot-diff restore. */
export const SNAPSHOT_TABLES = [
  "suppliers",
  "warehouses",
  "categories",
  "products",
  "stock_levels",
  "purchase_orders",
  "purchase_order_lines",
  "sales_orders",
  "sales_order_lines",
  "shipments",
  "support_tickets",
] as const;

const SNAPSHOT_TABLE = "demo_wipe_seed_snapshot";

export interface DemoWipeResult {
  ok: boolean;
  jobRunId: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** demo rows deleted, per table */
  rowsWiped: Record<string, number>;
  /** seed rows restored from the previous snapshot, per table */
  rowsRestored: Record<string, number>;
  reconcile: { ok: boolean; dbHalf: ReconcileReport["dbHalf"] };
  error?: string;
}

type Sqlite = Database.Database;

function ensureSnapshotTable(sqlite: Sqlite) {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (` +
      "table_name TEXT NOT NULL, " +
      "row_id INTEGER NOT NULL, " +
      "row_json TEXT NOT NULL, " +
      "PRIMARY KEY (table_name, row_id)" +
      ")",
  );
}

/** Read every seed row of every snapshot table as {table: {id: rowJson}}. */
function readSeedRows(sqlite: Sqlite) {
  const out = new Map<string, Map<number, string>>();
  for (const table of SNAPSHOT_TABLES) {
    const rows = sqlite
      .prepare(`SELECT * FROM ${table} WHERE data_origin = 'seed' ORDER BY id`)
      .all() as Record<string, unknown>[];
    out.set(
      table,
      new Map(rows.map((r) => [r.id as number, JSON.stringify(r)])),
    );
  }
  return out;
}

/**
 * Restore seed rows mutated since the last snapshot: rows whose JSON differs
 * are UPDATEd back, rows deleted outright are re-INSERTed. Returns per-table
 * restore counts.
 */
function restoreFromSnapshot(sqlite: Sqlite, now: number) {
  const restored: Record<string, number> = {};
  const snapshotRows = sqlite
    .prepare(`SELECT table_name, row_id, row_json FROM ${SNAPSHOT_TABLE}`)
    .all() as { table_name: string; row_id: number; row_json: string }[];

  const byTable = new Map<string, { id: number; json: string }[]>();
  for (const row of snapshotRows) {
    const list = byTable.get(row.table_name) ?? [];
    list.push({ id: row.row_id, json: row.row_json });
    byTable.set(row.table_name, list);
  }

  for (const [table, rows] of byTable) {
    if (!(SNAPSHOT_TABLES as readonly string[]).includes(table)) continue;
    let count = 0;
    for (const { id, json } of rows) {
      const snapshot = JSON.parse(json) as Record<string, unknown>;
      const current = sqlite
        .prepare(`SELECT * FROM ${table} WHERE id = ?`)
        .get(id) as Record<string, unknown> | undefined;

      if (current && JSON.stringify(current) === json) continue;

      if (current) {
        const cols = Object.keys(snapshot).filter(
          (c) => c !== "id" && c !== "data_origin" && c !== "updated_at",
        );
        sqlite
          .prepare(
            `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")}, ` +
              "data_origin = 'seed', updated_at = ? WHERE id = ?",
          )
          .run(...cols.map((c) => snapshot[c] as never), now, id);
      } else {
        const cols = Object.keys(snapshot).filter((c) => c !== "updated_at");
        sqlite
          .prepare(
            `INSERT INTO ${table} (${cols.join(", ")}, updated_at) ` +
              `VALUES (${cols.map(() => "?").join(", ")}, ?)`,
          )
          .run(...cols.map((c) => snapshot[c] as never), now);
      }
      count += 1;
    }
    if (count > 0) restored[table] = count;
  }
  return restored;
}

/** Replace the snapshot with the current (post-restore) seed state. */
function writeSnapshot(
  sqlite: Sqlite,
  seedRows: Map<string, Map<number, string>>,
) {
  sqlite.prepare(`DELETE FROM ${SNAPSHOT_TABLE}`).run();
  const insert = sqlite.prepare(
    `INSERT INTO ${SNAPSHOT_TABLE} (table_name, row_id, row_json) VALUES (?, ?, ?)`,
  );
  for (const [table, rows] of seedRows) {
    for (const [id, json] of rows) insert.run(table, id, json);
  }
}

interface WipeBody {
  rowsWiped: Record<string, number>;
  rowsRestored: Record<string, number>;
  reconcile: { ok: boolean; dbHalf: ReconcileReport["dbHalf"] };
}

/**
 * Archive every `data_origin='demo'` audit_log row into
 * `demo_wipe_audit_archive`, then delete the originals. `audit_log` is
 * append-only (architecture §9.3) and migration 0005's triggers reject
 * UPDATE/DELETE on it — the no-delete trigger permits deletion only while
 * the `audit_log_delete_gate` row is open, and this function is the only
 * code that opens it (inside the wipe transaction, so a rolled-back wipe
 * closes the gate with it). Returns the number of rows archived.
 */
function archiveDemoAuditRows(sqlite: Sqlite): number {
  const { n } = sqlite
    .prepare("SELECT COUNT(*) n FROM audit_log WHERE data_origin = 'demo'")
    .get() as { n: number };
  if (n === 0) return 0;
  sqlite
    .prepare(
      `INSERT INTO demo_wipe_audit_archive
         (id, actor, action, entity_table, entity_id, before_json, after_json,
          reason, data_origin, created_at, updated_at, archived_at)
       SELECT id, actor, action, entity_table, entity_id, before_json, after_json,
              reason, data_origin, created_at, updated_at, ?
       FROM audit_log WHERE data_origin = 'demo'`,
    )
    .run(Date.now());
  sqlite.prepare("UPDATE audit_log_delete_gate SET open = 1 WHERE id = 1").run();
  try {
    sqlite.prepare("DELETE FROM audit_log WHERE data_origin = 'demo'").run();
  } finally {
    sqlite.prepare("UPDATE audit_log_delete_gate SET open = 0 WHERE id = 1").run();
  }
  return n;
}

/** The wipe itself. Throws if the reconcile postcondition is red. */
function wipeBody(
  sqlite: Sqlite,
  startedAt: number,
  opts: { bible?: BibleRow[]; skipIdentities?: boolean } = {},
): WipeBody {
  // Phase 1 — restore seed rows mutated since the last snapshot.
  const rowsRestored = restoreFromSnapshot(sqlite, startedAt);

  // Phase 2 — delete every demo row, children before parents. audit_log is
  // append-only (§9.3): archive its demo rows first, then delete them via a
  // session variable the no-delete trigger recognizes as the wipe's own.
  const archived = archiveDemoAuditRows(sqlite);
  const rowsWiped: Record<string, number> = {};
  if (archived > 0) rowsWiped.audit_log = archived;
  for (const table of WIPE_ORDER) {
    const { changes } = sqlite
      .prepare(`DELETE FROM ${table} WHERE data_origin = 'demo'`)
      .run();
    if (changes > 0) rowsWiped[table] = changes;
  }

  // Phase 3 — refresh the snapshot to the post-wipe seed state, then prove
  // the database is bible-true. A red reconcile throws and the surrounding
  // transaction rolls the whole wipe back.
  writeSnapshot(sqlite, readSeedRows(sqlite));
  const report = reconcile(sqlite, opts.bible, {
    skipIdentities: opts.skipIdentities,
  });
  if (!report.ok) {
    const message = report.findings
      .map(
        (f) => `[${f.check}]${f.quarter ? ` ${f.quarter}:` : ""} ${f.message}`,
      )
      .join("; ");
    throw new Error(`reconcile postcondition failed: ${message}`);
  }
  return { rowsWiped, rowsRestored, reconcile: { ok: true, dbHalf: report.dbHalf } };
}

/**
 * Run the demo wipe against an open better-sqlite3 handle (foreign keys must
 * already be ON — createDatabase does this). The wipe runs in a single
 * transaction; the job_runs ledger row is written after, so both success and
 * failure are observable.
 */
export function runDemoWipe(
  sqlite: Sqlite,
  opts: { bible?: BibleRow[]; skipIdentities?: boolean } = {},
): DemoWipeResult {
  const startedAt = Date.now();
  ensureSnapshotTable(sqlite);

  let body: WipeBody | undefined;
  let error: string | undefined;
  try {
    sqlite.transaction(() => {
      body = wipeBody(sqlite, startedAt, opts);
    })();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const finishedAt = Date.now();
  const ok = body !== undefined;
  const detail = {
    rowsWiped: body?.rowsWiped ?? {},
    rowsRestored: body?.rowsRestored ?? {},
    totalWiped: Object.values(body?.rowsWiped ?? {}).reduce((a, b) => a + b, 0),
    totalRestored: Object.values(body?.rowsRestored ?? {}).reduce(
      (a, b) => a + b,
      0,
    ),
    durationMs: finishedAt - startedAt,
    reconcile: body?.reconcile ?? { ok: false, dbHalf: "skipped" },
    ...(error ? { error } : {}),
  };
  const runId = sqlite
    .prepare(
      "INSERT INTO job_runs (job, status, started_at, finished_at, detail_json, data_origin) " +
        "VALUES ('demo-wipe', ?, ?, ?, ?, 'agent')",
    )
    .run(
      ok ? "success" : "failure",
      startedAt,
      finishedAt,
      JSON.stringify(detail),
    ).lastInsertRowid as number;

  return {
    ok,
    jobRunId: runId,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    rowsWiped: detail.rowsWiped,
    rowsRestored: detail.rowsRestored,
    reconcile: detail.reconcile,
    ...(error ? { error } : {}),
  };
}
