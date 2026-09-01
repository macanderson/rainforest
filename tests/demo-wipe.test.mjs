import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import { runDemoWipe, WIPE_ORDER } from "../lib/db/demo-wipe.ts";
import { loadBible } from "../lib/reconcile.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-demo-wipe-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);
const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;

// The demo-wipe job runs reconcile() as a postcondition, and the armed DB
// half diffs seed rows against the bible within ±2% (reconciliation.md §2).
// The seed fixture below must therefore be bible-true: it carries a synthetic
// bible whose 2025-Q3 row matches the fixture exactly (1 order, $50 GMV, 1
// on-time shipment, 1 ticket — revenue = 0.64×50 + 0.15×0.36×50 = $34.70).
const FIXTURE_BIBLE = loadBible().map((r) =>
  r.quarter === "2025-Q3"
    ? {
        ...r,
        gmv_usd_m: 0.00005,
        revenue_usd_m: 0.0000347,
        orders_k: 0.001,
        aov_usd: 50,
        first_party_share_pct: 64.0,
        marketplace_take_rate_pct: 15.0,
        on_time_delivery_pct: 100,
        tickets_per_1k_orders: 1000,
      }
    : r,
);
// The synthetic row breaks bible-internal identities (I1/I2 tolerance is ±1%)
// and the story beats, so the postcondition diff must skip them — this is a
// fixture bible, not editorial truth.
const wipeOpts = { bible: FIXTURE_BIBLE, skipIdentities: true };

