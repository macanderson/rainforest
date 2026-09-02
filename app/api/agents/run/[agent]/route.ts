/**
 * Agent-tick cron endpoint — docs/architecture.md §9.2/§7.2, issue E5#5
 * "Scheduler wiring". This is the ONLY way an operational agent runs —
 * there is no resident daemon, and the endpoint is:
 *
 *   POST /api/agents/run/<agent>        Host cron's schedule
 *   Authorization: Bearer <AGENT_SECRET>  the bearer secret comes from the
 *                                          env file, never an interactive
 *                                          session (§5).
 *
 * - `<agent>` must be one of the §9.1 operational agents — auto-reorder,
 *   fulfillment, exception — anything else is a 404 before any agent code
 *   runs. Dispatch itself is keyed on `AGENT_TICKS` (lib/agents/tick.ts);
 *   this route never special-cases agents.
 * - Auth is the `AGENT_SECRET` bearer secret (falling back to `CRON_SECRET`,
 *   the shared cron secret). A missing or wrong secret is a 401 and no
 *   agent code runs. If neither env var is configured the endpoint refuses
 *   all requests — fail closed, never open by default. The `agent` role is
 *   API-only per §5: this route uses no interactive session.
 * - Every authorized POST runs the agent's tick through `runAgentTick`,
 *   which flows through the E5#1 agent framework (idempotency, dry-run,
 *   audited writes) and writes one `agent_runs` run-ledger row per tick —
 *   success AND failure — for the job observability page (E6#4). A failing
 *   tick answers 500 after its failure row is written; it never dies
 *   silently.
 *
 * Dry-run is invokable per tick: a JSON body `{ "dryRun": true }` (or the
 * `?dry-run` / `?dryRun` query flag) runs the tick in dry-run mode — the
 * framework records intended actions without mutating state, and the ledger
 * row records outcome `dry_run` with `dry_run: true` (§9.2).
 */

import { timingSafeEqual } from "node:crypto";

import { runAgentTick, type RunAgentTickResult } from "../../../../../lib/agents/tick.ts";
import { AGENT_IDS, type AgentName } from "../../../../../lib/db/agent.ts";
import { createDatabase } from "../../../../../lib/db/client.ts";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ agent: string }>;
}

function agentSecret(): string | undefined {
  // The primary §9.2 agent-tick secret; CRON_SECRET is the fallback when the
  // operator shares one cron secret across endpoints (see demo-wipe).
  return process.env.AGENT_SECRET ?? process.env.CRON_SECRET;
}

function authorized(request: Request): boolean {
  const secret = agentSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Dry-run is invokable per tick via the request body or a query flag. */
async function dryRunRequested(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  if (["dry-run", "dryRun", "dry_run"].some((k) => url.searchParams.has(k))) {
    return true;
  }
  const body = await request.json().catch(() => null);
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { dryRun?: unknown }).dryRun === true
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { agent: requested } = await params;
  const agent = requested as AgentName;
  if (!AGENT_IDS.includes(agent)) {
    return Response.json({ error: "unknown agent" }, { status: 404 });
  }

  const dryRun = await dryRunRequested(request);

  const db = createDatabase();
  try {
    const result: RunAgentTickResult = runAgentTick(db, agent, { dryRun });
    return Response.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    db.$client.close();
  }
}
