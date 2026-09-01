import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadNumbersBible, quarterRow } from "../lib/numbers-bible.ts";
import {
  annualPnlRollups,
  deriveQuarterPnl,
  pnlReport,
  quarterlyPnlSeries,
} from "../lib/pnl.ts";
import { checkBibleIdentities } from "../lib/reconcile.ts";

const bible = loadNumbersBible();
const series = quarterlyPnlSeries(bible);
const annual = annualPnlRollups(bible);

/** Relative closeness assertion, in percent. */
function withinPct(actual, expected, pct, label) {
  const drift = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(
    drift <= pct / 100,
    `${label}: ${actual} vs ${expected} (drift ${(drift * 100).toFixed(3)}%, tolerance ±${pct}%)`,
  );
}

describe("P&L derivation — quarterly series shape (E4#7 contract)", () => {
  it("produces exactly 23 quarterly rows in bible order", () => {
    assert.equal(series.length, 23);
    assert.equal(series[0].quarter, "2021-Q1");
    assert.equal(series.at(-1).quarter, "2026-Q3");
    assert.deepEqual(
      series.map((p) => p.quarter),
      bible.map((r) => r.quarter),
    );
  });

  it("every row carries the five income-statement lines plus margin", () => {
    for (const p of series) {
      assert.deepEqual(Object.keys(p).sort(), [
        "cogs_usd_m",
        "gross_margin_pct",
        "gross_profit_usd_m",
        "net_income_usd_m",
        "opex_usd_m",
        "quarter",
        "revenue_usd_m",
      ]);
    }
  });

  it("revenue, margin, and net income are the bible columns verbatim — nothing restated", () => {
    for (let i = 0; i < bible.length; i++) {
      assert.equal(series[i].revenue_usd_m, bible[i].revenue_usd_m);
      assert.equal(series[i].gross_margin_pct, bible[i].gross_margin_pct);
      assert.equal(series[i].net_income_usd_m, bible[i].net_income_usd_m);
    }
  });

  it("the lines are internally consistent on every row: revenue = cogs + gross profit = opex + net income", () => {
    for (const p of series) {
      withinPct(p.cogs_usd_m + p.gross_profit_usd_m, p.revenue_usd_m, 1e-9, `${p.quarter} cogs+gp`);
      withinPct(p.opex_usd_m + p.net_income_usd_m, p.gross_profit_usd_m, 1e-9, `${p.quarter} opex+ni`);
    }
  });
});

describe("P&L derivation — hand-checked fixtures (reconciliation.md §1 worked examples)", () => {
  it("2024-Q4: revenue 345.6, GP 345.6×0.156 = 53.9136, COGS 291.6864, opex 68.7136, NI −14.8", () => {
    const p = deriveQuarterPnl(quarterRow("2024-Q4"));
    assert.equal(p.revenue_usd_m, 345.6);
    withinPct(p.gross_profit_usd_m, 53.9136, 1e-9, "2024-Q4 gross profit");
    withinPct(p.cogs_usd_m, 291.6864, 1e-9, "2024-Q4 cogs");
    withinPct(p.opex_usd_m, 68.7136, 1e-9, "2024-Q4 opex");
    assert.equal(p.net_income_usd_m, -14.8);
  });

  it("2025-Q3: revenue 331.7, GP 331.7×0.142 = 47.1014, COGS 284.5986, opex 63.3014, NI −16.2", () => {
    const p = deriveQuarterPnl(quarterRow("2025-Q3"));
    assert.equal(p.revenue_usd_m, 331.7);
    withinPct(p.gross_profit_usd_m, 47.1014, 1e-9, "2025-Q3 gross profit");
    withinPct(p.cogs_usd_m, 284.5986, 1e-9, "2025-Q3 cogs");
    withinPct(p.opex_usd_m, 63.3014, 1e-9, "2025-Q3 opex");
    assert.equal(p.net_income_usd_m, -16.2);
  });

  it("2026-Q2: revenue 322.3, GP 322.3×0.166 = 53.5018, COGS 268.7982, opex 49.3018, NI +4.2", () => {
    const p = deriveQuarterPnl(quarterRow("2026-Q2"));
    assert.equal(p.revenue_usd_m, 322.3);
    withinPct(p.gross_profit_usd_m, 53.5018, 1e-9, "2026-Q2 gross profit");
    withinPct(p.cogs_usd_m, 268.7982, 1e-9, "2026-Q2 cogs");
    withinPct(p.opex_usd_m, 49.3018, 1e-9, "2026-Q2 opex");
    assert.equal(p.net_income_usd_m, 4.2);
  });
});

describe("P&L derivation — modeled opex schedule (identity I3)", () => {
  it("opex = revenue × gross_margin_pct − net_income on every one of the 23 rows", () => {
    for (let i = 0; i < bible.length; i++) {
      const r = bible[i];
      const expected = (r.revenue_usd_m * r.gross_margin_pct) / 100 - r.net_income_usd_m;
      withinPct(series[i].opex_usd_m, expected, 1e-9, `${r.quarter} opex schedule`);
    }
  });

  it("modeled opex is positive on every one of the 23 rows", () => {
    for (const p of series) {
      assert.ok(p.opex_usd_m > 0, `${p.quarter} opex ${p.opex_usd_m} must be positive`);
    }
  });

  it("reconciliation's I3 check validates the bible against this model with zero findings", () => {
    const findings = checkBibleIdentities(bible).filter((f) => f.check === "I3");
    assert.deepEqual(findings, []);
  });
});

