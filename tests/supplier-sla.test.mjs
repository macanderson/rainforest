import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import { loadBible, reconcile } from "../lib/reconcile.ts";
import {
  builtinGenerators,
  chooseIndices,
  largestRemainder,
} from "../lib/seed/generators.ts";
import { runSeed } from "../lib/seed/orchestrator.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-sla-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function seededDb(name, { seed = 11, bible } = {}) {
  const dbPath = join(dir, name);
  runMigrations(dbPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  runSeed(sqlite, { seed, generators: builtinGenerators(), bible });
  return sqlite;
}

// A full 23-quarter seed is the expensive fixture (~800k rows), so the suite
// builds one and shares it. Tests that need a *second* independent run use a
// short bible slice instead.
let full;
function fullDb() {
  full ??= seededDb("full.db");
  return full;
}
after(() => full?.close());

describe("apportionment helpers (issue #26)", () => {
  it("largest remainder sums to exactly the total", () => {
    for (const [weights, total] of [
      [[1, 1, 1], 10],
      [[5, 3, 2], 7],
      [[150, 110, 190, 210], 2200],
      [[1], 0],
      [[7, 7, 7, 7, 7, 7], 13],
    ]) {
      const counts = largestRemainder(weights, total);
      assert.equal(
        counts.reduce((a, b) => a + b, 0),
        total,
        `weights ${weights} total ${total}`,
      );
      assert.ok(
        counts.every((n) => Number.isInteger(n) && n >= 0),
        "counts are non-negative integers",
      );
    }
  });

  it("expresses a target the per-entry denominators cannot", () => {
    // The trap earlier attempts hit: 12 purchase orders can only express
    // twelfths, so no shared rate reaches 95.5% and iterating one oscillates
    // between 91.67% and 100%. Apportioning the aggregate instead lands it.
    const suppliers = 12;
    const posEach = 12;
    const lateTotal = Math.round(suppliers * posEach * (1 - 0.955));
    const perSupplier = largestRemainder(Array(suppliers).fill(1), lateTotal);
    assert.equal(perSupplier.reduce((a, b) => a + b, 0), lateTotal);
    const realized = (100 * (suppliers * posEach - lateTotal)) / (suppliers * posEach);
    assert.ok(Math.abs(realized - 95.5) < 0.5, `realized ${realized}`);
  });

  it("degenerate weights and totals stay in range", () => {
    assert.deepEqual(largestRemainder([0, 0], 5), [0, 0]);
    assert.deepEqual(largestRemainder([1, 2], 0), [0, 0]);
  });

  it("chooseIndices picks exactly count distinct indices, deterministically", () => {
    const draw = (seed) => {
      let state = seed;
      const rng = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
      return [...chooseIndices(rng, 50, 17)].sort((a, b) => a - b);
    };
    const a = draw(7);
    assert.equal(a.length, 17);
    assert.ok(a.every((i) => i >= 0 && i < 50));
    assert.deepEqual(draw(7), a, "same stream → same selection");
    assert.notDeepEqual(draw(9), a, "different stream → different selection");
    // Asking for more than exist yields every index, not a hang.
    const rng = () => 0.5;
    assert.equal(chooseIndices(rng, 4, 99).size, 4);
  });
});

