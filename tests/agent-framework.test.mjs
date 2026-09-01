import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  AGENT_IDS,
  agentActor,
  readAgentActions,
  runAgentAction,
} from "../lib/db/agent.ts";
import { createRow, readAuditTrail } from "../lib/db/audit.ts";
import { createDatabase } from "../lib/db/client.ts";
import { runMigrations } from "../lib/db/migrate.mjs";
import { products } from "../lib/db/schema.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-agent-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);
const db = createDatabase(dbPath);
const sqlite = new Database(dbPath);

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Seed backbone rows (category + supplier) that product fixtures FK into. */
function seedBackbone() {
  const suffix = crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(
      "INSERT INTO categories (name, data_origin) VALUES (?, 'seed')",
    )
    .run(`cat-${suffix}`);
  sqlite
    .prepare(
      `INSERT INTO suppliers
         (code, name, location, is_import, active_from_quarter,
          lifetime_on_time_bps, mean_days_late_hundredths, data_origin)
       VALUES (?, ?, 'Shenzhen, CN', 1, '2021-Q1', 7100, 850, 'seed')`,
    )
    .run(`SUP-${suffix}`, `sup-${suffix}`);
  const category = sqlite.prepare("SELECT id FROM categories ORDER BY id DESC LIMIT 1").get();
  const supplier = sqlite.prepare("SELECT id FROM suppliers ORDER BY id DESC LIMIT 1").get();
  return { categoryId: category.id, supplierId: supplier.id };
}

function productFixture(overrides = {}) {
  const { categoryId, supplierId } = seedBackbone();
  return {
    sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
    name: "Test Widget",
    categoryId,
    supplierId,
    unitCostCents: 1000,
    listPriceCents: 1999,
    firstSoldQuarter: "2026-Q3",
    ...overrides,
  };
}

function auditRows() {
  return sqlite.prepare("SELECT * FROM audit_log ORDER BY id").all();
}

function ledgerRows() {
  return sqlite.prepare("SELECT * FROM agent_actions ORDER BY id").all();
}

function productRows() {
  return sqlite.prepare("SELECT * FROM products ORDER BY id").all();
}

