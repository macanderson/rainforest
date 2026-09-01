/**
 * Reconciliation engine — the CI gate that makes drift between the numbers
 * bible and the rest of the system mechanically impossible.
 *
 * Spec: docs/data-specs/reconciliation.md
 *
 * Armed today (E1): the bible-internal identities I1–I3 plus the structural
 * story-beat guards, all checkable from data/numbers-bible.json alone.
 * The seeded-DB-vs-bible diffs (D1–D6) arm once the E3 generators land.
 *
 * Behavior (spec §4):
 *  - Deterministic: reads only the bible file; two runs over the same file
 *    produce byte-identical reports.
 *  - Drift report: human-readable table written to stdout and
 *    reconcile-report.txt, worst offenders first.
 *  - Exit code: non-zero on any FAIL. There is no warn-only mode.
 *  - Scope discipline: never mutates data, never "fixes" drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIBLE_PATH = join(REPO_ROOT, "data", "numbers-bible.json");
const REPORT_PATH = join(REPO_ROOT, "reconcile-report.txt");

const TOL_IDENTITY = 0.01; // I1/I2: ±1% relative
const TOL_PLATEAU = 0.02; // story-beat: revenue plateau ±2% of prior

function relDelta(actual, expected) {
  if (expected === 0) return actual === 0 ? 0 : Infinity;
  return (actual - expected) / Math.abs(expected);
}

/** One check result. `delta` is the relative error used for worst-first sort. */
function check(id, quarter, metric, actual, expected, tolerance) {
  const delta = relDelta(actual, expected);
  return {
    id,
    quarter,
    metric,
    actual,
    expected,
    delta,
    pass: Math.abs(delta) <= tolerance,
  };
}

function structural(id, description, pass) {
  return { id, quarter: "—", metric: description, actual: pass ? 1 : 0, expected: 1, delta: pass ? 0 : Infinity, pass };
}