describe("per-quarter late shipments (issue #26, D5)", () => {
  it("late counts sum to exactly the bible's implied target", () => {
    const sqlite = fullDb();
    const rows = sqlite
      .prepare(
        "SELECT quarter_tag AS quarter, COUNT(*) AS shipments, " +
          "SUM(is_late) AS late FROM shipments WHERE data_origin = 'seed' " +
          "GROUP BY quarter_tag",
      )
      .all();
    const bible = new Map(loadBible().map((r) => [r.quarter, r]));
    assert.equal(rows.length, 23);
    for (const r of rows) {
      const row = bible.get(r.quarter);
      const target = Math.round(
        r.shipments * (1 - row.on_time_delivery_pct / 100),
      );
      assert.equal(
        r.late,
        target,
        `${r.quarter}: ${r.late} late vs target ${target}`,
      );
    }
  });

  it("reconcile D5 is clean in every quarter", () => {
    const report = reconcile(fullDb(), loadBible());
    const d5 = report.cells.filter((c) => c.check === "D5");
    assert.equal(d5.length, 23);
    for (const cell of d5) {
      assert.ok(
        cell.pass,
        `${cell.quarter}: db ${cell.db.toFixed(3)} vs bible ${cell.bible} ` +
          `(drift ${cell.driftPct.toFixed(3)}%)`,
      );
    }
    assert.equal(
      report.findings.filter((f) => f.check === "D5").length,
      0,
      "no D5 findings",
    );
  });

  it("attributes late shipments to inbound delay by story phase", () => {
    // suppliers.md §3 — the customer-facing decline has to trace back to late
    // inbound POs, not appear as unexplained noise.
    const sqlite = fullDb();
    const rows = sqlite
      .prepare(
        "SELECT quarter_tag AS quarter, " +
          "SUM(CASE WHEN late_cause = 'inbound_stockout' THEN 1 ELSE 0 END) AS inbound, " +
          "COUNT(*) AS late FROM sales_orders " +
          "WHERE data_origin = 'seed' AND late_cause IS NOT NULL GROUP BY quarter_tag",
      )
      .all();
    const shareFor = (q) => {
      if (q < "2023-Q3") return 0.2;
      if (q < "2025-Q1") return 0.4;
      if (q < "2026-Q1") return 0.525;
      return 0.25;
    };
    for (const r of rows) {
      const share = r.inbound / r.late;
      assert.ok(
        Math.abs(share - shareFor(r.quarter)) < 0.02,
        `${r.quarter}: inbound share ${share.toFixed(3)}`,
      );
    }
  });
});

describe("supplier SLA history (issue #26)", () => {
  it("seeds exactly the 22-supplier roster", () => {
    const n = fullDb()
      .prepare("SELECT COUNT(*) AS n FROM suppliers WHERE data_origin = 'seed'")
      .get().n;
    assert.equal(n, 22);
  });

  it("every supplier's stored SLA is derived from its own purchase orders", () => {
    // The scorecard is computed from the rows, not asserted from the roster
    // (issue #26) — so the two must agree exactly, for all 22.
    const rows = fullDb()
      .prepare(
        "SELECT s.code, s.lifetime_on_time_bps AS bps, " +
          "s.mean_days_late_hundredths AS meanLate, COUNT(po.id) AS pos, " +
          "SUM(CASE WHEN po.received_at > po.promised_at THEN 1 ELSE 0 END) AS late, " +
          "SUM(CASE WHEN po.received_at > po.promised_at " +
          "THEN (po.received_at - po.promised_at) / 86400000 ELSE 0 END) AS lateDays " +
          "FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id = s.id " +
          "WHERE s.data_origin = 'seed' GROUP BY s.id",
      )
      .all();
    assert.equal(rows.length, 22);
    for (const r of rows) {
      assert.ok(r.pos > 0, `${r.code} received no POs`);
      assert.equal(
        r.bps,
        Math.round((10_000 * (r.pos - r.late)) / r.pos),
        `${r.code} lifetime on-time`,
      );
      assert.equal(
        r.meanLate,
        r.late > 0 ? Math.round((100 * r.lateDays) / r.late) : 0,
        `${r.code} mean days late`,
      );
    }
  });

  it("preserves the story ordering: Brightline and Apex worst, Great Lakes the control", () => {
    const ranked = fullDb()
      .prepare(
        "SELECT code, lifetime_on_time_bps AS bps FROM suppliers " +
          "WHERE data_origin = 'seed' ORDER BY lifetime_on_time_bps ASC",
      )
      .all();
    assert.deepEqual(
      ranked.slice(0, 2).map((r) => r.code),
      ["SUP-BRIGHTLINE", "SUP-APEX"],
      "the two chronically late suppliers of data story 1 rank worst",
    );
    const bps = new Map(ranked.map((r) => [r.code, r.bps]));
    // The control has to read ~98% for the demo's "supplier-specific, not
    // systemic" claim to hold up against live data.
    assert.ok(
      Math.abs(bps.get("SUP-GREATLAKES") - 9800) <= 100,
      `Great Lakes ${bps.get("SUP-GREATLAKES")}`,
    );
    // The post-pivot replacement arrives strong.
    assert.ok(bps.get("SUP-SAIGON") >= 9400, `Saigon ${bps.get("SUP-SAIGON")}`);
    assert.ok(
      bps.get("SUP-BRIGHTLINE") < bps.get("SUP-GREATLAKES") - 2000,
      "Brightline is visibly, not marginally, worse than the control",
    );
  });

  it("tracks Brightline's published quarterly trajectory and exit", () => {
    const sqlite = fullDb();
    const rows = sqlite
      .prepare(
        "SELECT po.quarter_tag AS quarter, COUNT(*) AS pos, " +
          "SUM(CASE WHEN po.received_at > po.promised_at THEN 1 ELSE 0 END) AS late " +
          "FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id " +
          "WHERE s.code = 'SUP-BRIGHTLINE' GROUP BY po.quarter_tag ORDER BY 1",
      )
      .all();
    // suppliers.md §2, verbatim.
    const target = {
      "2021-Q1": 83, "2021-Q2": 82, "2021-Q3": 81, "2021-Q4": 80,
      "2022-Q1": 79, "2022-Q2": 78, "2022-Q3": 77, "2022-Q4": 76,
      "2023-Q1": 75, "2023-Q2": 74, "2023-Q3": 72, "2023-Q4": 71,
      "2024-Q1": 68, "2024-Q2": 66, "2024-Q3": 64, "2024-Q4": 62,
      "2025-Q1": 60, "2025-Q2": 58, "2025-Q3": 56, "2025-Q4": 54,
    };
    assert.equal(rows.length, 20, "20 active quarters, none after 2025-Q4");
    for (const r of rows) {
      assert.ok(target[r.quarter] !== undefined, `unexpected quarter ${r.quarter}`);
      // Integer PO counts cannot express every target exactly; one PO is
      // ~1.2 pt at this cadence, so a point and a half is the tightest
      // honest bound.
      const realized = (100 * (r.pos - r.late)) / r.pos;
      assert.ok(
        Math.abs(realized - target[r.quarter]) <= 1.5,
        `${r.quarter}: ${realized.toFixed(2)}% vs target ${target[r.quarter]}%`,
      );
      // §2 pins the cadence flat, which is what keeps the lifetime aggregate
      // on the arithmetic mean of the table rather than its late, worse half.
      assert.ok(r.pos >= 65 && r.pos <= 90, `${r.quarter}: ${r.pos} POs`);
    }
  });

  it("respects supplier active windows", () => {
    const sqlite = fullDb();
    const count = (sql) => sqlite.prepare(sql).get().n;
    const base =
      "SELECT COUNT(*) AS n FROM purchase_orders po " +
      "JOIN suppliers s ON s.id = po.supplier_id WHERE ";
    assert.equal(
      count(`${base} s.code = 'SUP-BRIGHTLINE' AND po.quarter_tag > '2025-Q4'`),
      0,
      "no Brightline POs after the relationship ends",
    );
    assert.equal(
      count(`${base} s.code = 'SUP-SAIGON' AND po.quarter_tag < '2026-Q1'`),
      0,
      "no Saigon POs before onboarding",
    );
    assert.equal(
      count(`${base} s.code = 'SUP-MONTERREY' AND po.quarter_tag < '2026-Q2'`),
      0,
      "no Monterrey POs before onboarding",
    );
  });
});

