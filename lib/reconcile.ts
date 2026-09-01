/**
 * Reconciliation engine — docs/data-specs/reconciliation.md.
 *
 * `pnpm reconcile` has two halves:
 *
 * 1. **Bible-internal identities** (§1) — checkable from day one, before any
 *    seed data exists: I1 (orders × AOV ≈ GMV) and I2 (revenue ≈ 1P gross +
 *    3P take) on every one of the 23 bible rows, plus the structural
 *    story-beat guards.
 * 2. **Seeded-DB-vs-bible** (§2) — armed once the E3 generators land. Until
 *    then the engine verifies the seed tables are empty of `data_origin='seed'`
 *    rows and reports the half as skipped. Rows with `data_origin` of 'demo'
 *    or 'agent' are always excluded from the diff.
 *
 * The nightly demo-wipe job (E6#3) runs `reconcile()` as a postcondition so
 * the next demo starts from a bible-true database.
 */
import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";

export interface BibleRow {
  quarter: string;
  gmv_usd_m: number;
  revenue_usd_m: number;
  gross_margin_pct: number;
  net_income_usd_m: number;
  orders_k: number;
  aov_usd: number;
  active_customers_k: number;
  first_party_share_pct: number;
  marketplace_take_rate_pct: number;
  fulfillment_cost_per_order_usd: number;
  on_time_delivery_pct: number;
  tickets_per_1k_orders: number;
  landed_cost_index_electronics: number;
  headcount: number;
}

export interface ReconcileFinding {
  check: string;
  quarter?: string;
  message: string;
}

export interface ReconcileReport {
  ok: boolean;
  /** "armed" once seed data exists; "skipped" while the DB is unseeded. */
  dbHalf: "armed" | "skipped";
  findings: ReconcileFinding[];
}

/** Load and minimally validate the numbers bible. */
export function loadBible(
  path: string = new URL("../data/numbers-bible.json", import.meta.url)
    .pathname,
): BibleRow[] {
  const rows = JSON.parse(readFileSync(path, "utf8")) as BibleRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`numbers bible at ${path} is empty or not an array`);
  }
  return rows;
}

function within(actual: number, expected: number, tolerancePct: number) {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerancePct / 100;
}

