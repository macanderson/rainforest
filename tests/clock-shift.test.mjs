import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { DAY_MS, ledgerDate, runClockShift } from "../lib/db/clock-shift.ts";
import { runMigrations } from "../lib/db/migrate.mjs";
import { loadBible } from "../lib/reconcile.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-clock-shift-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);
const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;

// The clock-shift job runs reconcile() as a postcondition, and the armed DB
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
const shiftOpts = { bible: FIXTURE_BIBLE, skipIdentities: true };

const insert = (table, row) => {
  const cols = Object.keys(row);
  return sqlite
    .prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    )
    .run(...cols.map((c) => row[c])).lastInsertRowid;
};

/** Minimal catalog (supplier → warehouse → category → product) at one origin. */
function plantCatalog(origin, suffix) {
  const supplierId = insert("suppliers", {
    code: `SUP-${suffix}`,
    name: `${suffix} Supplier`,
    location: "Columbus, US",
    is_import: 0,
    active_from_quarter: "2021-Q1",
    lifetime_on_time_bps: 9500,
    mean_days_late_hundredths: 200,
    data_origin: origin,
  });
  const warehouseId = insert("warehouses", {
    code: `W-${suffix}`,
    name: `${suffix} Warehouse`,
    city: "Columbus",
    state: "OH",
    opened_quarter: "2017-Q2",
    sqft_k: 500,
    role: "regional",
    data_origin: origin,
  });
  const categoryId = insert("categories", {
    name: `${suffix} Category`,
    tariff_exposed: 0,
    data_origin: origin,
  });
  const productId = insert("products", {
    sku: `SKU-${suffix}`,
    name: `${suffix} Product`,
    category_id: categoryId,
    supplier_id: supplierId,
    is_private_label: 0,
    unit_cost_cents: 1000,
    list_price_cents: 2500,
    first_sold_quarter: "2021-Q1",
    data_origin: origin,
  });
  return { supplierId, warehouseId, categoryId, productId };
}

const getOrder = (code) =>
  sqlite
    .prepare(
      "SELECT placed_at, promised_at, delivered_at, quarter_tag, data_origin " +
        "FROM sales_orders WHERE code = ?",
    )
    .get(code);

before(() => {
  // Seed-origin graph with lifecycle timestamps.
  const seed = plantCatalog("seed", "SEED-SHIFT");
  const seedOrderId = insert("sales_orders", {
    code: "SO-SEED-SHIFT",
    customer_ref: "CUST-SEED-SHIFT",
    warehouse_id: seed.warehouseId,
    status: "delivered",
    service_level: "two_day",
    quarter_tag: "2025-Q3",
    total_cents: 5000,
    placed_at: NOW,
    promised_at: NOW,
    delivered_at: NOW,
    data_origin: "seed",
  });
  insert("shipments", {
    code: "SHP-SEED-SHIFT",
    sales_order_id: seedOrderId,
    warehouse_id: seed.warehouseId,
    carrier: "seed-carrier",
    status: "delivered",
    quarter_tag: "2025-Q3",
    promised_at: NOW,
    delivered_at: NOW,
    is_late: 0,
    data_origin: "seed",
  });
  insert("support_tickets", {
    code: "TCK-SEED-SHIFT",
    sales_order_id: seedOrderId,
    product_id: seed.productId,
    cluster_tag: "shipping-delay",
    channel: "email",
    status: "open",
    quarter_tag: "2025-Q3",
    opened_at: NOW,
    data_origin: "seed",
  });
  insert("stock_levels", {
    product_id: seed.productId,
    warehouse_id: seed.warehouseId,
    snapshot_at: NOW,
    quarter_tag: "2025-Q3",
    on_hand: 10,
    reserved: 1,
    inbound: 0,
    reorder_point: 5,
    days_of_cover: 12.5,
    data_origin: "seed",
  });

  // Demo-origin order — must be untouched by the shift.
  const demo = plantCatalog("demo", "DEMO-SHIFT");
  insert("sales_orders", {
    code: "SO-DEMO-SHIFT",
    customer_ref: "CUST-DEMO-SHIFT",
    warehouse_id: demo.warehouseId,
    status: "placed",
    service_level: "two_day",
    quarter_tag: "2026-Q3",
    total_cents: 2500,
    placed_at: NOW,
    promised_at: NOW,
    data_origin: "demo",
  });

  // Agent-origin action — must be untouched.
  insert("agent_actions", {
    agent: "auto-reorder",
    action: "reorder",
    idempotency_key: "shift-test-1",
    reason: "fixture",
    dry_run: 0,
    data_origin: "agent",
  });
});

