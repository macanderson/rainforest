/**
 * Demo-wipe cron endpoint — architecture.md §7.2/§8, issue E6#3.
 *
 * Host cron hits this at 08:00 UTC:
 *
 *   POST /api/jobs/demo-wipe
 *   Authorization: Bearer <CRON_SECRET>
 *
 * The bearer secret comes from the `CRON_SECRET` env var (falling back to
 * `AGENT_SECRET`, the §9.2 agent-tick secret). If neither is configured the
 * endpoint refuses all requests — fail closed, never open by default.
 */
import { timingSafeEqual } from "node:crypto";

import { createDatabase } from "@/lib/db/client.ts";
import { runDemoWipe } from "@/lib/db/demo-wipe.ts";

export const dynamic = "force-dynamic";

function cronSecret(): string | undefined {
  return process.env.CRON_SECRET ?? process.env.AGENT_SECRET;
}

function authorized(request: Request): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createDatabase();
  try {
    const result = runDemoWipe(db.$client);
    return Response.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    db.$client.close();
  }
}
