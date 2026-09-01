/**
 * Quarterly P&L derivation layer (E2#4).
 *
 * Derives the income-statement lines — revenue, COGS (via `gross_margin_pct`),
 * gross profit, modeled opex, and net income — from the numbers bible for the
 * financial-reports UI (E4#7). Every figure is sourced **exclusively** from
 * the typed bible loader (#16, `lib/numbers-bible.ts`); nothing in this layer
 * restates a number, so the rendered P&L matches RAINFOREST.md §8 by
 * construction (§8 is generated from the same bible).
 *
 * The derivation, per quarter row (all money in USD millions):
 *
 *   revenue      = revenue_usd_m                        (bible column, I2-checked by the loader)
 *   gross_profit = revenue × gross_margin_pct / 100
 *   cogs         = revenue − gross_profit               (cost of revenue)
 *   opex         = gross_profit − net_income            (the modeled opex schedule — see below)
 *   net_income   = net_income_usd_m                     (bible column)
 *
 * **Modeled opex schedule (identity I3, docs/data-specs/reconciliation.md §1):**
 * opex is the implied wedge `revenue × gross_margin_pct − net_income`. It is
 * not an independent input — it is whatever operating spend makes the
 * bible's revenue, margin, and net-income columns mutually consistent. The
 * schedule is explicit in `deriveQuarterPnl` and must be **positive on every
 * one of the 23 rows**; the reconciliation engine (E2#3) validates the
 * bible's implied opex against this model within ±2%.
 *
 * Annual FY rollups (FY2021–FY2025, plus FY2026 year-to-date) are derived
 * from the same quarterly rows: flow lines sum, blended gross margin is
 * gross_profit / revenue, and headcount is the year-end (Q4) figure — exactly
 * the convention RAINFOREST.md §8.2 states.
 */
import { numbersBible, type QuarterRow } from "./numbers-bible.ts";

/** One quarter of derived income-statement lines, all USD millions. */
export interface QuarterlyPnl {
  quarter: string;
  /** Bible revenue column (1P gross + 3P take, per identity I2). */
  revenue_usd_m: number;
  /** Cost of revenue: `revenue × (1 − gross_margin_pct/100)`. */
  cogs_usd_m: number;
  /** `revenue × gross_margin_pct/100`. */
  gross_profit_usd_m: number;
  /** Bible gross-margin column, echoed for the UI. */
  gross_margin_pct: number;
  /**
   * Modeled opex schedule (identity I3):
   * `revenue × gross_margin_pct/100 − net_income`. Positive on all 23 rows.
   */
  opex_usd_m: number;
  /** Bible net-income column. */
  net_income_usd_m: number;
}

/** One fiscal-year rollup derived from the quarterly rows. */
export interface AnnualPnl {
  /** e.g. "FY2024". */
  fiscal_year: string;
  /** Quarter tags that went into the rollup (4 for full years, 3 for FY2026 YTD). */
  quarters: string[];
  gmv_usd_m: number;
  revenue_usd_m: number;
  cogs_usd_m: number;
  gross_profit_usd_m: number;
  /** Blended margin: `gross_profit / revenue × 100` (not an average of quarterly margins). */
  gross_margin_pct: number;
  /** Implied opex wedge, summed: `gross_profit − net_income`. */
  opex_usd_m: number;
  net_income_usd_m: number;
  /** Year-end (Q4) headcount; `null` for a partial year with no Q4 row yet. */
  headcount_year_end: number | null;
}

/** The shape the financial-reports UI (E4#7) consumes. */
export interface PnlReport {
  quarterly: QuarterlyPnl[];
  annual: AnnualPnl[];
}

/** The minimal bible columns the derivation reads — nothing else. */
type PnlSourceRow = Pick<
  QuarterRow,
  "quarter" | "revenue_usd_m" | "gross_margin_pct" | "net_income_usd_m"
>;

/**
 * Derive one quarter's income-statement lines from a bible row. This is the
 * single source of the opex schedule — reconciliation's I3 check validates
 * against this function, so the model and the gate can never drift apart.
 */
export function deriveQuarterPnl(row: PnlSourceRow): QuarterlyPnl {
  const gross_profit_usd_m = (row.revenue_usd_m * row.gross_margin_pct) / 100;
  const cogs_usd_m = row.revenue_usd_m - gross_profit_usd_m;
  // Identity I3: the modeled opex schedule is the implied wedge
  // `revenue × gross_margin_pct − net_income`, positive on every row.
  const opex_usd_m = gross_profit_usd_m - row.net_income_usd_m;
  return {
    quarter: row.quarter,
    revenue_usd_m: row.revenue_usd_m,
    cogs_usd_m,
    gross_profit_usd_m,
    gross_margin_pct: row.gross_margin_pct,
    opex_usd_m,
    net_income_usd_m: row.net_income_usd_m,
  };
}

/** The full 23-quarter series, in bible order (2021-Q1 → 2026-Q3). */
export function quarterlyPnlSeries(
  rows: QuarterRow[] = numbersBible(),
): QuarterlyPnl[] {
  return rows.map(deriveQuarterPnl);
}

/**
 * Roll the quarterly rows up to fiscal years (the calendar year of the
 * quarter tag). Flow lines sum; blended gross margin is derived from the
 * summed lines; headcount is the Q4 (year-end) figure, or `null` when the
 * year has no Q4 row yet (FY2026 is a three-quarter year-to-date rollup).
 */
export function annualPnlRollups(
  rows: QuarterRow[] = numbersBible(),
): AnnualPnl[] {
  const byYear = new Map<string, QuarterRow[]>();
  for (const row of rows) {
    const year = row.quarter.slice(0, 4);
    const bucket = byYear.get(year) ?? [];
    bucket.push(row);
    byYear.set(year, bucket);
  }

  const annual: AnnualPnl[] = [];
  for (const [year, yearRows] of [...byYear.entries()].sort()) {
    const pnl = yearRows.map(deriveQuarterPnl);
    const sum = (f: (p: QuarterlyPnl) => number) =>
      pnl.reduce((acc, p) => acc + f(p), 0);
    const revenue = sum((p) => p.revenue_usd_m);
    const grossProfit = sum((p) => p.gross_profit_usd_m);
    const q4 = yearRows.find((r) => r.quarter.endsWith("-Q4"));
    annual.push({
      fiscal_year: `FY${year}`,
      quarters: yearRows.map((r) => r.quarter),
      gmv_usd_m: yearRows.reduce((acc, r) => acc + r.gmv_usd_m, 0),
      revenue_usd_m: revenue,
      cogs_usd_m: sum((p) => p.cogs_usd_m),
      gross_profit_usd_m: grossProfit,
      gross_margin_pct: revenue > 0 ? (100 * grossProfit) / revenue : 0,
      opex_usd_m: sum((p) => p.opex_usd_m),
      net_income_usd_m: sum((p) => p.net_income_usd_m),
      headcount_year_end: q4?.headcount ?? null,
    });
  }
  return annual;
}

/**
 * The P&L output shape for the financial-reports UI (E4#7): the 23-quarter
 * derived series plus the annual snapshots (FY2021–FY2025 full years and the
 * FY2026 year-to-date rollup), all from the same bible rows.
 */
export function pnlReport(rows: QuarterRow[] = numbersBible()): PnlReport {
  return {
    quarterly: quarterlyPnlSeries(rows),
    annual: annualPnlRollups(rows),
  };
}
