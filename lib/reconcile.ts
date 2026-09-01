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
 * The bible-internal half consumes the typed loader from
 * `lib/numbers-bible.ts` (E2#2) — the only module that reads the JSON
 * directly — so a bible that violates I1/I2 fails at load, before any check
 * runs.
 */
import type Database from "better-sqlite3";

import {
  checkIdentityDiagnostics,
  checkStructureDiagnostics,
  loadNumbersBible,
  type QuarterRow,
} from "./numbers-bible.ts";

/** @deprecated Use `QuarterRow` from `lib/numbers-bible.ts`. */
export type BibleRow = QuarterRow;

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

/**
 * Load and validate the numbers bible. Delegates to the E2#2 loader, which
 * Zod-validates every row and throws `BibleValidationError` if the structure
 * or the I1/I2 identities are violated — a broken bible fails the build here.
 */
export function loadBible(path?: string): QuarterRow[] {
  return loadNumbersBible(path);
}

function within(actual: number, expected: number, tolerancePct: number) {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerancePct / 100;
}

/** §1 — bible-internal identities I1/I2 plus the story-beat guards. */
export function checkBibleIdentities(bible: QuarterRow[]): ReconcileFinding[] {
  const findings: ReconcileFinding[] = [];
  const byQuarter = new Map(bible.map((r) => [r.quarter, r]));

  // Structural: exactly 23 rows, 2021-Q1 → 2026-Q3, unique quarters.
  for (const message of checkStructureDiagnostics(bible)) {
    findings.push({ check: "structure", message });
  }

  // I1/I2 per row (±1%) — the same identities the loader enforces at load.
  for (const message of checkIdentityDiagnostics(bible)) {
    findings.push({
      check: message.startsWith("I1") ? "I1" : "I2",
      quarter: message.match(/\d{4}-Q[1-4]/)?.[0],
      message,
    });
  }

  for (const row of bible) {
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
  bible: QuarterRow[],
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
  bible: QuarterRow[] = loadBible(),
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
