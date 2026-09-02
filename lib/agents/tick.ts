/**
 * Agent tick runner — the scheduler-side dispatch that runs one operational
 * agent per cron tick and writes the run ledger (docs/architecture.md §9.1,
 * §9.2, issue E5#5 "Scheduler wiring").
 *
 * The agent policies (reorder points, allocation rules, SLA thresholds) are
 * E5#2–#4 and do not exist yet. What exists is the governed pathway every
 * real action flows through (`lib/db/agent.ts`, E5#1): identity attribution,
 * idempotency keys, dry-run mode, audited writes. This module is the wiring
 * between the cron endpoint and that framework — a per-agent tick entry
 * (`AGENT_TICKS`) plus `runAgentTick`, which classifies the outcome and
 * writes one `agent_runs` row per invocation, success AND failure.
 *
 * Dispatch is keyed on `AGENT_TICKS` — there is no endpoint-side agent
 * switch, and an unknown agent fails fast before any agent code runs. Until
 * the policies land, a tick runs one governed no-op through
 * `runAgentAction`: idempotent (a re-delivered tick at the same millisecond
 * is a recorded duplicate, never a double ledger row) and dry-run aware.
 * E5#2–#4 fill each entry's body with real policy without changing the
 * dispatch shape.
 */

import type Database from "better-sqlite3";

import {
  runAgentAction,
  type AgentActionResult,
  type AgentName,
} from "../db/agent.ts";
import type { DatabaseClient } from "../db/client.ts";

/**
 * One tick entry per operational agent (architecture.md §9.1). The tick
 * body is the policy hook E5#2–#4 fills in: today every agent runs the same
 * governed tick no-op and returns its action record; a real policy
 * evaluates its domain and performs each decision with additional
 * `runAgentAction` calls under the same tick.
 */
export const AGENT_TICKS: Record<
  AgentName,
  { describe: string; run: (ctx: TickContext) => AgentActionResult<unknown>[] }
> = {
  "auto-reorder": {
    describe:
      "reorder when on_hand + inbound < reorder_point; EOQ-lite quantity, " +
      "SLA-weighted supplier choice, POs to the approval queue",
    run: governedTickNoop,
  },
  fulfillment: {
    describe:
      "advance open orders through allocate→pick→ship against available " +
      "stock; release backorders when stock arrives",
    run: governedTickNoop,
  },
  exception: {
    describe:
      "flag shipments past SLA, draft supplier escalation notes, open " +
      "linked support-ticket annotations",
    run: governedTickNoop,
  },
};

interface TickContext {
  db: DatabaseClient;
  agent: AgentName;
  dryRun: boolean;
  startedAt: number;
  describe: string;
}

/**
 * The governed tick no-op every agent runs until its policy lands: one
 * `runAgentAction` call with a per-tick idempotency key. A re-delivered
 * cron tick carrying the same start stamp is a recorded duplicate — the
 * mutation callback never runs — so a tick can never double-write its
 * ledger row (§9.2 idempotency keys).
 */
function governedTickNoop(ctx: TickContext): AgentActionResult<unknown>[] {
  const result = runAgentAction(
    ctx.db,
    ctx.agent,
    {
      action: "agent.tick",
      idempotencyKey: `tick:${ctx.agent}:${ctx.startedAt}`,
      reason: ctx.dryRun
        ? `dry-run tick — ${ctx.describe}`
        : ctx.describe,
      dryRun: ctx.dryRun,
    },
    () => null,
  );
  return [result];
}

export interface RunAgentTickResult {
  agent: AgentName;
  /** Run-ledger row id in `agent_runs` — written on success AND failure. */
  ledgerId: number;
  ok: boolean;
  dryRun: boolean;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** The tick's governed action records (one per tick until E5#2–#4). */
  actions: AgentActionResult<unknown>[];
  error: string | null;
}

/**
 * Run one agent tick and write the run ledger — never dies silently
 * (architecture.md §9.2). `agent_runs` gets a row with outcome
 * `success | failure | dry_run` on every invocation through this function.
 * The ledger insert uses the raw SQLite handle outside the tick body, so a
 * policy throw still leaves its failure row.
 */
export function runAgentTick(
  db: DatabaseClient,
  agent: AgentName,
  opts: { dryRun?: boolean } = {},
): RunAgentTickResult {
  const tick = AGENT_TICKS[agent];
  if (!tick) {
    throw new Error(`runAgentTick: no tick entry for agent ${agent}`);
  }
  const dryRun = opts.dryRun === true;
  const startedAt = Date.now();

  let actions: AgentActionResult<unknown>[] = [];
  let error: string | null = null;
  try {
    actions = tick.run({ db, agent, dryRun, startedAt, describe: tick.describe });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const finishedAt = Date.now();
  const ok = error === null;
  const outcome = dryRun ? "dry_run" : ok ? "success" : "failure";
  const detail = {
    agent,
    dryRun,
    actionsTaken: actions.length,
    actions: actions.map((a) => ({
      action: a.action,
      idempotencyKey: a.idempotencyKey,
      reason: a.reason,
      outcome: a.outcome,
      dryRun: a.dryRun,
    })),
    durationMs: finishedAt - startedAt,
    ...(error ? { error } : {}),
  };
    // The framework (lib/db/agent.ts) applies every mutation; this ledger
    // insert goes through its raw-handle preparer so the raw-insert scanner
    // allowlist entry can name this one observed chokepoint.
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const ledgerId = sqlite
    .prepare(
      "INSERT INTO agent_runs (agent, outcome, dry_run, started_at, finished_at, detail_json, data_origin) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'agent')",
    )
    .run(agent, outcome, dryRun ? 1 : 0, startedAt, finishedAt, JSON.stringify(detail))
    .lastInsertRowid as number;

  return {
    agent,
    ledgerId,
    ok,
    dryRun,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    actions,
    error,
  };
}
