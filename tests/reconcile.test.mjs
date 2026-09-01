import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import {
  checkBibleIdentities,
  deriveRevenue,
  loadBible,
  reconcile,
} from "../lib/reconcile.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-reconcile-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);

after(() => rmSync(dir, { recursive: true, force: true }));

const NOW = Date.now();

/** Open a fresh migrated fixture DB (FKs on) with one warehouse to hang orders on. */
function freshDb(name) {
  const path = join(dir, name);
  runMigrations(path);
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite
    .prepare(
      "INSERT INTO warehouses (code, name, city, state, opened_quarter, sqft_k, role, data_origin) " +
        "VALUES ('CMH1', 'Columbus 1', 'Columbus', 'OH', '2017-Q2', 800, 'regional', 'seed')",
    )
    .run();
  return sqlite;
}

/**
 * Seed one quarter's worth of orders/shipments/tickets that reconciles green
 * against the given bible row. Counts are scaled down by `scale` — the ±2%
 * tolerance is relative, so a 1/1000th fixture diffs exactly like the real
 * thing. `origin` lets the exclusion tests plant demo/agent rows.
 */
function plantQuarter(sqlite, row, { origin = "seed", codePrefix } = {}) {
  codePrefix ??= `${origin}-${row.quarter}-`;
  const orders = Math.round(row.orders_k * 1000);
  const totalCents = Math.round(row.gmv_usd_m * 1_000_000 * 100);
  const perOrder = Math.floor(totalCents / orders);
  const lateCount = Math.round((orders * (100 - row.on_time_delivery_pct)) / 100);
  const tickets = Math.round((row.tickets_per_1k_orders * orders) / 1000);
  const insertOrder = sqlite.prepare(
    "INSERT INTO sales_orders (code, customer_ref, warehouse_id, status, service_level, quarter_tag, total_cents, placed_at, promised_at, delivered_at, data_origin) " +
      "VALUES (?, 'CUST-1', 1, 'delivered', 'two_day', ?, ?, ?, ?, ?, ?)",
  );
  const insertShipment = sqlite.prepare(
    "INSERT INTO shipments (code, sales_order_id, warehouse_id, carrier, status, quarter_tag, promised_at, delivered_at, is_late, data_origin) " +
      "VALUES (?, ?, 1, 'seed-carrier', 'delivered', ?, ?, ?, ?, ?)",
  );
  const insertTicket = sqlite.prepare(
    "INSERT INTO support_tickets (code, cluster_tag, channel, status, quarter_tag, opened_at, data_origin) " +
      "VALUES (?, 'shipping-delay', 'email', 'closed', ?, ?, ?)",
  );

  sqlite.transaction(() => {
    for (let i = 0; i < orders; i += 1) {
      const late = i < lateCount;
      const cents = i === orders - 1 ? totalCents - perOrder * (orders - 1) : perOrder;
      const soId = insertOrder.run(
        `${codePrefix}SO-${i}`,
        row.quarter,
        cents,
        NOW,
        NOW,
        NOW + (late ? 1 : -1),
        origin,
      ).lastInsertRowid;
      insertShipment.run(
        `${codePrefix}SHP-${i}`,
        soId,
        row.quarter,
        NOW,
        NOW + (late ? 1 : -1),
        late ? 1 : 0,
        origin,
      );
    }
    for (let i = 0; i < tickets; i += 1) {
      insertTicket.run(`${codePrefix}TCK-${i}`, row.quarter, NOW, origin);
    }
  })();
}

/**
 * A bible scaled to the fixture: every absolute metric divided by `scale`,
 * ratios (AOV, percentages, per-1K rates) unchanged. The fixture DB is
 * planted against this scaled bible, so the ±2% relative diff is exact.
 * Scale 1000 keeps the fixture small enough to plant quickly (a few
 * hundred orders per quarter) while leaving every metric well above
 * rounding noise.
 */
function scaledBible(scale = 1000) {
  return loadBible().map((r) => ({
    ...r,
    gmv_usd_m: r.gmv_usd_m / scale,
    revenue_usd_m: r.revenue_usd_m / scale,
    orders_k: r.orders_k / scale,
  }));
}

describe("reconcile — bible-internal identities (reconciliation.md §1)", () => {
  it("the shipped numbers bible is green", () => {
    const report = reconcile();
    assert.deepEqual(report.findings, []);
    assert.equal(report.ok, true);
    assert.equal(report.dbHalf, "skipped");
  });

  it("catches an I1 (orders × AOV ≈ GMV) violation", () => {
    const bible = loadBible().map((r) => ({ ...r }));
    bible[0].aov_usd *= 2;
    const findings = checkBibleIdentities(bible);
    assert.ok(findings.some((f) => f.check === "I1" && f.quarter === "2021-Q1"));
  });

  it("catches an I2 (1P + 3P take ≈ revenue) violation", () => {
    const bible = loadBible().map((r) => ({ ...r }));
    bible[5].revenue_usd_m *= 1.5;
    const findings = checkBibleIdentities(bible);
    assert.ok(findings.some((f) => f.check === "I2" && f.quarter === bible[5].quarter));
  });

  it("catches a broken story beat (first-party share anchors)", () => {
    const bible = loadBible().map((r) => ({ ...r }));
    const q = bible.find((r) => r.quarter === "2024-Q4");
    q.first_party_share_pct = 50;
    const findings = checkBibleIdentities(bible);
    assert.ok(findings.some((f) => f.check === "story-beat"));
  });

  it("deriveRevenue is the E2#4 shape: 1P gross + 3P take", () => {
    // 100 GMV, 30% 1P, 12% take → 30 + 0.12×70 = 38.4
    assert.ok(Math.abs(deriveRevenue(100, 30, 12) - 38.4) < 1e-9);
  });
});

