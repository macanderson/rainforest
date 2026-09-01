import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import { loadBible } from "../lib/reconcile.ts";
import { builtinGenerators } from "../lib/seed/generators.ts";
import { runSeed } from "../lib/seed/orchestrator.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-catalog-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function seededDb(name, seed = 7) {
  const dbPath = join(dir, name);
  runMigrations(dbPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  runSeed(sqlite, { seed, generators: builtinGenerators() });
  return sqlite;
}

/** Per-category SKU counts from catalog.md §1 (total 1,200, Basics 185). */
const SPEC_COUNTS = {
  "Consumer Electronics": { skus: 150, basics: 25, min: 1200, max: 28000 },
  "Small Kitchen Appliances": { skus: 110, basics: 20, min: 1800, max: 19000 },
  "Home & Kitchen": { skus: 190, basics: 40, min: 600, max: 12000 },
  "Grocery & Pantry": { skus: 210, basics: 30, min: 300, max: 4500 },
  "Health & Personal Care": { skus: 140, basics: 25, min: 400, max: 6000 },
  "Cleaning & Household": { skus: 120, basics: 20, min: 300, max: 4000 },
  "Pet Supplies": { skus: 100, basics: 10, min: 500, max: 7500 },
  "Office & School": { skus: 90, basics: 10, min: 200, max: 5500 },
  "Toys & Games": { skus: 90, basics: 5, min: 800, max: 9000 },
};

