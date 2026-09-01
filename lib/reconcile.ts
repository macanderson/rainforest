/**
 * Reconciliation engine — docs/data-specs/reconciliation.md.
 *
 * `pnpm reconcile` has two halves:
 *
 * 1. **Bible-internal identities** (§1) — checkable from day one, before any
 *    seed data exists: I1 (orders × AOV ≈ GMV) and I2 (revenue ≈ 1P gross +
 *    3P take) on every one of the 23 bible rows, plus the structural
 *    story-beat guards.
 * 2. **Seeded-DB-vs-bible** (§2) — aggregates the seeded database per quarter
 *    tag (never wall-clock date, so the E6#2 clock-shift job can never break
 *    it) and diffs D1–D6 against the bible within ±2% relative. Rows with
 *    `data_origin` of 'demo' or 'agent' are always excluded from the diff.
 *    The half is armed as soon as any `data_origin='seed'` sales order or
 *    support ticket exists; before that it reports "skipped".
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

/** One cell of the drift report: a metric in a quarter, bible vs DB. */
export interface DriftCell {
  check: string;
  metric: string;
  quarter: string;
  bible: number;
  db: number;
  /** Relative drift, (db − bible) / bible; 0 when both are zero. */
  driftPct: number;
  pass: boolean;
}

export interface ReconcileReport {
  ok: boolean;
  /** "armed" once seed data exists; "skipped" while the DB is unseeded. */
  dbHalf: "armed" | "skipped";
  findings: ReconcileFinding[];
  /** Per quarter × metric drift cells (empty while the DB half is skipped). */
  cells: DriftCell[];
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

/** Relative drift in percent, (actual − expected) / expected × 100. */
function driftPct(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 0 : 100;
  return ((actual - expected) / Math.abs(expected)) * 100;
}

/**
 * The E2#4 revenue derivation shape: 1P gross + 3P take. This is the single
 * source of the formula — the bible-internal identity I2 and the DB-side
 * metric D1 both consume it, so the two halves can never disagree about what
 * "revenue" means. All money inputs are in the same unit (e.g. USD millions).
 */
export function deriveRevenue(
  gmv: number,
  firstPartySharePct: number,
  takeRatePct: number,
): number {
  const share = firstPartySharePct / 100;
  return gmv * share + (takeRatePct / 100) * gmv * (1 - share);
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

    // I2: revenue ≈ gmv×1P% + take_rate×gmv×(1−1P%) (±1%) — the E2#4
    // derivation shape, shared with the DB-side D1 metric.
    const impliedRevenue = deriveRevenue(
      row.gmv_usd_m,
      row.first_party_share_pct,
      row.marketplace_take_rate_pct,
    );
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

/** The §2 metric table: D1–D6, all ±2% relative. */
const DB_TOLERANCE_PCT = 2;

interface QuarterAggregate {
  quarter: string;
  orders: number;
  gmvCents: number;
  shipments: number;
  lateShipments: number;
  tickets: number;
}

/**
 * §2 — seeded-DB-vs-bible. Aggregates the seeded database per quarter tag
 * (DEMO_EPOCH-relative, never wall-clock date — the E6#2 clock-shift job
 * moves timestamps but never tags, so it can never break reconciliation) and
 * diffs D1–D6 against the bible within ±2% relative. Only `data_origin='seed'`
 * rows are counted; 'demo' and 'agent' rows are excluded from the diff.
 * Accepts a better-sqlite3 handle.
 */
export function checkDbAgainstBible(
  sqlite: Pick<Database.Database, "prepare">,
  bible: BibleRow[],
): { half: "armed" | "skipped"; findings: ReconcileFinding[]; cells: DriftCell[] } {
  // Aggregate per quarter tag in three passes (orders, shipments, tickets),
  // each filtered to data_origin='seed' at the row that carries the tag.
  const orders = sqlite
    .prepare(
      "SELECT quarter_tag AS quarter, COUNT(*) AS orders, SUM(total_cents) AS gmvCents " +
        "FROM sales_orders WHERE data_origin = 'seed' GROUP BY quarter_tag",
    )
    .all() as { quarter: string; orders: number; gmvCents: number }[];
  const shipments = sqlite
    .prepare(
      "SELECT quarter_tag AS quarter, COUNT(*) AS shipments, SUM(is_late) AS lateShipments " +
        "FROM shipments WHERE data_origin = 'seed' GROUP BY quarter_tag",
    )
    .all() as { quarter: string; shipments: number; lateShipments: number }[];
  const tickets = sqlite
    .prepare(
      "SELECT quarter_tag AS quarter, COUNT(*) AS tickets " +
        "FROM support_tickets WHERE data_origin = 'seed' GROUP BY quarter_tag",
    )
    .all() as { quarter: string; tickets: number }[];

  const byQuarter = new Map<string, QuarterAggregate>();
  const bucket = (tag: string): QuarterAggregate => {
    let agg = byQuarter.get(tag);
    if (!agg) {
      agg = {
        quarter: tag,
        orders: 0,
        gmvCents: 0,
        shipments: 0,
        lateShipments: 0,
        tickets: 0,
      };
      byQuarter.set(tag, agg);
    }
    return agg;
  };
  for (const r of orders) {
    const agg = bucket(r.quarter);
    agg.orders = r.orders;
    agg.gmvCents = r.gmvCents ?? 0;
  }
  for (const r of shipments) {
    const agg = bucket(r.quarter);
    agg.shipments = r.shipments;
    agg.lateShipments = r.lateShipments ?? 0;
  }
  for (const r of tickets) {
    bucket(r.quarter).tickets = r.tickets;
  }

  if (byQuarter.size === 0) {
    // No seed rows yet — the half stays skipped so the engine is useful
    // (bible-internal identities only) before any seed data exists.
    return { half: "skipped", findings: [], cells: [] };
  }

  const findings: ReconcileFinding[] = [];
  const cells: DriftCell[] = [];
  const bibleByQuarter = new Map(bible.map((r) => [r.quarter, r]));

  const diff = (
    check: string,
    metric: string,
    quarter: string,
    dbValue: number,
    bibleValue: number,
  ) => {
    const pass = within(dbValue, bibleValue, DB_TOLERANCE_PCT);
    cells.push({
      check,
      metric,
      quarter,
      bible: bibleValue,
      db: dbValue,
      driftPct: driftPct(dbValue, bibleValue),
      pass,
    });
    if (!pass) {
      findings.push({
        check,
        quarter,
        message:
          `${metric}: DB ${dbValue.toFixed(4)} vs bible ${bibleValue} ` +
          `(drift ${driftPct(dbValue, bibleValue).toFixed(2)}%, tolerance ±${DB_TOLERANCE_PCT}%)`,
      });
    }
  };

  for (const tag of [...byQuarter.keys()].sort()) {
    const agg = byQuarter.get(tag)!;
    const row = bibleByQuarter.get(tag);
    if (!row) {
      findings.push({
        check: "D0",
        quarter: tag,
        message: `seed rows carry quarter tag ${tag} which is not in the bible`,
      });
      continue;
    }

    const gmvM = agg.gmvCents / 100 / 1_000_000;
    const ordersK = agg.orders / 1000;
    const aov = agg.orders > 0 ? agg.gmvCents / 100 / agg.orders : 0;
    // D1 uses the E2#4 derivation shape (1P gross + 3P take) — the same
    // deriveRevenue the bible-internal identity I2 checks against.
    const revenueM = deriveRevenue(
      gmvM,
      row.first_party_share_pct,
      row.marketplace_take_rate_pct,
    );
    const onTimePct =
      agg.shipments > 0
        ? (100 * (agg.shipments - agg.lateShipments)) / agg.shipments
        : 0;
    const ticketsPer1k = agg.orders > 0 ? (1000 * agg.tickets) / agg.orders : 0;

    diff("D1", "revenue_usd_m", tag, revenueM, row.revenue_usd_m);
    diff("D2", "orders_k", tag, ordersK, row.orders_k);
    diff("D3", "aov_usd", tag, aov, row.aov_usd);
    diff("D4", "gmv_usd_m", tag, gmvM, row.gmv_usd_m);
    diff("D5", "on_time_delivery_pct", tag, onTimePct, row.on_time_delivery_pct);
    diff("D6", "tickets_per_1k_orders", tag, ticketsPer1k, row.tickets_per_1k_orders);
  }

  return { half: "armed", findings, cells };
}

/** Run both halves. `sqlite` is optional; omit it for the bible-only check. */
export function reconcile(
  sqlite?: Parameters<typeof checkDbAgainstBible>[0],
  bible: BibleRow[] = loadBible(),
  opts: { skipIdentities?: boolean } = {},
): ReconcileReport {
  const findings = opts.skipIdentities ? [] : checkBibleIdentities(bible);
  let dbHalf: ReconcileReport["dbHalf"] = "skipped";
  let cells: DriftCell[] = [];
  if (sqlite) {
    const db = checkDbAgainstBible(sqlite, bible);
    dbHalf = db.half;
    cells = db.cells;
    findings.push(...db.findings);
  }
  return { ok: findings.length === 0, dbHalf, findings, cells };
}