const count = (table, origin) =>
  sqlite
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE data_origin = ?`)
    .get(origin).n;

const insert = (table, row) => {
  const cols = Object.keys(row);
  return sqlite
    .prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    )
    .run(...cols.map((c) => row[c])).lastInsertRowid;
};

/** A minimal seed graph: supplier → PO → line, order → line/shipment/ticket. */
function plantSeedGraph() {
  const supplierId = insert("suppliers", {
    code: "SUP-SEED-1",
    name: "Seed Supplier",
    location: "Columbus, US",
    is_import: 0,
    active_from_quarter: "2021-Q1",
    lifetime_on_time_bps: 9500,
    mean_days_late_hundredths: 200,
    data_origin: "seed",
  });
  const warehouseId = insert("warehouses", {
    code: "CMH1",
    name: "Seed Warehouse",
    city: "Columbus",
    state: "OH",
    opened_quarter: "2017-Q2",
    sqft_k: 500,
    role: "regional",
    data_origin: "seed",
  });
  const categoryId = insert("categories", {
    name: "Seed Category",
    tariff_exposed: 0,
    data_origin: "seed",
  });
  const productId = insert("products", {
    sku: "SKU-SEED-1",
    name: "Seed Product",
    category_id: categoryId,
    supplier_id: supplierId,
    is_private_label: 0,
    unit_cost_cents: 1000,
    list_price_cents: 2500,
    first_sold_quarter: "2021-Q1",
    data_origin: "seed",
  });
  const poId = insert("purchase_orders", {
    code: "PO-SEED-1",
    supplier_id: supplierId,
    warehouse_id: warehouseId,
    status: "received",
    quarter_tag: "2025-Q3",
    ordered_at: NOW,
    promised_at: NOW,
    received_at: NOW,
    total_landed_cents: 10000,
    data_origin: "seed",
  });
  insert("purchase_order_lines", {
    purchase_order_id: poId,
    product_id: productId,
    quantity: 10,
    unit_cost_cents: 1000,
    data_origin: "seed",
  });
  const soId = insert("sales_orders", {
    code: "SO-SEED-1",
    customer_ref: "CUST-SEED-1",
    warehouse_id: warehouseId,
    status: "delivered",
    service_level: "two_day",
    quarter_tag: "2025-Q3",
    total_cents: 5000,
    placed_at: NOW,
    promised_at: NOW,
    delivered_at: NOW,
    data_origin: "seed",
  });
  insert("sales_order_lines", {
    sales_order_id: soId,
    product_id: productId,
    quantity: 2,
    unit_price_cents: 2500,
    data_origin: "seed",
  });
  const shipmentId = insert("shipments", {
    code: "SHP-SEED-1",
    sales_order_id: soId,
    warehouse_id: warehouseId,
    carrier: "seed-carrier",
    status: "delivered",
    quarter_tag: "2025-Q3",
    promised_at: NOW,
    delivered_at: NOW,
    is_late: 0,
    data_origin: "seed",
  });
  insert("support_tickets", {
    code: "TCK-SEED-1",
    cluster_tag: "shipping-delay",
    sales_order_id: soId,
    product_id: productId,
    channel: "email",
    status: "closed",
    quarter_tag: "2025-Q3",
    opened_at: NOW,
    data_origin: "seed",
  });
  return { supplierId, warehouseId, categoryId, productId, poId, soId, shipmentId };
}

/** A demo graph mirroring the seed graph, plus demo rows on leaf tables. */
function plantDemoGraph({ warehouseId, categoryId, productId, soId }, tag = 1) {
  const supplierId = insert("suppliers", {
    code: `SUP-DEMO-${tag}`,
    name: `Demo Supplier ${tag}`,
    location: "Shenzhen, CN",
    is_import: 1,
    active_from_quarter: "2026-Q1",
    lifetime_on_time_bps: 7100,
    mean_days_late_hundredths: 850,
    data_origin: "demo",
  });
  const demoWarehouseId = insert("warehouses", {
    code: `DEM${tag}`,
    name: "Demo Warehouse",
    city: "Reno",
    state: "NV",
    opened_quarter: "2026-Q1",
    sqft_k: 100,
    role: "pop-up",
    data_origin: "demo",
  });
  const demoProductId = insert("products", {
    sku: `SKU-DEMO-${tag}`,
    name: "Demo Product",
    category_id: categoryId,
    supplier_id: supplierId,
    is_private_label: 0,
    unit_cost_cents: 2000,
    list_price_cents: 4000,
    first_sold_quarter: "2026-Q1",
    data_origin: "demo",
  });
  const poId = insert("purchase_orders", {
    code: `PO-DEMO-${tag}`,
    supplier_id: supplierId,
    warehouse_id: demoWarehouseId,
    status: "pending_approval",
    quarter_tag: "2026-Q3",
    ordered_at: NOW,
    promised_at: NOW,
    total_landed_cents: 10000,
    data_origin: "demo",
  });
  insert("purchase_order_lines", {
    purchase_order_id: poId,
    product_id: demoProductId,
    quantity: 5,
    unit_cost_cents: 2000,
    data_origin: "demo",
  });
  const demoSoId = insert("sales_orders", {
    code: `SO-DEMO-${tag}`,
    customer_ref: "CUST-DEMO-1",
    warehouse_id: warehouseId,
    status: "placed",
    service_level: "next_morning",
    quarter_tag: "2026-Q3",
    total_cents: 9000,
    placed_at: NOW,
    promised_at: NOW,
    data_origin: "demo",
  });
  insert("sales_order_lines", {
    sales_order_id: demoSoId,
    product_id: productId,
    quantity: 3,
    unit_price_cents: 3000,
    data_origin: "demo",
  });
  insert("shipments", {
    code: `SHP-DEMO-${tag}`,
    sales_order_id: demoSoId,
    warehouse_id: warehouseId,
    carrier: "demo-carrier",
    status: "pending",
    quarter_tag: "2026-Q3",
    promised_at: NOW,
    is_late: 0,
    data_origin: "demo",
  });
  insert("support_tickets", {
    code: `TCK-DEMO-${tag}`,
    cluster_tag: "product-quality",
    sales_order_id: soId,
    product_id: productId,
    channel: "chat",
    status: "open",
    quarter_tag: "2026-Q3",
    opened_at: NOW,
    data_origin: "demo",
  });
  insert("stock_levels", {
    product_id: demoProductId,
    warehouse_id: demoWarehouseId,
    snapshot_at: NOW,
    quarter_tag: "2026-Q3",
    on_hand: 42,
    reserved: 0,
    inbound: 0,
    reorder_point: 10,
    days_of_cover: 12.5,
    data_origin: "demo",
  });
  insert("agent_actions", {
    agent: "fulfillment",
    idempotency_key: `demo-tick-${tag}`,
    action: "sales_order.advanced",
    reason: "demo",
    dry_run: 0,
    data_origin: "demo",
  });
  insert("audit_log", {
    actor: "human:sales-rep",
    action: "sales_order.created",
    entity_table: "sales_orders",
    entity_id: demoSoId,
    data_origin: "demo",
  });
}

let seed;

before(() => {
  seed = plantSeedGraph();
});

describe("demo-wipe job (E6#3, architecture §8)", () => {
  it("first run snapshots seed rows and wipes demo rows cascade-safely", () => {
    plantDemoGraph(seed, 1);
    const seedCountsBefore = Object.fromEntries(
      WIPE_ORDER.map((t) => [t, count(t, "seed")]),
    );

    const result = runDemoWipe(sqlite, wipeOpts);

    assert.equal(result.ok, true, result.error);
    assert.equal(result.reconcile.ok, true);
    // Every demo row is gone, across every table.
    for (const table of WIPE_ORDER) {
      assert.equal(count(table, "demo"), 0, `${table} has no demo rows`);
    }
    assert.ok(result.rowsWiped.sales_orders >= 1);
    assert.ok(result.rowsWiped.sales_order_lines >= 1);
    assert.ok(result.rowsWiped.suppliers >= 1);
    assert.ok(result.rowsWiped.audit_log >= 1);
    // No FK violations: the database still passes an integrity check.
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
    // Seed rows untouched.
    for (const table of WIPE_ORDER) {
      assert.equal(
        count(table, "seed"),
        seedCountsBefore[table],
        `${table} seed rows preserved`,
      );
    }
  });

  it("never deletes seed or agent rows", () => {
    insert("agent_actions", {
      agent: "auto-reorder",
      idempotency_key: "agent-tick-1",
      action: "purchase_order.created",
      reason: "below reorder point",
      dry_run: 0,
      data_origin: "agent",
    });
    insert("audit_log", {
      actor: "agent:auto-reorder",
      action: "purchase_order.created",
      entity_table: "purchase_orders",
      entity_id: seed.poId,
      data_origin: "agent",
    });
    plantDemoGraph(seed, 2);

    const result = runDemoWipe(sqlite, wipeOpts);

    assert.equal(result.ok, true, result.error);
    assert.equal(count("agent_actions", "agent"), 1);
    assert.equal(count("audit_log", "agent"), 1);
    assert.ok(count("suppliers", "seed") >= 1);
    assert.ok(count("sales_orders", "seed") >= 1);
  });

  it("restores seed rows mutated during a demo session (snapshot-diff)", () => {
    // Mutate seed rows as a demo session would.
    sqlite
      .prepare("UPDATE products SET unit_cost_cents = 9999 WHERE id = ?")
      .run(seed.productId);
    sqlite
      .prepare("UPDATE sales_orders SET status = 'cancelled' WHERE id = ?")
      .run(seed.soId);
    // And delete one outright.
    sqlite.prepare("DELETE FROM shipments WHERE id = ?").run(seed.shipmentId);
    assert.equal(count("shipments", "seed"), 0);

    const result = runDemoWipe(sqlite, wipeOpts);

    assert.equal(result.ok, true, result.error);
    assert.equal(
      sqlite
        .prepare("SELECT unit_cost_cents FROM products WHERE id = ?")
        .get(seed.productId).unit_cost_cents,
      1000,
      "mutated product restored",
    );
    assert.equal(
      sqlite
        .prepare("SELECT status FROM sales_orders WHERE id = ?")
        .get(seed.soId).status,
      "delivered",
      "mutated order restored",
    );
    assert.equal(count("shipments", "seed"), 1, "deleted seed shipment re-inserted");
    assert.ok(result.rowsRestored.products >= 1);
    assert.ok(result.rowsRestored.sales_orders >= 1);
    assert.ok(result.rowsRestored.shipments >= 1);
    // Restored rows keep their seed origin.
    assert.equal(count("products", "demo"), 0);
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
  });

  it("a wipe with zero demo rows is a clean no-op", () => {
    const before_ = Object.fromEntries(
      WIPE_ORDER.map((t) => [t, count(t, "seed")]),
    );
    const result = runDemoWipe(sqlite, wipeOpts);

    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.rowsWiped, {});
    assert.deepEqual(result.rowsRestored, {});
    for (const table of WIPE_ORDER) {
      assert.equal(count(table, "seed"), before_[table]);
    }
  });

  it("records every run in the job_runs ledger for the observability page", () => {
    const runs = sqlite
      .prepare("SELECT * FROM job_runs WHERE job = 'demo-wipe' ORDER BY id")
      .all();
    assert.ok(runs.length >= 4, "one ledger row per run");
    for (const run of runs) {
      assert.equal(run.status, "success");
      assert.equal(run.data_origin, "agent");
      assert.ok(run.finished_at >= run.started_at);
      const detail = JSON.parse(run.detail_json);
      assert.ok(typeof detail.totalWiped === "number");
      assert.ok(typeof detail.totalRestored === "number");
      assert.ok(typeof detail.durationMs === "number");
      assert.equal(detail.reconcile.ok, true);
    }
  });
});