describe("db/agent — agent action framework (architecture.md §9)", () => {
  it("identity model: agents act as agent:<name>, distinct from human:<user>", () => {
    assert.equal(agentActor("auto-reorder"), "agent:auto-reorder");
    assert.equal(agentActor("fulfillment"), "agent:fulfillment");
    assert.equal(agentActor("exception"), "agent:exception");
    assert.deepEqual([...AGENT_IDS], ["auto-reorder", "fulfillment", "exception"]);
    assert.notEqual(agentActor("auto-reorder"), "human:auto-reorder");
  });

  it("executed action: ledger row + mutation + audit row, all stamped agent", () => {
    const before = { audit: auditRows().length, ledger: ledgerRows().length };
    const fixture = productFixture();

    const outcome = runAgentAction(
      db,
      "auto-reorder",
      {
        action: "product.created",
        idempotencyKey: `test-exec-${crypto.randomUUID()}`,
        reason: "on_hand(12)+inbound(0)<reorder_point(40);eoq=96",
      },
      () => createRow(db, products, fixture, { reason: "on_hand(12)+inbound(0)<reorder_point(40);eoq=96" }),
    );

    assert.equal(outcome.outcome, "executed");
    assert.equal(outcome.agent, "auto-reorder");
    assert.equal(outcome.actor, "agent:auto-reorder");
    assert.ok(outcome.result, "mutation result returned");
    assert.equal(outcome.result.dataOrigin, "agent");

    // Ledger row: identity, idempotency key, reason, dry-run flag.
    const ledger = ledgerRows();
    assert.equal(ledger.length, before.ledger + 1);
    const entry = ledger.at(-1);
    assert.equal(entry.id, outcome.agentActionId);
    assert.equal(entry.agent, "auto-reorder");
    assert.equal(entry.action, "product.created");
    assert.equal(entry.idempotency_key, outcome.idempotencyKey);
    assert.equal(entry.reason, "on_hand(12)+inbound(0)<reorder_point(40);eoq=96");
    assert.equal(entry.dry_run, 0);
    assert.equal(entry.data_origin, "agent");

    // Domain row stamped data_origin='agent' — never 'seed' or 'demo'.
    const created = sqlite
      .prepare("SELECT * FROM products WHERE id = ?")
      .get(outcome.result.id);
    assert.equal(created.data_origin, "agent");

    // Audit row through the E2#5 plumbing: actor, action, before/after, reason.
    const audit = auditRows();
    assert.equal(audit.length, before.audit + 1);
    const trail = audit.at(-1);
    assert.equal(trail.actor, "agent:auto-reorder");
    assert.equal(trail.action, "create");
    assert.equal(trail.entity_table, "products");
    assert.equal(trail.entity_id, outcome.result.id);
    assert.equal(trail.before_json, null);
    assert.equal(JSON.parse(trail.after_json).sku, fixture.sku);
    assert.equal(trail.reason, "on_hand(12)+inbound(0)<reorder_point(40);eoq=96");
    assert.equal(trail.data_origin, "agent");
  });

  it("idempotency: replaying a recorded key is a no-op — no duplicate mutation, no duplicate audit row", () => {
    const key = `test-replay-${crypto.randomUUID()}`;
    const fixture = productFixture();
    const spec = {
      action: "product.created",
      idempotencyKey: key,
      reason: "rop-check;qty=96",
    };
    const mutate = () => createRow(db, products, fixture, { reason: "rop-check;qty=96" });

    const first = runAgentAction(db, "auto-reorder", spec, mutate);
    assert.equal(first.outcome, "executed");

    const counts = {
      products: productRows().length,
      audit: auditRows().length,
      ledger: ledgerRows().length,
    };

    const replay = runAgentAction(db, "auto-reorder", spec, () => {
      throw new Error("mutation callback must not run on replay");
    });

    assert.equal(replay.outcome, "duplicate");
    assert.equal(replay.result, null);
    assert.equal(replay.agentActionId, first.agentActionId);
    assert.equal(productRows().length, counts.products, "no duplicate mutation");
    assert.equal(auditRows().length, counts.audit, "no duplicate audit row");
    assert.equal(ledgerRows().length, counts.ledger, "no duplicate ledger row");
  });

  it("dry-run: records the intended action without mutating any domain state", () => {
    const key = `test-dry-${crypto.randomUUID()}`;
    const counts = {
      products: productRows().length,
      audit: auditRows().length,
      ledger: ledgerRows().length,
    };

    const outcome = runAgentAction(
      db,
      "fulfillment",
      {
        action: "order.allocated",
        idempotencyKey: key,
        reason: "order=SO-0042;stock_available=1",
        dryRun: true,
      },
      () => {
        throw new Error("mutation callback must not run in dry-run mode");
      },
    );

    assert.equal(outcome.outcome, "dry-run");
    assert.equal(outcome.result, null);
    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.actor, "agent:fulfillment");

    // Intended action recorded, flagged dry-run, stamped agent.
    const ledger = ledgerRows();
    assert.equal(ledger.length, counts.ledger + 1);
    const entry = ledger.at(-1);
    assert.equal(entry.id, outcome.agentActionId);
    assert.equal(entry.dry_run, 1);
    assert.equal(entry.agent, "fulfillment");
    assert.equal(entry.data_origin, "agent");

    // No domain state mutated, no audit row.
    assert.equal(productRows().length, counts.products);
    assert.equal(auditRows().length, counts.audit);
  });

  it("dry-run keys are idempotent too: replaying a dry-run key is a no-op", () => {
    const key = `test-dry-replay-${crypto.randomUUID()}`;
    const spec = {
      action: "order.allocated",
      idempotencyKey: key,
      reason: "order=SO-0043",
      dryRun: true,
    };
    const first = runAgentAction(db, "fulfillment", spec, () => {
      throw new Error("must not run");
    });
    const counts = { ledger: ledgerRows().length };
    const replay = runAgentAction(db, "fulfillment", spec, () => {
      throw new Error("must not run");
    });
    assert.equal(first.outcome, "dry-run");
    assert.equal(replay.outcome, "duplicate");
    assert.equal(replay.agentActionId, first.agentActionId);
    assert.equal(ledgerRows().length, counts.ledger);
  });

  it("a dry-run key blocks the later real execution of the same decision", () => {
    // Same decision key, first delivered as a dry run: the real run must not
    // double-act — the key identifies the decision, not the mode.
    const key = `test-dry-then-real-${crypto.randomUUID()}`;
    const spec = {
      action: "product.created",
      idempotencyKey: key,
      reason: "rop-check;qty=48",
    };
    const dry = runAgentAction(db, "auto-reorder", { ...spec, dryRun: true }, () => {
      throw new Error("must not run");
    });
    const real = runAgentAction(db, "auto-reorder", spec, () => {
      throw new Error("must not run");
    });
    assert.equal(dry.outcome, "dry-run");
    assert.equal(real.outcome, "duplicate");
    assert.equal(real.agentActionId, dry.agentActionId);
  });

  it("mutation failure rolls back the ledger row too — the key stays free", () => {
    const key = `test-rollback-${crypto.randomUUID()}`;
    const counts = { ledger: ledgerRows().length, audit: auditRows().length };
    assert.throws(() =>
      runAgentAction(
        db,
        "exception",
        { action: "ticket.annotated", idempotencyKey: key, reason: "sla_breach;days_late=3" },
        () => {
          throw new Error("boom");
        },
      ),
    );
    assert.equal(ledgerRows().length, counts.ledger, "ledger row rolled back");
    assert.equal(auditRows().length, counts.audit);
    // Key is free: the same decision can be retried after the failure.
    const fixture = productFixture();
    const retry = runAgentAction(
      db,
      "exception",
      { action: "product.created", idempotencyKey: key, reason: "sla_breach;days_late=3" },
      () => createRow(db, products, fixture, { reason: "sla_breach;days_late=3" }),
    );
    assert.equal(retry.outcome, "executed");
  });

  it("rejects unknown agents and unauditable specs", () => {
    const fixture = productFixture();
    assert.throws(
      () =>
        runAgentAction(db, "rogue-agent", {
          action: "product.created",
          idempotencyKey: "k",
          reason: "r",
        }, () => createRow(db, products, fixture, { reason: "r" })),
      /unknown agent/,
    );
    for (const spec of [
      { action: "", idempotencyKey: "k", reason: "r" },
      { action: "a", idempotencyKey: "", reason: "r" },
      { action: "a", idempotencyKey: "k", reason: "" },
    ]) {
      assert.throws(
        () => runAgentAction(db, "auto-reorder", spec, () => null),
        /required/,
      );
    }
  });

  it("agent writes cannot override data_origin — the session role is the only source of truth", () => {
    const fixture = productFixture({ dataOrigin: "seed" });
    const outcome = runAgentAction(
      db,
      "auto-reorder",
      {
        action: "product.created",
        idempotencyKey: `test-origin-${crypto.randomUUID()}`,
        reason: "origin-override-attempt",
      },
      () => createRow(db, products, fixture, { reason: "origin-override-attempt" }),
    );
    assert.equal(outcome.outcome, "executed");
    const created = sqlite
      .prepare("SELECT data_origin FROM products WHERE id = ?")
      .get(outcome.result.id);
    assert.equal(created.data_origin, "agent");
  });

  it("readAgentActions reads the ledger back, newest first, with filters", () => {
    const keyA = `test-read-a-${crypto.randomUUID()}`;
    const keyB = `test-read-b-${crypto.randomUUID()}`;
    runAgentAction(db, "auto-reorder", {
      action: "product.created",
      idempotencyKey: keyA,
      reason: "r1",
    }, () => createRow(db, products, productFixture(), { reason: "r1" }));
    runAgentAction(db, "exception", {
      action: "ticket.annotated",
      idempotencyKey: keyB,
      reason: "r2",
      dryRun: true,
    }, () => null);

    const all = readAgentActions(db);
    assert.ok(all.length >= 2);
    assert.ok(all[0].id > all[1].id, "newest first");
    assert.equal(all[0].agent, "exception");
    assert.equal(all[0].dryRun, true);
    assert.equal(all[0].dataOrigin, "agent");

    const reorderOnly = readAgentActions(db, { agent: "auto-reorder" });
    assert.ok(reorderOnly.every((r) => r.agent === "auto-reorder"));

    const dryOnly = readAgentActions(db, { dryRun: true });
    assert.ok(dryOnly.length >= 1);
    assert.ok(dryOnly.every((r) => r.dryRun === true));

    const limited = readAgentActions(db, { limit: 1 });
    assert.equal(limited.length, 1);
  });

  it("audit trail reads attribute agent mutations to agent:<name>", () => {
    const key = `test-trail-${crypto.randomUUID()}`;
    const outcome = runAgentAction(
      db,
      "exception",
      { action: "product.created", idempotencyKey: key, reason: "escalation;cluster=shipping-delay" },
      () => createRow(db, products, productFixture(), { reason: "escalation;cluster=shipping-delay" }),
    );
    const trail = readAuditTrail(db, { entityTable: "products", entityId: outcome.result.id });
    assert.equal(trail.length, 1);
    assert.equal(trail[0].actor, "agent:exception");
    assert.equal(trail[0].dataOrigin, "agent");
  });
});
