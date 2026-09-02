/**
 * Unit tests for the agent scheduler wiring (issue E5#5): the cron endpoint
 * app/api/agents/run/[agent], the per-agent dispatch table, dry-run
 * invocation, and the `agent_runs` run ledger — success, failure, and dry-run
 * outcomes.
 */
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { POST } from "../app/api/agents/run/[agent]/route.ts";
import { AGENT_TICKS } from "../lib/agents/tick.ts";
import { runMigrations } from "../lib/db/migrate.mjs";
import { AGENT_NAMES } from "../lib/db/schema.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-agents-scheduler-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);
const sqlite = new Database(dbPath);

const SECRET = "test-agent-secret";

/** Invoke the route handler directly — no server needed. */
function postRequest(agent, { secret = SECRET, body, query } = {}) {
  const url = new URL(
    `http://localhost/api/agents/run/${agent}${query ? `?${query}` : ""}`,
  );
  const headers = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return POST(
    new Request(url, {
      method: "POST",
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    }),
    { params: Promise.resolve({ agent }) },
  );
}

function ledgerRows(agent) {
  return sqlite
    .prepare("SELECT * FROM agent_runs WHERE agent = ? ORDER BY id")
    .all(agent);
}

before(() => {
  process.env.AGENT_SECRET = SECRET;
  process.env.DATABASE_PATH = dbPath;
});
after(() => {
  delete process.env.AGENT_SECRET;
  delete process.env.CRON_SECRET;
  delete process.env.DATABASE_PATH;
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("dispatch table", () => {
  it("has one AGENT_TICKS entry per §9.1 agent name", () => {
    assert.deepEqual(
      Object.keys(AGENT_TICKS).sort(),
      [...AGENT_NAMES].sort(),
    );
  });
});

describe("auth gating", () => {
  it("rejects a missing bearer header with 401 — no agent code runs", async () => {
    const rows = ledgerRows("auto-reorder");
    const res = await postRequest("auto-reorder", { secret: null });
    assert.equal(res.status, 401);
    assert.equal(ledgerRows("auto-reorder").length, rows.length);
  });

  it("rejects a wrong bearer with 401 — no agent code runs", async () => {
    const rows = ledgerRows("auto-reorder");
    const res = await postRequest("auto-reorder", { secret: "nope" });
    assert.equal(res.status, 401);
    assert.equal(ledgerRows("auto-reorder").length, rows.length);
  });

  it("fails closed when the secret env is unset", async () => {
    delete process.env.AGENT_SECRET;
    delete process.env.CRON_SECRET;
    const res = await postRequest("auto-reorder");
    assert.equal(res.status, 401);
    process.env.AGENT_SECRET = SECRET;
  });

  it("404s an unknown agent before any agent code runs", async () => {
    const res = await postRequest("whatever");
    assert.equal(res.status, 404);
  });
});

describe("per-agent dispatch + run ledger", () => {
  for (const agent of AGENT_NAMES) {
    it(`dispatches ${agent} and writes its success ledger row`, async () => {
      const before = ledgerRows(agent).length;
      const res = await postRequest(agent);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.agent, agent);
      assert.ok(body.ok);

      const rows = ledgerRows(agent);
      assert.equal(rows.length, before + 1);
      const row = rows[rows.length - 1];
      assert.equal(row.outcome, "success");
      assert.equal(row.dry_run, 0);
      assert.ok(row.started_at);
      assert.ok(row.finished_at);
      const detail = JSON.parse(row.detail_json);
      assert.equal(detail.agent, agent);
      assert.equal(detail.actionsTaken, 1);
      assert.equal(detail.actions[0].action, "agent.tick");
      assert.equal(row.ledger_id, undefined); // exact columns only
    });
  }

  it("dry-run body flag is recorded as outcome dry_run, no mutation", async () => {
    const res = await postRequest("exception", { body: { dryRun: true } });
    assert.equal(res.status, 200);
    const rows = ledgerRows("exception");
    const row = rows[rows.length - 1];
    assert.equal(row.outcome, "dry_run");
    assert.equal(row.dry_run, 1);
    const detail = JSON.parse(row.detail_json);
    assert.equal(detail.actions[0].dryRun, true);
  });

  it("dry-run query flag is recorded as outcome dry_run", async () => {
    const res = await postRequest("fulfillment", { query: "dry-run" });
    assert.equal(res.status, 200);
    const rows = ledgerRows("fulfillment");
    const row = rows[rows.length - 1];
    assert.equal(row.outcome, "dry_run");
    assert.equal(row.dry_run, 1);
  });
});

describe("failure ledger writes", () => {
  it("a throwing tick is recorded as a failure row and answered 500", async () => {
    AGENT_TICKS["exception"].run = () => {
      throw new Error("boom");
    };
    const res = await postRequest("exception");
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "boom");

    const rows = ledgerRows("exception");
    const row = rows[rows.length - 1];
    assert.equal(row.outcome, "failure");
    const detail = JSON.parse(row.detail_json);
    assert.equal(detail.error, "boom");
  });
});
