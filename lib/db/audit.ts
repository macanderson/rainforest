/**
 * Audit-trail plumbing — the single write path for domain mutations
 * (docs/architecture.md §9.3 "Audit trail with actor identity").
 *
 * Every mutation in the system — human or agent — goes through one of the
 * three helpers here (`createRow`, `updateRow`, `deleteRow`). Each helper:
 *
 * 1. Requires an active session (`withSession`, lib/db/session.ts) — there is
 *    no session-less mutation path, so actor attribution cannot be skipped.
 * 2. Runs the domain write and the `audit_log` insert in ONE SQLite
 *    transaction: either both land or neither does, so a mutation through the
 *    helper cannot skip its audit row.
 * 3. Records the actor as `human:<user>` or `agent:<name>` per §9.3, a
 *    machine-readable action verb, before/after row snapshots (before empty
 *    on create, after empty on delete), and a reason string (machine-readable
 *    for agents, free text for humans).
 * 4. Stamps `data_origin` from the session role — agent-actor writes stamp
 *    `data_origin='agent'` on the mutated row (§3), and a caller-supplied
 *    `dataOrigin` is never honored.
 *
 * `audit_log` itself is append-only: this module exports no update or delete
 * path for it, the raw-write scanner in lib/db/session.ts fails CI on any
 * `.update(`/`.delete(`/`UPDATE`/`DELETE` write path outside the allowlist,
 * and migration 0005 installs database triggers that reject UPDATE/DELETE on
 * the table outright — so even raw SQL cannot rewrite history.
 *
 * Downstream consumers — the agent activity feed (E5#6) and the reorder
 * approval queue (E4#5) — read this trail straight; `readAuditTrail` is the
 * query surface they render from.
 */
import { and, eq } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import type { DatabaseClient } from "./client.ts";
import { auditLog } from "./schema.ts";
import { currentSession, originForRole } from "./session.ts";

/** The three mutation verbs the trail records. */
export const AUDIT_ACTIONS = ["create", "update", "delete"] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface MutationOptions {
  /**
   * Machine-readable reason string for agents (include the policy math),
   * free text for humans (architecture §9.3).
   */
  reason: string;
}

