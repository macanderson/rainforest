import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  AUDIT_ACTIONS,
  actorForSession,
  createRow,
  deleteRow,
  readAuditTrail,
  updateRow,
} from "../lib/db/audit.ts";
import { createDatabase } from "../lib/db/client.ts";
import { runMigrations } from "../lib/db/migrate.mjs";
import { categories, products, suppliers } from "../lib/db/schema.ts";
import { withSession } from "../lib/db/session.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-audit-"));
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
  withSession({ role: "admin", actor: "test" }, () => {
    createRow(db, categories, { name: `cat-${crypto.randomUUID()}` }, {
      reason: "test fixture",
    });
    createRow(
      db,
      suppliers,
      {
        code: `SUP-${crypto.randomUUID().slice(0, 8)}`,
        name: `sup-${crypto.randomUUID().slice(0, 8)}`,
        location: "Shenzhen, CN",
        isImport: true,
        activeFromQuarter: "2021-Q1",
        lifetimeOnTimeBps: 7100,
        meanDaysLateHundredths: 850,
      },
      { reason: "test fixture" },
    );
  });
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

function lastAuditRow() {
  return sqlite.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get();
}

describe("db/audit — audit-trail plumbing (architecture.md §9.3)", () => {
  it("defines the machine-readable action verbs", () => {
    assert.deepEqual(AUDIT_ACTIONS, ["create", "update", "delete"]);
  });

  it("formats actor identity per §9.3: human:<user> or agent:<name>", () => {
    assert.equal(actorForSession({ role: "admin", actor: "ops@example.com" }), "human:ops@example.com");
    assert.equal(actorForSession({ role: "sales-rep", actor: "rep@example.com" }), "human:rep@example.com");
    assert.equal(actorForSession({ role: "agent", actor: "auto-reorder" }), "agent:auto-reorder");
  });

  it("create: writes an audit_log row in the same transaction, before empty, after = inserted row", () => {
    const fixture = productFixture();
    let created;
    withSession({ role: "sales-rep", actor: "rep@example.com" }, () => {
      created = createRow(db, products, fixture, { reason: "customer demo order" });
    });
    const audit = lastAuditRow();
    assert.equal(audit.actor, "human:rep@example.com");
    assert.equal(audit.action, "create");
    assert.equal(audit.entity_table, "products");
    assert.equal(audit.entity_id, created.id);
    assert.equal(audit.before_json, null);
    const after = JSON.parse(audit.after_json);
    assert.equal(after.sku, fixture.sku);
    assert.equal(after.id, created.id);
    assert.equal(audit.reason, "customer demo order");
    assert.equal(audit.data_origin, "demo");
  });

  it("update: captures before and after snapshots of the mutated row", () => {
    const fixture = productFixture();
    let created;
    withSession({ role: "admin", actor: "ops@example.com" }, () => {
      created = createRow(db, products, fixture, { reason: "seed fixture" });
    });
    withSession({ role: "admin", actor: "ops@example.com" }, () => {
      updateRow(db, products, created.id, { listPriceCents: 2499 }, {
        reason: "price correction per catalog.md",
      });
    });
    const audit = lastAuditRow();
    assert.equal(audit.actor, "human:ops@example.com");
    assert.equal(audit.action, "update");
    assert.equal(audit.entity_table, "products");
    assert.equal(audit.entity_id, created.id);
    const before = JSON.parse(audit.before_json);
    const after = JSON.parse(audit.after_json);
    assert.equal(before.listPriceCents, 1999);
    assert.equal(after.listPriceCents, 2499);
    assert.equal(before.sku, after.sku);
    assert.equal(audit.reason, "price correction per catalog.md");
    // The row itself was updated.
    const row = sqlite.prepare("SELECT list_price_cents FROM products WHERE id = ?").get(created.id);
    assert.equal(row.list_price_cents, 2499);
  });

  it("delete: captures the before snapshot; after is empty", () => {
    const fixture = productFixture();
    let created;
    withSession({ role: "admin", actor: "ops@example.com" }, () => {
      created = createRow(db, products, fixture, { reason: "seed fixture" });
    });
    withSession({ role: "admin", actor: "ops@example.com" }, () => {
      deleteRow(db, products, created.id, { reason: "pruned discontinued SKU" });
    });
    const audit = lastAuditRow();
    assert.equal(audit.action, "delete");
    assert.equal(audit.entity_table, "products");
    assert.equal(audit.entity_id, created.id);
    const before = JSON.parse(audit.before_json);
    assert.equal(before.sku, fixture.sku);
    assert.equal(audit.after_json, null);
    assert.equal(audit.reason, "pruned discontinued SKU");
    // The row itself is gone.
    assert.equal(sqlite.prepare("SELECT id FROM products WHERE id = ?").get(created.id), undefined);
  });

  it("agent actor: recorded as agent:<name> and stamps data_origin='agent' on the mutated row", () => {
    const fixture = productFixture();
    let created;
    withSession({ role: "agent", actor: "auto-reorder" }, () => {
      created = createRow(db, products, fixture, {
        reason: "reorder-point breach: days_of_cover=4.2 < policy_min=7",
      });
    });
    const row = sqlite.prepare("SELECT data_origin FROM products WHERE id = ?").get(created.id);
    assert.equal(row.data_origin, "agent");
    const audit = lastAuditRow();
    assert.equal(audit.actor, "agent:auto-reorder");
    assert.equal(audit.data_origin, "agent");
    assert.equal(audit.reason, "reorder-point breach: days_of_cover=4.2 < policy_min=7");
  });

  it("agent update re-stamps data_origin='agent' on the mutated row", () => {
    const fixture = productFixture();
    let created;
    withSession({ role: "admin", actor: "ops" }, () => {
      created = createRow(db, products, fixture, { reason: "seed fixture" });
    });
    withSession({ role: "agent", actor: "exception" }, () => {
      updateRow(db, products, created.id, { name: "Renamed Widget" }, {
        reason: "exception-agent: corrected catalog drift",
      });
    });
    const row = sqlite.prepare("SELECT data_origin, name FROM products WHERE id = ?").get(created.id);
    assert.equal(row.data_origin, "agent");
    assert.equal(row.name, "Renamed Widget");
  });

  it("ignores a caller-supplied dataOrigin — the session role is the only source of truth", () => {
    const fixture = productFixture({ dataOrigin: "seed" });
    let created;
    withSession({ role: "sales-rep", actor: "rep" }, () => {
      created = createRow(db, products, fixture, { reason: "demo" });
    });
    const row = sqlite.prepare("SELECT data_origin FROM products WHERE id = ?").get(created.id);
    assert.equal(row.data_origin, "demo");
  });

  it("a mutation through the helper cannot skip the audit row — same transaction, both or neither", () => {
    const before = auditRows().length;
    // Force the audit insert to fail by violating a NOT NULL via a poisoned
    // reason is not possible (reason is nullable); instead prove atomicity by
    // making the DOMAIN write fail (duplicate SKU) and asserting no audit row
    // was written for the attempt.
    const fixture = productFixture();
    withSession({ role: "admin", actor: "ops" }, () => {
      createRow(db, products, fixture, { reason: "first" });
    });
    const afterFirst = auditRows().length;
    assert.equal(afterFirst, before + 3);
    assert.throws(
      () =>
        withSession({ role: "admin", actor: "ops" }, () => {
          createRow(db, products, fixture, { reason: "duplicate sku" });
        }),
      /UNIQUE constraint failed/,
    );
    assert.equal(auditRows().length, afterFirst, "failed mutation left no audit row behind");
  });

  it("update/delete of a nonexistent row refuse to audit a no-op mutation", () => {
    const before = auditRows().length;
    withSession({ role: "admin", actor: "ops" }, () => {
      assert.throws(
        () => updateRow(db, products, 999999999, { name: "x" }, { reason: "ghost" }),
        /no row id=999999999/,
      );
      assert.throws(
        () => deleteRow(db, products, 999999999, { reason: "ghost" }),
        /no row id=999999999/,
      );
    });
    assert.equal(auditRows().length, before);
  });

  it("negative path: a mutation outside any session scope fails closed", () => {
    const before = auditRows().length;
    const fixture = productFixture(); // fixture setup itself mutates; count after it
    const afterFixture = auditRows().length;
    assert.throws(
      () => createRow(db, products, fixture, { reason: "no session" }),
      /no active session/,
    );
    assert.throws(
      () => updateRow(db, products, 1, { name: "x" }, { reason: "no session" }),
      /no active session/,
    );
    assert.throws(
      () => deleteRow(db, products, 1, { reason: "no session" }),
      /no active session/,
    );
    assert.equal(auditRows().length, afterFixture);
    assert.ok(afterFixture > before);
  });

  it("audit_log is append-only: UPDATE and DELETE are rejected at the database layer", () => {
    withSession({ role: "admin", actor: "ops" }, () => {
      createRow(db, categories, { name: `cat-${crypto.randomUUID()}` }, { reason: "fixture" });
    });
    const audit = lastAuditRow();
    assert.throws(
      () => sqlite.prepare("UPDATE audit_log SET reason = 'tampered' WHERE id = ?").run(audit.id),
      /append-only/,
    );
    assert.throws(
      () => sqlite.prepare("DELETE FROM audit_log WHERE id = ?").run(audit.id),
      /append-only/,
    );
    // The row is untouched.
    const reread = sqlite.prepare("SELECT reason FROM audit_log WHERE id = ?").get(audit.id);
    assert.equal(reread.reason, "fixture");
  });

  it("readAuditTrail renders cleanly for downstream consumers (E5#6 feed, E4#5 queue)", () => {
    const fixture = productFixture();
    let created;
    withSession({ role: "agent", actor: "auto-reorder" }, () => {
      created = createRow(db, products, fixture, { reason: "policy: reorder" });
    });
    withSession({ role: "sales-rep", actor: "rep@example.com" }, () => {
      updateRow(db, products, created.id, { listPriceCents: 2199 }, { reason: "promo pricing" });
    });

    // The agent activity feed reads agent-actor entries, newest first.
    const feed = readAuditTrail(db, { actor: "agent:auto-reorder" });
    assert.ok(feed.length >= 1);
    assert.equal(feed[0].actor, "agent:auto-reorder");
    assert.equal(feed[0].action, "create");
    assert.equal(feed[0].entityTable, "products");
    assert.equal(feed[0].after.sku, fixture.sku);
    assert.equal(feed[0].before, null);
    assert.equal(feed[0].reason, "policy: reorder");
    assert.ok(feed[0].createdAt instanceof Date);

    // The approval queue reads by entity. The fixture's backbone rows
    // (category + supplier) also audited their creates, so filter to the
    // product's own trail.
    const forEntity = readAuditTrail(db, { entityTable: "products", entityId: created.id });
    assert.deepEqual(forEntity.map((e) => e.action), ["update", "create"]); // newest first
    assert.equal(forEntity[0].actor, "human:rep@example.com");
    assert.equal(forEntity[0].before.listPriceCents, 1999);
    assert.equal(forEntity[0].after.listPriceCents, 2199);

    // Action filter + limit.
    const creates = readAuditTrail(db, { action: "create", limit: 1 });
    assert.equal(creates.length, 1);
    assert.equal(creates[0].action, "create");
  });
});