export function reconcileBible(rows) {
  const results = [];

  // --- I1: orders_k × aov_usd ≈ gmv_usd_m × 1000 (±1%) ---
  for (const row of rows) {
    results.push(
      check(
        "I1",
        row.quarter,
        "gmv = orders_k × aov / 1000",
        (row.orders_k * row.aov_usd) / 1000,
        row.gmv_usd_m,
        TOL_IDENTITY,
      ),
    );
  }

  // --- I2: revenue ≈ gmv × 1P% + take_rate × gmv × (1 − 1P%) (±1%) ---
  for (const row of rows) {
    const share = row.first_party_share_pct / 100;
    const take = row.marketplace_take_rate_pct / 100;
    const modeled = row.gmv_usd_m * share + take * row.gmv_usd_m * (1 - share);
    results.push(
      check("I2", row.quarter, "revenue = 1P gross + 3P take", modeled, row.revenue_usd_m, TOL_IDENTITY),
    );
  }

  // --- I3: implied opex = revenue × gross_margin − net_income must be
  // positive on every row. The ±2% match against the E2#4 P&L derivation
  // layer arms when that layer lands; positivity is checkable from day one. ---
  for (const row of rows) {
    const impliedOpex = (row.revenue_usd_m * row.gross_margin_pct) / 100 - row.net_income_usd_m;
    results.push({
      id: "I3",
      quarter: row.quarter,
      metric: "implied opex = revenue × gross_margin − net_income > 0",
      actual: impliedOpex,
      expected: "> 0",
      delta: impliedOpex > 0 ? 0 : Infinity,
      pass: impliedOpex > 0,
    });
  }

  // --- Story-beat guards (structural) ---
  const byQuarter = new Map(rows.map((r) => [r.quarter, r]));
  const at = (q) => byQuarter.get(q);

  results.push(structural("S1", "23 rows exactly (2021-Q1 → 2026-Q3)", rows.length === 23));

  // Monotone first_party_share_pct rise 2022-Q1 (34) → 2024-Q4 (61).
  const shareStart = at("2022-Q1")?.first_party_share_pct;
  const shareEnd = at("2024-Q4")?.first_party_share_pct;
  let shareMonotone = shareStart === 34 && shareEnd === 61;
  if (shareMonotone) {
    for (let i = 0; i < rows.length - 1; i++) {
      const inWindow =
        rows[i].quarter >= "2022-Q1" && rows[i + 1].quarter <= "2024-Q4";
      if (inWindow && rows[i + 1].first_party_share_pct < rows[i].first_party_share_pct) {
        shareMonotone = false;
        break;
      }
    }
  }
  results.push(
    structural("S2", "monotone 1P share rise 2022-Q1 (34) → 2024-Q4 (61)", shareMonotone),
  );

  // Five consecutive negative net-income quarters 2024-Q2 → 2025-Q2.
  const lossQuarters = ["2024-Q2", "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2"];
  results.push(
    structural(
      "S3",
      "five consecutive negative net-income quarters 2024-Q2 → 2025-Q2",
      lossQuarters.every((q) => (at(q)?.net_income_usd_m ?? 0) < 0),
    ),
  );

  // Revenue plateau 2025-Q1 → Q3: each within ±2% of prior.
  const plateau = ["2025-Q1", "2025-Q2", "2025-Q3"];
  let plateauOk = true;
  for (let i = 1; i < plateau.length; i++) {
    const prev = at(plateau[i - 1])?.revenue_usd_m;
    const cur = at(plateau[i])?.revenue_usd_m;
    if (prev === undefined || cur === undefined || Math.abs(relDelta(cur, prev)) > TOL_PLATEAU) {
      plateauOk = false;
      break;
    }
  }
  results.push(structural("S4", "revenue plateau 2025-Q1 → Q3 (±2% of prior)", plateauOk));

  // Landed-cost index endpoints.
  results.push(
    structural(
      "S5",
      "landed_cost_index_electronics = 100.0 at 2024-Q1 and 118.0 at 2025-Q4",
      at("2024-Q1")?.landed_cost_index_electronics === 100.0 &&
        at("2025-Q4")?.landed_cost_index_electronics === 118.0,
    ),
  );

  // On-time delivery beats.
  results.push(
    structural(
      "S6",
      "on-time = 96.0 at 2023-Q1, 88.0 at 2025-Q3, ≥92.0 at 2026-Q2",
      at("2023-Q1")?.on_time_delivery_pct === 96.0 &&
        at("2025-Q3")?.on_time_delivery_pct === 88.0 &&
        (at("2026-Q2")?.on_time_delivery_pct ?? 0) >= 92.0,
    ),
  );

  // Net income positive from 2026-Q2.
  const recovery = ["2026-Q2", "2026-Q3"];
  results.push(
    structural(
      "S7",
      "net income positive from 2026-Q2",
      recovery.every((q) => (at(q)?.net_income_usd_m ?? 0) > 0),
    ),
  );

  return results;
}

export function formatReport(results) {
  const failures = results.filter((r) => !r.pass);
  const sorted = [...results].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const lines = [];
  lines.push("Rainforest reconciliation report");
  lines.push(`Source of truth: data/numbers-bible.json`);
  lines.push(`Checks: ${results.length}  Pass: ${results.length - failures.length}  Fail: ${failures.length}`);
  lines.push("");
  lines.push("Worst offenders first:");
  lines.push(
    `${"ID".padEnd(4)} ${"Quarter".padEnd(8)} ${"Status".padEnd(6)} ${"Delta%".padStart(9)}  Metric`,
  );
  for (const r of sorted) {
    const deltaPct = Number.isFinite(r.delta) ? (r.delta * 100).toFixed(3) : "inf";
    lines.push(
      `${r.id.padEnd(4)} ${r.quarter.padEnd(8)} ${(r.pass ? "PASS" : "FAIL").padEnd(6)} ${deltaPct.padStart(9)}  ${r.metric} (actual=${r.actual}, expected=${r.expected})`,
    );
  }
  lines.push("");
  lines.push(failures.length === 0 ? "RECONCILE: PASS" : "RECONCILE: FAIL");
  return lines.join("\n") + "\n";
}

export function run() {
  const rows = JSON.parse(readFileSync(BIBLE_PATH, "utf8"));
  const results = reconcileBible(rows);
  const report = formatReport(results);
  writeFileSync(REPORT_PATH, report);
  process.stdout.write(report);
  return results.every((r) => r.pass) ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(run());
}