/** One `audit_log` row as downstream consumers (E5#6, E4#5) read it. */
export interface AuditEntry {
  id: number;
  /** `human:<user>` or `agent:<name>`. */
  actor: string;
  /** Machine-readable verb: `create` | `update` | `delete`. */
  action: string;
  entityTable: string;
  entityId: number;
  /** Parsed row snapshots; null when not applicable. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  dataOrigin: string;
  createdAt: Date;
}

function requireMutationSession() {
  const session = currentSession();
  if (!session) {
    throw new Error(
      "mutation: no active session — every mutation must run inside withSession() " +
        "so audit-trail actor attribution (architecture.md §9.3) cannot be bypassed",
    );
  }
  return session;
}

/** §9.3 actor identity: `human:<user>` for people, `agent:<name>` for agents. */
export function actorForSession(session: {
  role: string;
  actor: string;
}): string {
  return session.role === "agent" ? `agent:${session.actor}` : `human:${session.actor}`;
}

function tableName(table: SQLiteTable): string {
  return getTableName(table);
}

function snapshot(row: unknown): Record<string, unknown> {
  return { ...(row as Record<string, unknown>) };
}

/**
 * Write one `audit_log` row. Private to this module — the only callers are
 * the three mutation helpers, inside their mutation transaction, so an audit
 * row can never exist without its mutation (or vice versa).
 */
function writeAuditRow(
  db: DatabaseClient,
  entry: {
    actor: string;
    action: AuditAction;
    entityTable: string;
    entityId: number;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason: string;
    dataOrigin: "seed" | "demo" | "agent";
  },
): void {
  db.insert(auditLog)
    .values({
      actor: entry.actor,
      action: entry.action,
      entityTable: entry.entityTable,
      entityId: entry.entityId,
      beforeJson: entry.before === null ? null : JSON.stringify(entry.before),
      afterJson: entry.after === null ? null : JSON.stringify(entry.after),
      reason: entry.reason,
      dataOrigin: entry.dataOrigin,
    })
    .run();
}

/**
 * Create one row and its audit entry in a single transaction. The `before`
 * snapshot is empty (null); the `after` snapshot is the inserted row. Returns
 * the inserted row (with its new id).
 */
export function createRow(
  db: DatabaseClient,
  table: SQLiteTable,
  values: Record<string, unknown>,
  options: MutationOptions,
): Record<string, unknown> {
  const session = requireMutationSession();
  const rest = { ...values };
  delete rest.dataOrigin; // the session role is the only source of truth
  const stamped = { ...rest, dataOrigin: originForRole(session.role) };
  return db.transaction((tx) => {
    const rows = (tx as unknown as DatabaseClient)
      .insert(table as never)
      .values(stamped as never)
      .returning()
      .all() as unknown as Record<string, unknown>[];
    const row = rows[0];
    if (!row) {
      throw new Error(`createRow: insert into ${tableName(table)} returned no row`);
    }
    writeAuditRow(tx as unknown as DatabaseClient, {
      actor: actorForSession(session),
      action: "create",
      entityTable: tableName(table),
      entityId: row.id as number,
      before: null,
      after: snapshot(row),
      reason: options.reason,
      dataOrigin: originForRole(session.role),
    });
    return row;
  });
}

/**
 * Update one row (by primary-key id) and its audit entry in a single
 * transaction. Captures the `before` snapshot first; the `after` snapshot is
 * the row as written. Throws if no row with `id` exists — a mutation that
 * touches nothing must not write an audit row.
 */
export function updateRow(
  db: DatabaseClient,
  table: SQLiteTable,
  id: number,
  patch: Record<string, unknown>,
  options: MutationOptions,
): Record<string, unknown> {
  const session = requireMutationSession();
  const rest = { ...patch };
  delete rest.dataOrigin;
  delete rest.id; // the primary key is never rewritten
  const stamped = {
    ...rest,
    dataOrigin: originForRole(session.role),
    updatedAt: new Date(),
  };
  return db.transaction((tx) => {
    const client = tx as unknown as DatabaseClient;
    const beforeRows = client
      .select()
      .from(table as never)
      .where(eq((table as never as { id: never }).id, id))
      .all() as Record<string, unknown>[];
    const before = beforeRows[0];
    if (!before) {
      throw new Error(
        `updateRow: no row id=${id} in ${tableName(table)} — refusing to audit a no-op mutation`,
      );
    }
    const afterRows = client
      .update(table as never)
      .set(stamped as never)
      .where(eq((table as never as { id: never }).id, id))
      .returning()
      .all() as unknown as Record<string, unknown>[];
    const after = afterRows[0];
    if (!after) {
      throw new Error(`updateRow: update of ${tableName(table)} id=${id} returned no row`);
    }
    writeAuditRow(client, {
      actor: actorForSession(session),
      action: "update",
      entityTable: tableName(table),
      entityId: id,
      before: snapshot(before),
      after: snapshot(after),
      reason: options.reason,
      dataOrigin: originForRole(session.role),
    });
    return after;
  });
}

/**
 * Delete one row (by primary-key id) and its audit entry in a single
 * transaction. The `before` snapshot is the deleted row; the `after` snapshot
 * is empty (null). Throws if no row with `id` exists.
 */
export function deleteRow(
  db: DatabaseClient,
  table: SQLiteTable,
  id: number,
  options: MutationOptions,
): Record<string, unknown> {
  const session = requireMutationSession();
  return db.transaction((tx) => {
    const client = tx as unknown as DatabaseClient;
    const beforeRows = client
      .select()
      .from(table as never)
      .where(eq((table as never as { id: never }).id, id))
      .all() as Record<string, unknown>[];
    const before = beforeRows[0];
    if (!before) {
      throw new Error(
        `deleteRow: no row id=${id} in ${tableName(table)} — refusing to audit a no-op mutation`,
      );
    }
    client
      .delete(table as never)
      .where(eq((table as never as { id: never }).id, id))
      .run();
    writeAuditRow(client, {
      actor: actorForSession(session),
      action: "delete",
      entityTable: tableName(table),
      entityId: id,
      before: snapshot(before),
      after: null,
      reason: options.reason,
      dataOrigin: originForRole(session.role),
    });
    return before;
  });
}

/**
 * Read the trail for downstream consumers — the agent activity feed (E5#6)
 * and the reorder approval queue (E4#5) render straight from this. Newest
 * first; optionally filtered by actor, action, or entity.
 */
export function readAuditTrail(
  db: DatabaseClient,
  filter: {
    actor?: string;
    action?: AuditAction;
    entityTable?: string;
    entityId?: number;
    limit?: number;
  } = {},
): AuditEntry[] {
  const conditions = [];
  if (filter.actor !== undefined) conditions.push(eq(auditLog.actor, filter.actor));
  if (filter.action !== undefined) conditions.push(eq(auditLog.action, filter.action));
  if (filter.entityTable !== undefined) {
    conditions.push(eq(auditLog.entityTable, filter.entityTable));
  }
  if (filter.entityId !== undefined) {
    conditions.push(eq(auditLog.entityId, filter.entityId));
  }
  let query = db.select().from(auditLog).orderBy(auditLog.id).$dynamic();
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  const rows = query.all() as (typeof auditLog.$inferSelect)[];
  return rows
    .map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      entityTable: row.entityTable,
      entityId: row.entityId,
      before: row.beforeJson === null ? null : JSON.parse(row.beforeJson),
      after: row.afterJson === null ? null : JSON.parse(row.afterJson),
      reason: row.reason,
      dataOrigin: row.dataOrigin,
      createdAt: row.createdAt,
    }))
    .reverse()
    .slice(0, filter.limit ?? rows.length);
}
