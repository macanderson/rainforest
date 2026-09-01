import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import {
  checkBibleIdentities,
  loadBible,
  reconcile,
} from "../lib/reconcile.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-reconcile-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);

after(() => rmSync(dir, { recursive: true, force: true }));

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
});

describe("reconcile — seeded-DB half (reconciliation.md §2)", () => {
  it("is skipped (not failed) on an empty database", () => {
    const sqlite = new Database(dbPath, { readonly: true });
    const report = reconcile(sqlite);
    sqlite.close();
    assert.equal(report.ok, true);
    assert.equal(report.dbHalf, "skipped");
  });

  it("stays skipped until the E3 generators arm the D1–D6 diffs", () => {
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");
    sqlite
      .prepare(
        "INSERT INTO categories (name, tariff_exposed, data_origin) VALUES ('C', 0, 'seed')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO suppliers (code, name, location, is_import, active_from_quarter, lifetime_on_time_bps, mean_days_late_hundredths, data_origin) " +
          "VALUES ('SUP-R', 'R', 'X, US', 0, '2021-Q1', 9000, 100, 'seed')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO products (sku, name, category_id, supplier_id, is_private_label, unit_cost_cents, list_price_cents, first_sold_quarter, data_origin) " +
          "VALUES ('SKU-R', 'R', 1, 1, 0, 100, 200, '2021-Q1', 'seed')",
      )
      .run();
    const report = reconcile(sqlite);
    sqlite.close();
    assert.equal(report.ok, true);
    assert.equal(report.dbHalf, "skipped");
  });
});