describe("P&L derivation — annual FY rollups (RAINFOREST.md §8.2)", () => {
  const byFy = new Map(annual.map((a) => [a.fiscal_year, a]));

  it("produces FY2021–FY2025 full-year rollups plus the FY2026 YTD rollup", () => {
    assert.deepEqual(
      annual.map((a) => a.fiscal_year),
      ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025", "FY2026"],
    );
    for (const fy of ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]) {
      assert.equal(byFy.get(fy).quarters.length, 4, `${fy} has four quarters`);
    }
    assert.deepEqual(byFy.get("FY2026").quarters, ["2026-Q1", "2026-Q2", "2026-Q3"]);
  });

  // Expected values recomputed from the quarterly bible rows with the §8.2
  // convention (flows sum, blended margin = GP/revenue, headcount = Q4).
  // They match the RAINFOREST.md §8.2 table to its published 0.1 precision.
  const expected = {
    FY2021: { gmv: 780.0, rev: 310.7, cogs: 231.3, gp: 79.4, gm: 25.5, opex: 69.3, ni: 10.1, hc: 1820 },
    FY2022: { gmv: 1029.0, rev: 467.3, cogs: 353.9, gp: 113.4, gm: 24.3, opex: 106.1, ni: 7.3, hc: 2440 },
    FY2023: { gmv: 1198.3, rev: 650.0, cogs: 511.0, gp: 139.0, gm: 21.4, opex: 130.1, ni: 8.9, hc: 3310 },
    FY2024: { gmv: 1735.0, rev: 1101.8, cogs: 912.8, gp: 189.0, gm: 17.2, opex: 220.7, ni: -31.7, hc: 5400 },
    FY2025: { gmv: 1959.0, rev: 1342.5, cogs: 1147.8, gp: 194.7, gm: 14.5, opex: 260.3, ni: -65.6, hc: 6400 },
  };

  for (const [fy, e] of Object.entries(expected)) {
    it(`${fy} matches RAINFOREST.md §8.2 (rev ${e.rev}, NI ${e.ni})`, () => {
      const a = byFy.get(fy);
      withinPct(a.gmv_usd_m, e.gmv, 0.1, `${fy} gmv`);
      withinPct(a.revenue_usd_m, e.rev, 0.1, `${fy} revenue`);
      withinPct(a.cogs_usd_m, e.cogs, 0.1, `${fy} cogs`);
      withinPct(a.gross_profit_usd_m, e.gp, 0.1, `${fy} gross profit`);
      withinPct(a.gross_margin_pct, e.gm, 0.5, `${fy} blended margin`);
      withinPct(a.opex_usd_m, e.opex, 0.1, `${fy} opex`);
      withinPct(a.net_income_usd_m, e.ni, 0.5, `${fy} net income`);
      assert.equal(a.headcount_year_end, e.hc, `${fy} year-end headcount`);
    });
  }

  it("FY2026 YTD matches §8.2's stated year-to-date figures ($967.4M revenue, +$10.9M net income)", () => {
    const a = byFy.get("FY2026");
    withinPct(a.revenue_usd_m, 967.4, 0.1, "FY2026 YTD revenue");
    withinPct(a.net_income_usd_m, 10.9, 0.5, "FY2026 YTD net income");
    assert.equal(a.headcount_year_end, null, "FY2026 has no Q4 row yet");
  });

  it("annual lines are the sums of the quarterly lines — same source, no restatement", () => {
    for (const a of annual) {
      const quarters = series.filter((p) => a.quarters.includes(p.quarter));
      const sum = (f) => quarters.reduce((acc, p) => acc + f(p), 0);
      withinPct(a.revenue_usd_m, sum((p) => p.revenue_usd_m), 1e-9, `${a.fiscal_year} revenue sum`);
      withinPct(a.cogs_usd_m, sum((p) => p.cogs_usd_m), 1e-9, `${a.fiscal_year} cogs sum`);
      withinPct(a.gross_profit_usd_m, sum((p) => p.gross_profit_usd_m), 1e-9, `${a.fiscal_year} gp sum`);
      withinPct(a.opex_usd_m, sum((p) => p.opex_usd_m), 1e-9, `${a.fiscal_year} opex sum`);
      withinPct(a.net_income_usd_m, sum((p) => p.net_income_usd_m), 1e-9, `${a.fiscal_year} ni sum`);
    }
  });
});

describe("P&L derivation — story-beat sanity (docs/numbers-bible.md §3)", () => {
  it("net income is negative for five consecutive quarters 2024-Q2 → 2025-Q2", () => {
    const run = series.filter((p) =>
      ["2024-Q2", "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2"].includes(p.quarter),
    );
    assert.equal(run.length, 5);
    for (const p of run) {
      assert.ok(p.net_income_usd_m < 0, `${p.quarter} net income must be negative`);
    }
    // The quarter before the run is positive (the swing into losses).
    assert.ok(series.find((p) => p.quarter === "2024-Q1").net_income_usd_m > 0);
  });

  it("net income is positive from 2026-Q2 onward", () => {
    for (const p of series.filter((p) => p.quarter >= "2026-Q2")) {
      assert.ok(p.net_income_usd_m > 0, `${p.quarter} net income must be positive`);
    }
  });
});

describe("P&L derivation — UI output shape (E4#7)", () => {
  it("pnlReport returns the quarterly series plus annual snapshots", () => {
    const report = pnlReport(bible);
    assert.equal(report.quarterly.length, 23);
    assert.equal(report.annual.length, 6);
    assert.equal(report.quarterly[0].quarter, "2021-Q1");
    assert.equal(report.annual[0].fiscal_year, "FY2021");
  });
});