describe("catalog generator (issue #35, E3#3)", () => {
  it("generates exactly 1,200 SKUs across the 9 spec categories", () => {
    const sqlite = seededDb("counts.db");
    const categories = sqlite
      .prepare("SELECT id, name, tariff_exposed FROM categories WHERE data_origin = 'seed'")
      .all();
    assert.equal(categories.length, 9);
    const total = sqlite
      .prepare("SELECT COUNT(*) AS n FROM products WHERE data_origin = 'seed'")
      .get().n;
    assert.equal(total, 1200);
    for (const c of categories) {
      const spec = SPEC_COUNTS[c.name];
      assert.ok(spec, `unexpected category ${c.name}`);
      const n = sqlite
        .prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ?")
        .get(c.id).n;
      assert.equal(n, spec.skus, `${c.name} SKU count`);
    }
    // Exactly the two tariff-exposed categories of catalog.md §3.
    const exposed = categories.filter((c) => c.tariff_exposed === 1).map((c) => c.name);
    assert.deepEqual(
      exposed.sort(),
      ["Consumer Electronics", "Small Kitchen Appliances"],
    );
    sqlite.close();
  });

  it("flags exactly 185 Rainforest Basics SKUs, distributed per catalog.md §1", () => {
    const sqlite = seededDb("basics.db");
    const total = sqlite
      .prepare("SELECT COUNT(*) AS n FROM products WHERE is_private_label = 1")
      .get().n;
    assert.equal(total, 185);
    const rows = sqlite
      .prepare(
        "SELECT c.name AS category, COUNT(*) AS n FROM products p " +
          "JOIN categories c ON c.id = p.category_id " +
          "WHERE p.is_private_label = 1 GROUP BY c.name",
      )
      .all();
    for (const row of rows) {
      assert.equal(row.n, SPEC_COUNTS[row.category].basics, `${row.category} Basics count`);
    }
    // Basics SKUs are named as the private-label line.
    const named = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM products WHERE is_private_label = 1 AND name LIKE 'Rainforest Basics %'",
      )
      .get().n;
    assert.equal(named, 185);
    sqlite.close();
  });

  it("every SKU carries the catalog.md field set and a resolvable supplier", () => {
    const sqlite = seededDb("fields.db");
    const bad = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id " +
          "WHERE p.data_origin != 'seed' OR s.id IS NULL OR p.sku IS NULL " +
          "OR p.unit_cost_cents IS NULL OR p.list_price_cents IS NULL " +
          "OR p.first_sold_quarter IS NULL",
      )
      .get().n;
    assert.equal(bad, 0);
    // All 22 roster suppliers are seeded for SKUs to resolve into.
    const suppliers = sqlite
      .prepare("SELECT COUNT(*) AS n FROM suppliers WHERE data_origin = 'seed'")
      .get().n;
    assert.equal(suppliers, 22);
    sqlite.close();
  });

  it("list prices are log-uniform inside each category's price band", () => {
    const sqlite = seededDb("prices.db");
    const rows = sqlite
      .prepare(
        "SELECT c.name AS category, MIN(p.list_price_cents) AS lo, MAX(p.list_price_cents) AS hi " +
          "FROM products p JOIN categories c ON c.id = p.category_id GROUP BY c.name",
      )
      .all();
    for (const row of rows) {
      const spec = SPEC_COUNTS[row.category];
      assert.ok(row.lo >= spec.min, `${row.category} below band: ${row.lo}`);
      assert.ok(row.hi <= spec.max, `${row.category} above band: ${row.hi}`);
      // Log-uniform spread: the band is actually used, not clustered.
      assert.ok(row.hi / row.lo > 2, `${row.category} prices not spread`);
    }
    sqlite.close();
  });

  it("applies the tariff landed-cost trend on exposed categories only", () => {
    const sqlite = seededDb("tariff.db");
    const bible = loadBible();
    const index = new Map(bible.map((r) => [r.quarter, r.landed_cost_index_electronics]));
    // Quantity-weighted mean PO unit cost per category per quarter, each
    // line normalized by its SKU's base (pre-index) cost and indexed to
    // 2024-Q1 = 100 — the catalog.md §5.2 reconcile hook. Normalizing per
    // SKU keeps the index exact across the 2026 sourcing shift, which
    // changes the SKU mix (Brightline → Saigon/Monterrey).
    const rows = sqlite
      .prepare(
        "SELECT c.tariff_exposed AS exposed, po.quarter_tag AS q, " +
          "SUM(pol.unit_cost_cents * 1.0 / p.unit_cost_cents * pol.quantity) / SUM(pol.quantity) AS avg_ratio " +
          "FROM purchase_order_lines pol " +
          "JOIN purchase_orders po ON po.id = pol.purchase_order_id " +
          "JOIN products p ON p.id = pol.product_id " +
          "JOIN categories c ON c.id = p.category_id " +
          "GROUP BY c.tariff_exposed, po.quarter_tag",
      )
      .all();
    const byGroup = new Map();
    for (const r of rows) {
      if (!byGroup.has(r.exposed)) byGroup.set(r.exposed, new Map());
      byGroup.get(r.exposed).set(r.q, r.avg_ratio);
    }
    const exposed = byGroup.get(1);
    const flat = byGroup.get(0);
    const base = exposed.get("2024-Q1");
    for (const [q, idx] of index) {
      if (!exposed.has(q)) continue;
      const reproduced = (exposed.get(q) / base) * 100;
      assert.ok(
        Math.abs(reproduced - idx) / idx <= 0.02,
        `exposed landed-cost index at ${q}: ${reproduced.toFixed(2)} vs bible ${idx}`,
      );
    }
    // Exact endpoints (catalog.md §5.2).
    assert.ok(Math.abs((exposed.get("2024-Q1") / base) * 100 - 100.0) < 1e-9);
    const end = (exposed.get("2025-Q4") / base) * 100;
    assert.ok(Math.abs(end - 118.0) / 118.0 <= 0.02, `2025-Q4 endpoint ${end}`);
    // Unexposed categories stay flat across the tariff window.
    const flatBase = flat.get("2024-Q1");
    for (const q of ["2024-Q1", "2024-Q4", "2025-Q2", "2025-Q4", "2026-Q3"]) {
      const drift = Math.abs(flat.get(q) / flatBase - 1);
      assert.ok(drift < 0.01, `unexposed category drifted at ${q}: ${drift}`);
    }
    sqlite.close();
  });

  it("respects supplier active windows in exposed-category sourcing", () => {
    const sqlite = seededDb("windows.db");
    // No Brightline-sourced receipts after 2025-Q4 (catalog.md §5.4).
    const brightlineLate = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id " +
          "WHERE s.code = 'SUP-BRIGHTLINE' AND po.quarter_tag > '2025-Q4'",
      )
      .get().n;
    assert.equal(brightlineLate, 0);
    // No Saigon POs before 2026-Q1, no Monterrey POs before 2026-Q2.
    const saigonEarly = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id " +
          "WHERE s.code = 'SUP-SAIGON' AND po.quarter_tag < '2026-Q1'",
      )
      .get().n;
    assert.equal(saigonEarly, 0);
    const monterreyEarly = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id " +
          "WHERE s.code = 'SUP-MONTERREY' AND po.quarter_tag < '2026-Q2'",
      )
      .get().n;
    assert.equal(monterreyEarly, 0);
    // Exposed-category SKUs source only from their spec supplier pools.
    const stray = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id " +
          "JOIN suppliers s ON s.id = p.supplier_id " +
          "WHERE c.name = 'Consumer Electronics' " +
          "AND s.code NOT IN ('SUP-BRIGHTLINE', 'SUP-DRAGONGATE', 'SUP-SAIGON')",
      )
      .get().n;
    assert.equal(stray, 0);
    sqlite.close();
  });

  it("is deterministic: same seed reproduces the catalog byte-for-byte", () => {
    const a = seededDb("det-a.db", 42);
    const b = seededDb("det-b.db", 42);
    const dump = (db) =>
      JSON.stringify(
        db
          .prepare(
            "SELECT sku, name, category_id, supplier_id, is_private_label, " +
              "unit_cost_cents, list_price_cents, first_sold_quarter, discontinued_quarter " +
              "FROM products ORDER BY sku",
          )
          .all(),
      );
    assert.equal(dump(a), dump(b));
    a.close();
    b.close();
  });
});
