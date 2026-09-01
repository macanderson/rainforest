/**
 * Numbers-bible loader and typed accessor (E2#2).
 *
 * Parses `data/numbers-bible.json` into typed `QuarterRow[]` and exposes
 * per-quarter targets to the seed generators, the financial reports, and the
 * reconciliation engine. This module is the **only** module that reads the
 * JSON directly — every consumer goes through `loadNumbersBible()` /
 * `numbersBible()` / `quarterRow()`.
 *
 * The loader fails the build (throws `BibleValidationError`) when the bible
 * violates its own bible-internal identities from
 * docs/data-specs/reconciliation.md §1:
 *
 * - I1: `orders_k × aov_usd ≈ gmv_usd_m × 1000` (±1%)
 * - I2: `revenue ≈ gmv × 1P% + take_rate × gmv × (1 − 1P%)` (±1%)
 *
 * plus the structural contract: exactly 23 rows, unique quarter tags,
 * spanning 2021-Q1 → 2026-Q3.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

export const BIBLE_PATH = new URL(
  "../data/numbers-bible.json",
  import.meta.url,
).pathname;

export const BIBLE_ROW_COUNT = 23;
export const BIBLE_FIRST_QUARTER = "2021-Q1";
export const BIBLE_LAST_QUARTER = "2026-Q3";

/** Relative tolerance (±1%) for the I1/I2 identities, per reconciliation.md §1. */
export const IDENTITY_TOLERANCE_PCT = 1;

const quarterTagSchema = z
  .string()
  .regex(/^\d{4}-Q[1-4]$/, "quarter tags look like 2024-Q4");

/** All 15 bible columns, strict — an unknown column is a malformed bible. */
export const quarterRowSchema = z
  .object({
    quarter: quarterTagSchema,
    gmv_usd_m: z.number().positive(),
    revenue_usd_m: z.number().positive(),
    gross_margin_pct: z.number(),
    net_income_usd_m: z.number(),
    orders_k: z.number().positive(),
    aov_usd: z.number().positive(),
    active_customers_k: z.number().positive(),
    first_party_share_pct: z.number().min(0).max(100),
    marketplace_take_rate_pct: z.number().min(0).max(100),
    fulfillment_cost_per_order_usd: z.number().positive(),
    on_time_delivery_pct: z.number().min(0).max(100),
    tickets_per_1k_orders: z.number().nonnegative(),
    landed_cost_index_electronics: z.number().positive(),
    headcount: z.number().int().positive(),
  })
  .strict();

export const numbersBibleSchema = z.array(quarterRowSchema);

export type QuarterRow = z.infer<typeof quarterRowSchema>;

/** Raised when the bible fails schema, structure, or identity validation. */
export class BibleValidationError extends Error {
  readonly diagnostics: string[];

  constructor(diagnostics: string[]) {
    super(`numbers bible is invalid:\n${diagnostics.map((d) => `  - ${d}`).join("\n")}`);
    this.name = "BibleValidationError";
    this.diagnostics = diagnostics;
  }
}

function within(actual: number, expected: number, tolerancePct: number) {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerancePct / 100;
}

/** I1: orders_k × aov_usd ≈ gmv_usd_m × 1000 (±1%). */
export function impliedGmvUsdM(row: QuarterRow): number {
  return (row.orders_k * row.aov_usd) / 1000;
}

/** I2: revenue ≈ gmv × 1P% + take_rate × gmv × (1 − 1P%) (±1%). */
export function impliedRevenueUsdM(row: QuarterRow): number {
  const share = row.first_party_share_pct / 100;
  return (
    row.gmv_usd_m * share +
    (row.marketplace_take_rate_pct / 100) * row.gmv_usd_m * (1 - share)
  );
}

/** Collect every I1/I2 violation; empty array means the bible is self-consistent. */
export function checkIdentityDiagnostics(rows: QuarterRow[]): string[] {
  const diagnostics: string[] = [];
  for (const row of rows) {
    const gmv = impliedGmvUsdM(row);
    if (!within(gmv, row.gmv_usd_m, IDENTITY_TOLERANCE_PCT)) {
      diagnostics.push(
        `I1 violated at ${row.quarter}: orders_k × aov_usd implies GMV ${gmv.toFixed(1)}M ` +
          `vs bible ${row.gmv_usd_m}M (outside ±${IDENTITY_TOLERANCE_PCT}%)`,
      );
    }
    const revenue = impliedRevenueUsdM(row);
    if (!within(revenue, row.revenue_usd_m, IDENTITY_TOLERANCE_PCT)) {
      diagnostics.push(
        `I2 violated at ${row.quarter}: 1P gross + 3P take implies revenue ${revenue.toFixed(1)}M ` +
          `vs bible ${row.revenue_usd_m}M (outside ±${IDENTITY_TOLERANCE_PCT}%)`,
      );
    }
  }
  return diagnostics;
}

/** Structural contract: 23 rows, unique tags, 2021-Q1 → 2026-Q3. */
export function checkStructureDiagnostics(rows: QuarterRow[]): string[] {
  const diagnostics: string[] = [];
  if (rows.length !== BIBLE_ROW_COUNT) {
    diagnostics.push(
      `bible has ${rows.length} rows, expected exactly ${BIBLE_ROW_COUNT}`,
    );
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.quarter)) {
      diagnostics.push(`duplicate quarter tag ${row.quarter}`);
    }
    seen.add(row.quarter);
  }
  if (
    rows[0]?.quarter !== BIBLE_FIRST_QUARTER ||
    rows.at(-1)?.quarter !== BIBLE_LAST_QUARTER
  ) {
    diagnostics.push(
      `span is ${rows[0]?.quarter} → ${rows.at(-1)?.quarter}, ` +
        `expected ${BIBLE_FIRST_QUARTER} → ${BIBLE_LAST_QUARTER}`,
    );
  }
  return diagnostics;
}

/**
 * Parse, Zod-validate, and identity-check the numbers bible. Throws
 * `BibleValidationError` — failing the build — on any schema violation, any
 * structural violation, or any I1/I2 breach.
 */
export function loadNumbersBible(path: string = BIBLE_PATH): QuarterRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new BibleValidationError([
      `cannot read or parse ${path}: ${(cause as Error).message}`,
    ]);
  }

  const parsed = numbersBibleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BibleValidationError(
      parsed.error.issues.map(
        (issue) => `row ${issue.path.join(".") || "<root>"}: ${issue.message}`,
      ),
    );
  }

  const rows = parsed.data;
  const diagnostics = [
    ...checkStructureDiagnostics(rows),
    ...checkIdentityDiagnostics(rows),
  ];
  if (diagnostics.length > 0) {
    throw new BibleValidationError(diagnostics);
  }
  return rows;
}

let cache: QuarterRow[] | undefined;

/** The committed numbers bible, loaded and validated once per process. */
export function numbersBible(): QuarterRow[] {
  cache ??= loadNumbersBible();
  return cache;
}

/** Per-quarter targets by quarter tag — the accessor generators/reports use. */
export function quarterRow(tag: string): QuarterRow {
  const row = numbersBible().find((r) => r.quarter === tag);
  if (!row) {
    throw new Error(
      `unknown quarter tag ${tag}; bible spans ${BIBLE_FIRST_QUARTER} → ${BIBLE_LAST_QUARTER}`,
    );
  }
  return row;
}

/** All 23 quarter tags in bible order. */
export function quarterTags(): string[] {
  return numbersBible().map((r) => r.quarter);
}
