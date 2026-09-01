import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createDatabase } from "../lib/db/client.ts";
import { runMigrations } from "../lib/db/migrate.mjs";
import { categories, products, suppliers } from "../lib/db/schema.ts";
import {
  SESSION_ROLES,
  currentSession,
  findRawInserts,
  insertRow,
  originForRole,
  withSession,
} from "../lib/db/session.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-session-"));
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
    insertRow(db, categories, { name: `cat-${crypto.randomUUID()}` });
    insertRow(db, suppliers, {
      code: `SUP-${crypto.randomUUID().slice(0, 8)}`,
      name: `sup-${crypto.randomUUID().slice(0, 8)}`,
      location: "Shenzhen, CN",
      isImport: true,
      activeFromQuarter: "2021-Q1",
      lifetimeOnTimeBps: 7100,
      meanDaysLateHundredths: 850,
    });
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

function lastProduct() {
  return sqlite
    .prepare("SELECT * FROM products ORDER BY id DESC LIMIT 1")
    .get();
}

describe("db/session — demo-session attribution (architecture.md §3, §5)", () => {
  it("defines exactly the three roles of §5", () => {
    assert.deepEqual(SESSION_ROLES, ["admin", "sales-rep", "agent"]);
  });

  it("maps each role to its data_origin stamp", () => {
    assert.equal(originForRole("sales-rep"), "demo");
    assert.equal(originForRole("admin"), "seed");
    assert.equal(originForRole("agent"), "agent");
  });

  it("stamps data_origin='demo' on every row created in a sales-rep session", () => {
    withSession({ role: "sales-rep", actor: "rep@example.com" }, () => {
      insertRow(db, products, productFixture());
    });
    assert.equal(lastProduct().data_origin, "demo");
  });

  it("does NOT stamp 'demo' on rows created by an admin session", () => {
    withSession({ role: "admin", actor: "ops@example.com" }, () => {
      insertRow(db, products, productFixture());
    });
    assert.equal(lastProduct().data_origin, "seed");
  });

  it("stamps data_origin='agent' on rows created by an agent session", () => {
    withSession({ role: "agent", actor: "agent:auto-reorder" }, () => {
      insertRow(db, products, productFixture());
    });
    assert.equal(lastProduct().data_origin, "agent");
  });

  it("ignores a caller-supplied dataOrigin — the session role is the only source of truth", () => {
    withSession({ role: "sales-rep", actor: "rep@example.com" }, () => {
      insertRow(db, products, productFixture({ dataOrigin: "seed" }));
    });
    assert.equal(lastProduct().data_origin, "demo");
  });

  it("populates created_at/updated_at per the shared column convention on stamped rows", () => {
    const before = Date.now();
    withSession({ role: "sales-rep", actor: "rep@example.com" }, () => {
      insertRow(db, products, productFixture());
    });
    const row = lastProduct();
    assert.equal(row.data_origin, "demo");
    assert.ok(
      Math.abs(row.created_at - before) < 5000,
      "created_at populated at insert time",
    );
    assert.ok(
      Math.abs(row.updated_at - before) < 5000,
      "updated_at populated at insert time",
    );
  });

  it("scopes attribution through async continuations (route handlers are async)", async () => {
    await withSession({ role: "sales-rep", actor: "rep@example.com" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      insertRow(db, products, productFixture());
    });
    assert.equal(lastProduct().data_origin, "demo");
  });

  it("keeps concurrent sessions isolated — interleaved writes keep their own stamps", async () => {
    const rep = withSession({ role: "sales-rep", actor: "rep" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      insertRow(db, products, productFixture({ sku: "SKU-rep-interleaved" }));
    });
    const agent = withSession({ role: "agent", actor: "agent:x" }, async () => {
      insertRow(db, products, productFixture({ sku: "SKU-agent-interleaved" }));
    });
    await Promise.all([rep, agent]);
    const bySku = sqlite.prepare("SELECT sku, data_origin FROM products WHERE sku LIKE 'SKU-%-interleaved'").all();
    assert.deepEqual(
      Object.fromEntries(bySku.map((r) => [r.sku, r.data_origin])),
      { "SKU-rep-interleaved": "demo", "SKU-agent-interleaved": "agent" },
    );
  });

  it("rejects an unknown role at scope entry", () => {
    assert.throws(
      () => withSession({ role: "superuser", actor: "x" }, () => {}),
      /unknown role/,
    );
  });

  it("exposes the active session inside the scope and none outside it", () => {
    assert.equal(currentSession(), undefined);
    withSession({ role: "admin", actor: "ops" }, () => {
      assert.equal(currentSession()?.role, "admin");
    });
    assert.equal(currentSession(), undefined);
  });

  it("negative path: a write outside any session scope fails closed", () => {
    assert.throws(
      () => insertRow(db, products, productFixture()),
      /no active session/,
    );
  });

  it("negative path: a raw insert that bypasses the chokepoint is detectable", () => {
    // The scanner is the enforcement: a source file containing a raw
    // `INSERT INTO` / `.insert(` outside the allowlist is a violation.
    mkdirSync(join(dir, "app"), { recursive: true });
    const appFile = join(dir, "app", "route.ts");
    const fixture = join(dir, "raw-write.ts");
    writeFileSync(
      appFile,
      "export async function POST() { db.insert(products).values({}); }\n",
    );
    writeFileSync(fixture, 'sqlite.prepare("INSERT INTO products VALUES (1)")\n');
    const violations = findRawInserts(dir);
    assert.equal(violations.length, 2);
    assert.deepEqual(
      violations.map((v) => v.file).sort(),
      ["app/route.ts", "raw-write.ts"],
    );
  });

  it("no write path in the repo bypasses the chokepoint (raw-insert scan is clean)", () => {
    const violations = findRawInserts();
    assert.deepEqual(
      violations,
      [],
      `raw inserts outside lib/db/session.ts allowlist:\n${violations
        .map((v) => `  ${v.file}:${v.line}  ${v.source}`)
        .join("\n")}`,
    );
  });

  it("demo-stamped rows are excludable from seed-vs-bible aggregation (reconciliation.md §2)", () => {
    // The reconcile engine filters `data_origin = 'seed'`; prove the stamp
    // makes demo rows disappear from that aggregate while seed rows remain.
    withSession({ role: "sales-rep", actor: "rep" }, () => {
      insertRow(db, products, productFixture({ sku: "SKU-reconcile-demo" }));
    });
    withSession({ role: "admin", actor: "ops" }, () => {
      insertRow(db, products, productFixture({ sku: "SKU-reconcile-seed" }));
    });
    const seedOnly = sqlite
      .prepare("SELECT sku FROM products WHERE data_origin = 'seed' AND sku LIKE 'SKU-reconcile-%'")
      .all()
      .map((r) => r.sku);
    assert.deepEqual(seedOnly, ["SKU-reconcile-seed"]);
  });
});