describe("determinism (issue #26)", () => {
  it("same seed reproduces an identical SLA history", () => {
    // The bible's own identity checks are a fatal seed postcondition, so a
    // truncated bible is not a legal run — determinism here costs a second
    // full walk. Byte-identity of the whole database is already covered by
    // the orchestrator suite; what this pins is the SLA distribution the
    // apportionment produces, which is the part issue #26 added.
    const dump = (sqlite) =>
      JSON.stringify([
        sqlite
          .prepare(
            "SELECT s.code AS supplier, po.quarter_tag AS quarter, " +
              "COUNT(*) AS pos, " +
              "SUM(CASE WHEN po.received_at > po.promised_at THEN 1 ELSE 0 END) AS late, " +
              "SUM(CASE WHEN po.received_at > po.promised_at " +
              "THEN (po.received_at - po.promised_at) / 86400000 ELSE 0 END) AS lateDays " +
              "FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id " +
              "GROUP BY s.code, po.quarter_tag ORDER BY 1, 2",
          )
          .all(),
        sqlite
          .prepare(
            "SELECT code, lifetime_on_time_bps, mean_days_late_hundredths " +
              "FROM suppliers ORDER BY code",
          )
          .all(),
        sqlite
          .prepare(
            "SELECT quarter_tag, SUM(is_late) AS late FROM shipments " +
              "GROUP BY quarter_tag ORDER BY quarter_tag",
          )
          .all(),
      ]);

    const replay = seededDb("det-replay.db", { seed: 11 });
    assert.equal(dump(replay), dump(fullDb()), "same seed → identical history");
    replay.close();
  });
});