describe("clock-shift — the 04:00 UTC living-demo job (architecture §8)", () => {
  it("happy path: shifts every seed timestamp forward exactly +1 day", () => {
    const before = getOrder("SO-SEED-SHIFT");
    const result = runClockShift(sqlite, NOW, shiftOpts);

    assert.equal(result.ok, true);
    assert.equal(result.outcome, "success");
    assert.equal(result.date, ledgerDate(NOW));
    assert.ok(result.rowsShifted > 0);
    assert.ok(result.durationMs >= 0);
    assert.deepEqual(result.reconcile, { ok: true, findings: 0 });

    const afterShift = getOrder("SO-SEED-SHIFT");
    assert.equal(afterShift.placed_at, before.placed_at + DAY_MS);
    assert.equal(afterShift.promised_at, before.promised_at + DAY_MS);
    assert.equal(afterShift.delivered_at, before.delivered_at + DAY_MS);

    const shipment = sqlite
      .prepare("SELECT delivered_at FROM shipments WHERE code = 'SHP-SEED-SHIFT'")
      .get();
    assert.equal(shipment.delivered_at, NOW + DAY_MS);

    const ticket = sqlite
      .prepare("SELECT opened_at FROM support_tickets WHERE code = 'TCK-SEED-SHIFT'")
      .get();
    assert.equal(ticket.opened_at, NOW + DAY_MS);

    const stock = sqlite
      .prepare(
        "SELECT snapshot_at FROM stock_levels WHERE product_id = " +
          "(SELECT id FROM products WHERE sku = 'SKU-SEED-SHIFT')",
      )
      .get();
    assert.equal(stock.snapshot_at, NOW + DAY_MS);
  });

  it("leaves quarter tags unchanged — reconciliation buckets by tag, not timestamp", () => {
    const row = getOrder("SO-SEED-SHIFT");
    assert.equal(row.quarter_tag, "2025-Q3");
  });

  it("touches only data_origin='seed' rows — demo and agent rows are untouched", () => {
    const demo = getOrder("SO-DEMO-SHIFT");
    assert.equal(demo.placed_at, NOW);
    assert.equal(demo.promised_at, NOW);

    // Agent rows carry no shiftable timestamps at all (architecture §9.2:
    // created_at/updated_at are bookkeeping, never shifted). The row itself
    // surviving untouched is the assertion.
    const action = sqlite
      .prepare("SELECT created_at FROM agent_actions WHERE idempotency_key = 'shift-test-1'")
      .get();
    assert.ok(action.created_at < NOW);
  });

  it("idempotency ledger: one row per date, recording the run outcome", () => {
    const rows = sqlite
      .prepare("SELECT * FROM job_run_ledger WHERE job = 'clock-shift'")
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ledger_date, ledgerDate(NOW));
    assert.equal(rows[0].outcome, "success");
    assert.ok(rows[0].rows_affected > 0);
    assert.ok(rows[0].duration_ms >= 0);
  });

  it("double run for the same day is refused — recorded no-op, nothing shifted twice", () => {
    const beforeSecond = getOrder("SO-SEED-SHIFT");
    const result = runClockShift(sqlite, NOW + 3_600_000, shiftOpts); // same UTC date, an hour later

    assert.equal(result.ok, true);
    assert.equal(result.outcome, "no-op");
    assert.equal(result.rowsShifted, 0);

    const afterSecond = getOrder("SO-SEED-SHIFT");
    assert.equal(afterSecond.placed_at, beforeSecond.placed_at);

    const rows = sqlite
      .prepare("SELECT * FROM job_run_ledger WHERE job = 'clock-shift'")
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "no-op");
  });

  it("a run the next UTC day shifts again (ledger is per-date, not once-ever)", () => {
    const nextDay = NOW + DAY_MS + 3_600_000;
    const beforeNext = getOrder("SO-SEED-SHIFT");
    const result = runClockShift(sqlite, nextDay, shiftOpts);

    assert.equal(result.ok, true);
    assert.equal(result.outcome, "success");
    assert.equal(result.date, ledgerDate(nextDay));
    assert.notEqual(result.date, ledgerDate(NOW));

    const afterNext = getOrder("SO-SEED-SHIFT");
    assert.equal(afterNext.placed_at, beforeNext.placed_at + DAY_MS);

    const rows = sqlite
      .prepare("SELECT * FROM job_run_ledger WHERE job = 'clock-shift' ORDER BY ledger_date")
      .all();
    assert.equal(rows.length, 2);
  });

  it("single transaction: a mid-run failure leaves the database unchanged", () => {
    // Break a shift target (drop the column) so the UPDATE fails mid-run,
    // then prove nothing moved and no ledger row was written.
    sqlite.exec("ALTER TABLE support_tickets RENAME COLUMN opened_at TO opened_at_broken");
    try {
      const beforeFail = getOrder("SO-SEED-SHIFT");
      const result = runClockShift(sqlite, NOW + 2 * DAY_MS + 3_600_000, shiftOpts);

      assert.equal(result.ok, false);
      assert.equal(result.outcome, "failure");
      assert.match(result.error, /opened_at/);

      const afterFail = getOrder("SO-SEED-SHIFT");
      assert.equal(afterFail.placed_at, beforeFail.placed_at);

      const ledgerCount = sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM job_run_ledger WHERE job = 'clock-shift' AND ledger_date = ?",
        )
        .get(ledgerDate(NOW + 2 * DAY_MS + 3_600_000));
      assert.equal(ledgerCount.n, 0);
    } finally {
      sqlite.exec("ALTER TABLE support_tickets RENAME COLUMN opened_at_broken TO opened_at");
    }
  });
});
