/**
 * Cron endpoint for the daily +1-day clock-shift job (architecture.md §7.2,
 * §8 — 04:00 UTC slot). Authenticated with the agent bearer secret: the
 * host's cron triggers it with `Authorization: Bearer $CRON_SECRET`
 * (falling back to `$AGENT_SECRET`). Never an interactive session.
 */
import { timingSafeEqual } from "node:crypto";

import { runClockShift } from "@/lib/db/clock-shift";
import { createDatabase } from "@/lib/db/client";

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
    const result = runClockShift(db.$client);
    return Response.json(result, { status: result.ok ? 200 : 500 });
  } finally {
    db.$client.close();
  }
}