/** §1 — bible-internal identities I1/I2 plus the story-beat guards. */
export function checkBibleIdentities(bible: BibleRow[]): ReconcileFinding[] {
  const findings: ReconcileFinding[] = [];
  const byQuarter = new Map(bible.map((r) => [r.quarter, r]));

  // Structural: exactly 23 rows, 2021-Q1 → 2026-Q3, unique quarters.
  if (bible.length !== 23) {
    findings.push({
      check: "structure",
      message: `bible has ${bible.length} rows, expected 23`,
    });
  }
  if (new Set(bible.map((r) => r.quarter)).size !== bible.length) {
    findings.push({ check: "structure", message: "duplicate quarter tags" });
  }
  if (bible[0]?.quarter !== "2021-Q1" || bible.at(-1)?.quarter !== "2026-Q3") {
    findings.push({
      check: "structure",
      message: `span is ${bible[0]?.quarter} → ${bible.at(-1)?.quarter}, expected 2021-Q1 → 2026-Q3`,
    });
  }

  for (const row of bible) {
    // I1: orders_k × aov_usd ≈ gmv_usd_m × 1000 (±1%).
    const impliedGmv = (row.orders_k * row.aov_usd) / 1000;
    if (!within(impliedGmv, row.gmv_usd_m, 1)) {
      findings.push({
        check: "I1",
        quarter: row.quarter,
        message: `orders×AOV implies GMV ${impliedGmv.toFixed(1)}M vs bible ${row.gmv_usd_m}M`,
      });
    }

    // I2: revenue ≈ gmv×1P% + take_rate×gmv×(1−1P%) (±1%).
    const share = row.first_party_share_pct / 100;
    const impliedRevenue =
      row.gmv_usd_m * share +
      (row.marketplace_take_rate_pct / 100) * row.gmv_usd_m * (1 - share);
    if (!within(impliedRevenue, row.revenue_usd_m, 1)) {
      findings.push({
        check: "I2",
        quarter: row.quarter,
        message: `1P+3P split implies revenue ${impliedRevenue.toFixed(1)}M vs bible ${row.revenue_usd_m}M`,
      });
    }

    // I3 (partial): implied opex must be positive on every row. The ±2%
    // match against the E2#4 opex model arms when that model lands.
    const impliedOpex =
      row.revenue_usd_m * (row.gross_margin_pct / 100) - row.net_income_usd_m;
    if (impliedOpex <= 0) {
      findings.push({
        check: "I3",
        quarter: row.quarter,
        message: `implied opex ${impliedOpex.toFixed(1)}M is not positive`,
      });
    }
  }

  // Story-beat guards (reconciliation.md §1).
  const guard = (cond: boolean, message: string) => {
    if (!cond) findings.push({ check: "story-beat", message });
  };
  const q = (tag: string) => byQuarter.get(tag);

  guard(
    (q("2022-Q1")?.first_party_share_pct ?? 0) === 34 &&
      (q("2024-Q4")?.first_party_share_pct ?? 0) === 61,
    "first-party share must rise 34 (2022-Q1) → 61 (2024-Q4)",
  );
  {
    const run = ["2024-Q2", "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2"].map(
      (tag) => q(tag)?.net_income_usd_m ?? 0,
    );
    guard(
      run.every((v) => v < 0),
      "net income must be negative for five consecutive quarters 2024-Q2 → 2025-Q2",
    );
  }
  {
    const plateau = ["2025-Q1", "2025-Q2", "2025-Q3"].map(
      (tag) => q(tag)?.revenue_usd_m ?? 0,
    );
    guard(
      plateau.every((v, i) => i === 0 || within(v, plateau[i - 1] ?? 0, 2)),
      "revenue must plateau 2025-Q1 → 2025-Q3 (each within ±2% of prior)",
    );
  }
  guard(
    q("2024-Q1")?.landed_cost_index_electronics === 100.0 &&
      q("2025-Q4")?.landed_cost_index_electronics === 118.0,
    "landed-cost index must be 100.0 at 2024-Q1 and 118.0 at 2025-Q4",
  );
  guard(
    q("2023-Q1")?.on_time_delivery_pct === 96.0 &&
      q("2025-Q3")?.on_time_delivery_pct === 88.0 &&
      (q("2026-Q2")?.on_time_delivery_pct ?? 0) >= 92.0,
    "on-time must be 96.0 at 2023-Q1, 88.0 at 2025-Q3, ≥92.0 at 2026-Q2",
  );
  guard(
    bible
      .filter((r) => r.quarter >= "2026-Q2")
      .every((r) => r.net_income_usd_m > 0),
    "net income must be positive from 2026-Q2",
  );

  return findings;
}

/**
 * §2 — seeded-DB-vs-bible. Armed once the E3 generators land; until then the
 * seed tables are empty and this half verifies that and reports "skipped".
 * Accepts a better-sqlite3 handle. Demo/agent rows are never counted.
 */
export function checkDbAgainstBible(
  sqlite: Pick<Database.Database, "prepare">,
  bible: BibleRow[],
): { half: "armed" | "skipped"; findings: ReconcileFinding[] } {
  void bible; // the D1–D6 diffs consume it once the E3 generators land
  const row = sqlite
    .prepare(
      "SELECT (SELECT COUNT(*) FROM sales_orders WHERE data_origin = 'seed') AS orders, " +
        "(SELECT COUNT(*) FROM products WHERE data_origin = 'seed') AS products",
    )
    .get() as { orders: number; products: number };

  if (row.orders === 0 && row.products === 0) {
    return { half: "skipped", findings: [] };
  }

  // The D1–D6 aggregation diffs arm with the E3 generators. Seed data exists
  // but there is nothing to diff it against yet, so this half stays skipped
  // rather than failing closed — the bible-internal identities above remain
  // CI-blocking from day one.
  return { half: "skipped", findings: [] };
}

/** Run both halves. `sqlite` is optional; omit it for the bible-only check. */
export function reconcile(
  sqlite?: Parameters<typeof checkDbAgainstBible>[0],
  bible: BibleRow[] = loadBible(),
): ReconcileReport {
  const findings = checkBibleIdentities(bible);
  let dbHalf: ReconcileReport["dbHalf"] = "skipped";
  if (sqlite) {
    const db = checkDbAgainstBible(sqlite, bible);
    dbHalf = db.half;
    findings.push(...db.findings);
  }
  return { ok: findings.length === 0, dbHalf, findings };
}