describe("reconcile — seeded-DB half (reconciliation.md §2)", () => {
  it("is skipped (not failed) on an empty database", () => {
    const sqlite = new Database(dbPath, { readonly: true });
    const report = reconcile(sqlite);
    sqlite.close();
    assert.equal(report.ok, true);
    assert.equal(report.dbHalf, "skipped");
    assert.deepEqual(report.cells, []);
  });

  it("a fixture DB that matches the bible reconciles green, armed", () => {
    const sqlite = freshDb("green.db");
    const bible = scaledBible();
    for (const row of bible) plantQuarter(sqlite, row);
    // The scaled bible breaks the bible-internal identities (I1/I2 tolerance
    // is ±1%), so this test diffs the DB half only — the identities are
    // proven against the shipped bible in the §1 suite above.
    const report = reconcile(sqlite, bible, { skipIdentities: true });
    sqlite.close();
    assert.equal(report.dbHalf, "armed");
    assert.equal(report.cells.length, bible.length * 6);
    assert.ok(
      report.cells.every((c) => c.pass),
      `failing cells: ${JSON.stringify(report.cells.filter((c) => !c.pass))}`,
    );
    assert.deepEqual(report.findings, []);
    assert.equal(report.ok, true);
  });

  it("one metric pushed past ±2% fails with the right diagnostic", () => {
    const sqlite = freshDb("drift.db");
    const bible = scaledBible();
    for (const row of bible) plantQuarter(sqlite, row);
    // Push 2021-Q1 order count +10% (past the ±2% tolerance) with extra orders.
    const row = bible[0];
    const extra = Math.round(row.orders_k * 1000 * 0.1);
    const insertOrder = sqlite.prepare(
      "INSERT INTO sales_orders (code, customer_ref, warehouse_id, status, service_level, quarter_tag, total_cents, placed_at, promised_at, delivered_at, data_origin) " +
        "VALUES (?, 'CUST-1', 1, 'delivered', 'two_day', ?, 0, ?, ?, ?, 'seed')",
    );
    for (let i = 0; i < extra; i += 1) {
      insertOrder.run(`SO-EXTRA-${i}`, row.quarter, NOW, NOW, NOW - 1);
    }
    const report = reconcile(sqlite, bible, { skipIdentities: true });
    sqlite.close();
    assert.equal(report.ok, false);
    const d2 = report.findings.find((f) => f.check === "D2" && f.quarter === "2021-Q1");
    assert.ok(d2, "expected a D2 finding for 2021-Q1");
    assert.match(d2.message, /orders_k/);
    assert.match(d2.message, /tolerance ±2%/);
    const cell = report.cells.find((c) => c.check === "D2" && c.quarter === "2021-Q1");
    assert.equal(cell.pass, false);
    assert.ok(cell.driftPct > 2);
  });

  it("excludes demo and agent rows from the diff", () => {
    const sqlite = freshDb("origins.db");
    const bible = scaledBible();
    for (const row of bible) plantQuarter(sqlite, row);
    // Plant demo and agent rows that would blow every metric past ±2% if counted.
    for (const row of bible) {
      plantQuarter(sqlite, row, { origin: "demo" });
      plantQuarter(sqlite, row, { origin: "agent" });
    }
    const report = reconcile(sqlite, bible, { skipIdentities: true });
    sqlite.close();
    assert.equal(report.ok, true);
    assert.ok(report.cells.every((c) => c.pass));
  });

  it("buckets by quarter tag, never wall-clock date", () => {
    const sqlite = freshDb("clockshift.db");
    const bible = scaledBible();
    for (const row of bible) plantQuarter(sqlite, row);
    // Simulate the E6#2 clock-shift job: move every timestamp +1 day. The
    // quarter tags are untouched, so reconciliation must stay green.
    for (const table of ["sales_orders", "shipments", "support_tickets"]) {
      const cols = {
        sales_orders: ["placed_at", "promised_at", "delivered_at"],
        shipments: ["promised_at", "delivered_at"],
        support_tickets: ["opened_at"],
      }[table];
      for (const col of cols) {
        sqlite.prepare(`UPDATE ${table} SET ${col} = ${col} + 86400000`).run();
      }
    }
    const report = reconcile(sqlite, bible, { skipIdentities: true });
    sqlite.close();
    assert.equal(report.ok, true);
    assert.ok(report.cells.every((c) => c.pass));
  });

  it("flags seed rows tagged with a quarter the bible does not know", () => {
    const sqlite = freshDb("unknown-quarter.db");
    const bible = scaledBible();
    for (const row of bible) plantQuarter(sqlite, row);
    sqlite
      .prepare(
        "INSERT INTO sales_orders (code, customer_ref, warehouse_id, status, service_level, quarter_tag, total_cents, placed_at, promised_at, delivered_at, data_origin) " +
          "VALUES ('SO-FUTURE', 'CUST-1', 1, 'delivered', 'two_day', '2027-Q1', 100, ?, ?, ?, 'seed')",
      )
      .run(NOW, NOW, NOW - 1);
    const report = reconcile(sqlite, bible, { skipIdentities: true });
    sqlite.close();
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((f) => f.check === "D0" && f.quarter === "2027-Q1"));
  });
});
