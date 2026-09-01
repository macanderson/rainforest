import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { formatReport, reconcileBible } from "../lib/reconcile.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const bible = JSON.parse(readFileSync(join(REPO_ROOT, "data", "numbers-bible.json"), "utf8"));

function clone(rows) {
  return rows.map((r) => ({ ...r }));
}

describe("reconcile — bible-internal identities (docs/data-specs/reconciliation.md §1)", () => {
  it("the shipped bible passes every check", () => {
    const results = reconcileBible(bible);
    const failures = results.filter((r) => !r.pass);
    assert.deepEqual(
      failures.map((f) => `${f.id} ${f.quarter} ${f.metric}`),
      [],
      `expected zero failures, got: ${JSON.stringify(failures, null, 2)}`,
    );
  });

  it("runs I1, I2, I3 on all 23 rows plus the 7 story-beat guards", () => {
    const results = reconcileBible(bible);
    assert.equal(results.filter((r) => r.id === "I1").length, 23);
    assert.equal(results.filter((r) => r.id === "I2").length, 23);
    assert.equal(results.filter((r) => r.id === "I3").length, 23);
    assert.equal(results.filter((r) => r.id.startsWith("S")).length, 7);
  });

  it("reproduces the spec's worked examples", () => {
    const results = reconcileBible(bible);
    const i2 = (q) => results.find((r) => r.id === "I2" && r.quarter === q);
    const i1 = (q) => results.find((r) => r.id === "I1" && r.quarter === q);
    // 2024-Q4 (I2): 317.20 + 28.39 = 345.59 ≈ 345.6
    assert.ok(Math.abs(i2("2024-Q4").actual - 345.59) < 0.01);
    // 2025-Q3 (I2): 305.92 + 25.81 = 331.73 ≈ 331.7
    assert.ok(Math.abs(i2("2025-Q3").actual - 331.73) < 0.01);
    // 2025-Q3 (I1): 7,113k × $67.2 = $477.99M ≈ $478M
    assert.ok(Math.abs(i1("2025-Q3").actual - 477.99) < 0.01);
    // 2026-Q2 (I2): 287.10 + 35.24 = 322.34 ≈ 322.3
    assert.ok(Math.abs(i2("2026-Q2").actual - 322.34) < 0.01);
  });

  it("fails when I1 is violated beyond ±1%", () => {
    const rows = clone(bible);
    rows[0].aov_usd *= 1.05; // 5% off — outside the ±1% gate
    const results = reconcileBible(rows);
    const i1 = results.find((r) => r.id === "I1" && r.quarter === rows[0].quarter);
    assert.equal(i1.pass, false);
  });

  it("fails when I2 is violated beyond ±1%", () => {
    const rows = clone(bible);
    rows[5].revenue_usd_m *= 0.9; // 10% off the modeled revenue
    const results = reconcileBible(rows);
    const i2 = results.find((r) => r.id === "I2" && r.quarter === rows[5].quarter);
    assert.equal(i2.pass, false);
  });

  it("fails when implied opex goes non-positive (I3)", () => {
    const rows = clone(bible);
    rows[0].net_income_usd_m = rows[0].revenue_usd_m; // opex deeply negative
    const results = reconcileBible(rows);
    const i3 = results.find((r) => r.id === "I3" && r.quarter === rows[0].quarter);
    assert.equal(i3.pass, false);
  });

  it("fails the row-count guard when a quarter is missing", () => {
    const results = reconcileBible(bible.slice(1));
    assert.equal(results.find((r) => r.id === "S1").pass, false);
  });

  it("fails the monotone 1P-share guard when the rise inverts", () => {
    const rows = clone(bible);
    const q423 = rows.find((r) => r.quarter === "2023-Q4");
    q423.first_party_share_pct = 60; // above the 2024-Q4 endpoint's neighbors
    const q424 = rows.find((r) => r.quarter === "2024-Q1");
    q424.first_party_share_pct = 50; // inversion inside the window
    const results = reconcileBible(rows);
    assert.equal(results.find((r) => r.id === "S2").pass, false);
  });

  it("fails the loss-run guard when a 2024-Q2→2025-Q2 quarter turns positive", () => {
    const rows = clone(bible);
    rows.find((r) => r.quarter === "2024-Q4").net_income_usd_m = 1;
    const results = reconcileBible(rows);
    assert.equal(results.find((r) => r.id === "S3").pass, false);
  });

  it("fails the plateau guard when 2025-Q2 revenue jumps off the plateau", () => {
    const rows = clone(bible);
    rows.find((r) => r.quarter === "2025-Q2").revenue_usd_m = 400;
    const results = reconcileBible(rows);
    assert.equal(results.find((r) => r.id === "S4").pass, false);
  });

  it("fails the landed-cost endpoint guard when 2025-Q4 moves off 118.0", () => {
    const rows = clone(bible);
    rows.find((r) => r.quarter === "2025-Q4").landed_cost_index_electronics = 115;
    const results = reconcileBible(rows);
    assert.equal(results.find((r) => r.id === "S5").pass, false);
  });

  it("fails the on-time guard when the 2025-Q3 trough moves off 88.0", () => {
    const rows = clone(bible);
    rows.find((r) => r.quarter === "2025-Q3").on_time_delivery_pct = 90;
    const results = reconcileBible(rows);
    assert.equal(results.find((r) => r.id === "S6").pass, false);
  });

  it("fails the recovery guard when 2026-Q2 net income goes negative", () => {
    const rows = clone(bible);
    rows.find((r) => r.quarter === "2026-Q2").net_income_usd_m = -1;
    const results = reconcileBible(rows);
    assert.equal(results.find((r) => r.id === "S7").pass, false);
  });
});

describe("reconcile — report (spec §4)", () => {
  it("is deterministic: two runs over the same bible are byte-identical", () => {
    assert.equal(formatReport(reconcileBible(bible)), formatReport(reconcileBible(bible)));
  });

  it("lists worst offenders first and ends with the PASS/FAIL verdict", () => {
    const rows = clone(bible);
    rows[0].aov_usd *= 1.05;
    rows[5].revenue_usd_m *= 0.9;
    const report = formatReport(reconcileBible(rows));
    const failLines = report.split("\n").filter((l) => l.includes("FAIL") && l.startsWith("I"));
    assert.ok(failLines.length >= 2);
    // 10% I2 miss sorts ahead of the 5% I1 miss.
    assert.ok(failLines[0].startsWith("I2"));
    assert.match(report, /RECONCILE: FAIL\n?$/);
    assert.match(formatReport(reconcileBible(bible)), /RECONCILE: PASS\n?$/);
  });
});
