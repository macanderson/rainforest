/**
 * Agent action framework — the one governed, auditable pathway every
 * operational agent acts through (docs/architecture.md §9 "The
 * agent-automation loop", §9.3 "Audit trail with actor identity", §3 "The
 * `data_origin` column convention").
 *
 * This module is the typed API the three agents of §9.1 — `auto-reorder`,
 * `fulfillment`, `exception` (issues E5#2–#4) — build on. It is deliberately
 * policy-free: it knows identities, idempotency keys, dry-run mode, and the
 * audit/`data_origin` stamping rules, and nothing about reorder points,
 * allocation, or SLA thresholds. Agent policy lives in the agents, never
 * here.
 *
 * The contract, enforced by the framework rather than by convention:
 *
 * 1. **Identity** — each agent acts as actor `agent:<name>` (§9.3), distinct
 *    from `human:<user>`. `runAgent` opens the `agent`-role session itself;
 *    an agent cannot act under a human identity or vice versa.
 * 2. **Ledger** — every action writes one `agent_actions` row carrying the
 *    agent identity, idempotency key, machine-readable reason string, and
 *    dry-run flag (§9.2), in the same transaction as the mutation it
 *    describes.
 * 3. **Audit** — the mutation itself goes through the E2#5 plumbing
 *    (`createRow`/`updateRow`/`deleteRow` in lib/db/audit.ts), so every agent
 *    mutation lands its `audit_log` row (actor, action, before/after
 *    snapshots, reason) in the same transaction. There is no agent write
 *    path that bypasses it: the framework exposes no other way to write.
 * 4. **Origin** — the session role stamps `data_origin='agent'` on every
 *    row the action touches, including the `agent_actions` ledger row
 *    itself (§3). Never `'seed'`, never `'demo'`, never caller-supplied.
 * 5. **Idempotency** — `agent_actions.idempotency_key` is UNIQUE. Replaying
 *    an action with an already-recorded key is a recorded no-op: the
 *    mutation callback never runs, no duplicate mutation, no duplicate
 *    audit row (§9.2 — a re-delivered cron tick cannot double-order).
 * 6. **Dry-run** — `dryRun: true` records the intended action (ledger row
 *    flagged `dry_run`) without running the mutation: no domain state
 *    changes, no audit row. Dry-run rows are still stamped
 *    `data_origin='agent'` — they are agent records, kept forever.
 */
import { and, eq } from "drizzle-orm";

import type { DatabaseClient } from "./client.ts";
import { AGENT_NAMES, agentActions } from "./schema.ts";
import { withSession } from "./session.ts";

/** The three operational agents of architecture.md §9.1. */
export const AGENT_IDS = AGENT_NAMES;

export type AgentName = (typeof AGENT_IDS)[number];

/** §9.3 actor identity for an agent: `agent:<name>`. */
export function agentActor(name: AgentName): string {
  return `agent:${name}`;
}

export interface AgentActionSpec {
  /**
   * Machine-readable verb for the ledger, e.g. `purchase_order.created`.
   * Namespaced by the affected entity so the activity feed can group it.
   */
  action: string;
  /**
   * Stable key for this decision — re-delivered ticks must derive the same
   * key for the same decision (e.g. `reorder:SKU-0001:WH-03:2026-09-01`).
   * A replay with an already-recorded key is a no-op.
   */
  idempotencyKey: string;
  /**
   * Machine-readable reason string (§9.3) — include the policy math so the
   * audit trail explains itself, e.g.
   * `on_hand(12)+inbound(0)<reorder_point(40);eoq=96;supplier=SUP-0007`.
   */
  reason: string;
  /**
   * Dry-run mode (§9.2): record the intended action without mutating any
   * domain state. Default false.
   */
  dryRun?: boolean;
}

export interface AgentActionResult<T> {
  /** The `agent_actions` ledger row id — present on every outcome. */
  agentActionId: number;
  /** The agent that acted, e.g. `auto-reorder`. */
  agent: AgentName;
  /** §9.3 actor identity, e.g. `agent:auto-reorder`. */
  actor: string;
  action: string;
  idempotencyKey: string;
  reason: string;
  dryRun: boolean;
  /**
   * `executed` — the mutation ran and committed with its audit row.
   * `duplicate` — the idempotency key was already recorded; the mutation
   *   callback never ran (no duplicate mutation, no duplicate audit row).
   * `dry-run` — the intended action was recorded; nothing was mutated.
   */
  outcome: "executed" | "duplicate" | "dry-run";
  /**
   * Whatever the mutation callback returned (e.g. the created row). `null`
   * on `duplicate` and `dry-run` outcomes.
   */
  result: T | null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("UNIQUE constraint failed") ||
      ("code" in err &&
        typeof (err as { code: unknown }).code === "string" &&
        ((err as { code: string }).code.startsWith("SQLITE_CONSTRAINT_UNIQUE") ||
          (err as { code: string }).code.startsWith("SQLITE_CONSTRAINT_PRIMARYKEY"))))
  );
}

/**
 * Execute one agent action through the governed pathway. This is the ONLY
 * entry point agents use to mutate domain state.
 *
 * - Opens an `agent`-role session as `agent:<name>` (§9.3) — the mutation
 *   callback runs inside it, so the E2#5 plumbing attributes the audit row
 *   and stamps `data_origin='agent'` with no way for the caller to override.
 * - Checks the idempotency ledger first: a recorded key short-circuits to a
 *   `duplicate` no-op before any mutation runs. The check-then-insert race
 *   is closed by the UNIQUE constraint on `agent_actions.idempotency_key` —
 *   a concurrent replay loses the insert race inside the transaction and the
 *   whole transaction rolls back, leaving exactly one execution.
 * - In dry-run mode, inserts only the flagged ledger row and returns —
 *   the mutation callback never runs.
 * - Otherwise runs the mutation callback and the ledger insert in ONE
 *   SQLite transaction: either the mutation, its audit row, and the ledger
 *   row all land, or none do. (The E2#5 helpers open their own transaction
 *   per call; better-sqlite3 nests those as savepoints inside this one, so
 *   the outer transaction still commits or rolls back as a unit.)
 */
export function runAgentAction<T>(
  db: DatabaseClient,
  agent: AgentName,
  spec: AgentActionSpec,
  mutate: () => T,
): AgentActionResult<T> {
  if (!AGENT_IDS.includes(agent)) {
    throw new Error(`runAgentAction: unknown agent ${JSON.stringify(agent)}`);
  }
  if (!spec.action || !spec.idempotencyKey || !spec.reason) {
    throw new Error(
      "runAgentAction: action, idempotencyKey, and reason are all required — " +
        "an agent action without them is not auditable (architecture.md §9.2, §9.3)",
    );
  }
  const dryRun = spec.dryRun ?? false;
  const base = {
    agent,
    actor: agentActor(agent),
    action: spec.action,
    idempotencyKey: spec.idempotencyKey,
    reason: spec.reason,
    dryRun,
  };

  return withSession({ role: "agent", actor: agent }, () => {
    const existing = db
      .select({ id: agentActions.id })
      .from(agentActions)
      .where(eq(agentActions.idempotencyKey, spec.idempotencyKey))
      .all();
    if (existing.length > 0) {
      return { ...base, agentActionId: existing[0]!.id, outcome: "duplicate", result: null };
    }

    if (dryRun) {
      const rows = db
        .insert(agentActions)
        .values({
          agent,
          action: spec.action,
          idempotencyKey: spec.idempotencyKey,
          reason: spec.reason,
          dryRun: true,
          dataOrigin: "agent",
        })
        .returning({ id: agentActions.id })
        .all();
      return { ...base, agentActionId: rows[0]!.id, outcome: "dry-run", result: null };
    }

    try {
      return db.transaction((tx) => {
        const result = mutate();
        const rows = (tx as unknown as DatabaseClient)
          .insert(agentActions)
          .values({
            agent,
            action: spec.action,
            idempotencyKey: spec.idempotencyKey,
            reason: spec.reason,
            dryRun: false,
            dataOrigin: "agent",
          })
          .returning({ id: agentActions.id })
          .all();
        return { ...base, agentActionId: rows[0]!.id, outcome: "executed", result };
      });
    } catch (err) {
      // Lost the insert race to a concurrent tick with the same key: the
      // transaction rolled back (mutation included), so the replay is a
      // recorded no-op — exactly one execution ever lands.
      if (isUniqueViolation(err)) {
        const winner = db
          .select({ id: agentActions.id })
          .from(agentActions)
          .where(eq(agentActions.idempotencyKey, spec.idempotencyKey))
          .all();
        return {
          ...base,
          agentActionId: winner[0]?.id ?? -1,
          outcome: "duplicate",
          result: null,
        };
      }
      throw err;
    }
  });
}

/** One `agent_actions` ledger row as the activity feed (E5#6) reads it. */
export interface AgentActionRecord {
  id: number;
  agent: AgentName;
  action: string;
  idempotencyKey: string;
  reason: string;
  dryRun: boolean;
  entityTable: string | null;
  entityId: number | null;
  dataOrigin: string;
  createdAt: Date;
}

/**
 * Read the agent action ledger — the agent activity feed (E5#6) renders
 * straight from this. Newest first; optionally filtered by agent or by the
 * dry-run flag.
 */
export function readAgentActions(
  db: DatabaseClient,
  filter: { agent?: AgentName; dryRun?: boolean; limit?: number } = {},
): AgentActionRecord[] {
  const conditions = [];
  if (filter.agent !== undefined) conditions.push(eq(agentActions.agent, filter.agent));
  if (filter.dryRun !== undefined) conditions.push(eq(agentActions.dryRun, filter.dryRun));
  let query = db.select().from(agentActions).orderBy(agentActions.id).$dynamic();
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  const rows = query.all() as (typeof agentActions.$inferSelect)[];
  return rows
    .map((row) => ({
      id: row.id,
      agent: row.agent,
      action: row.action,
      idempotencyKey: row.idempotencyKey,
      reason: row.reason,
      dryRun: row.dryRun,
      entityTable: row.entityTable,
      entityId: row.entityId,
      dataOrigin: row.dataOrigin,
      createdAt: row.createdAt,
    }))
    .reverse()
    .slice(0, filter.limit ?? rows.length);
}
