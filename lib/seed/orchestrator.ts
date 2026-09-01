/**
 * Master seed orchestrator — issue #20 (E3#1, plan §4.4).
 *
 * The single engine behind `pnpm seed`. It walks every quarter of the
 * numbers bible (2021-Q1 → 2026-Q3, 23 rows) in order and invokes each
 * registered domain generator (E3#2–#6) with that quarter's typed bible
 * row, so the entire synthetic history is reproducible from one seed and
 * one canonical source of truth.
 *
 * Guarantees (the issue's acceptance checklist):
 *
 * - **Deterministic.** One root seed (DEFAULT_SEED, overridable via
 *   `--seed`/`SEED`) feeds every generator through named sub-streams
 *   (lib/seed.ts). Two runs with the same seed produce identical database
 *   contents. Generators must derive every timestamp from the quarter tag
 *   (see {@link quarterWindow}) and every random draw from their named
 *   stream — never `Date.now()` or `Math.random()`.
 * - **Bible-mediated.** Generators receive the typed {@link BibleRow} via
 *   the loader in lib/reconcile.ts (E2#2); nothing reads the JSON directly.
 * - **Idempotent wipe-and-reseed.** Before generating, the orchestrator
 *   deletes every `data_origin='seed'` row in FK-safe order (children
 *   before parents, reusing the demo-wipe ordering) plus the seed rows of
 *   the job ledgers, and resets each wiped table's AUTOINCREMENT sequence,
 *   so a re-run leaves no duplicates, no orphans, and byte-identical
 *   contents — rowids included. `demo` and `agent` rows are never touched.
 * - **Quarter-tagged.** Every seeded row carries `data_origin='seed'`,
 *   `created_at`/`updated_at` (shared column defaults), and a quarter tag
 *   relative to the DEMO_EPOCH anchor — reconciliation buckets by tag, so
 *   the daily +1-day clock-shift job (E6#2) can never break it
 *   (architecture.md §8).
 * - **Dependency-ordered.** Generators run in registration order; the
 *   built-in sequence is suppliers → warehouses → categories → products →
 *   stock_levels → purchase orders → sales orders → shipments → tickets,
 *   so no generator ever references a row that does not exist yet.
 *
 * System writer: like the clock-shift and demo-wipe jobs, the orchestrator
 * writes through better-sqlite3 prepared statements with explicit origins,
 * bypassing the lib/db/session.ts `insertRow` stamp (there is no
 * interactive session during a seed). It is allowlisted in the raw-insert
 * scan.
 */
import type Database from "better-sqlite3";

import { loadBible, reconcile, type BibleRow } from "../reconcile.ts";
import { createSeedContext, DEFAULT_SEED, type SeedContext } from "../seed.ts";

export { DEFAULT_SEED };

/** The quarter tag shape the schema enforces, e.g. `2025-Q3`. */
export const QUARTER_TAG_RE = /^\d{4}-Q[1-4]$/;

/**
 * Seed tables in FK-safe deletion order (children before parents), aligned
 * with the demo-wipe ordering (lib/db/demo-wipe.ts WIPE_ORDER) minus the
 * ledgers, which the orchestrator handles separately.
 */
export const SEED_WIPE_ORDER = [
  "support_tickets",
  "shipments",
  "sales_order_lines",
  "sales_orders",
  "purchase_order_lines",
  "purchase_orders",
  "stock_levels",
  "products",
  "categories",
  "warehouses",
  "suppliers",
] as const;

/**
 * One quarter of work handed to a domain generator: the tag, the typed
 * bible row (never the raw JSON), and the generator's named RNG stream.
 */
export interface QuarterInput {
  /** Quarter tag, e.g. `2025-Q3` — DEMO_EPOCH-relative (architecture §8). */
  quarter: string;
  /** This quarter's canonical targets from the numbers bible. */
  bible: BibleRow;
  /** Deterministic stream derived from the root seed + generator name. */
  rng: () => number;
}

/**
 * The common interface every domain generator (E3#2–#6) registers against:
 * quarter tag + bible row in, rows out (via the handle's insert helpers).
 */
export interface DomainGenerator {
  /** Stable name — also the RNG sub-stream key, so draws survive reordering. */
  name: string;
  /**
   * Tables this generator wipes and reseeds, in FK-safe deletion order.
   * The orchestrator wipes the union of all registered tables before the
   * walk; declaring them keeps reseeds free of duplicates and orphans.
   */
  tables: readonly string[];
  /** Generate this quarter's rows. */
  generateQuarter(handle: SeedHandle, input: QuarterInput): void;
}

/** Insert handle passed to generators — stamps the shared seed columns. */
export interface SeedHandle {
  /**
   * Insert one row into `table`. `data_origin='seed'` is stamped
   * automatically; `created_at`/`updated_at` default at the database layer
   * (lib/db/columns.ts). Returns the new rowid.
   */
  insert(table: string, row: Record<string, unknown>): number;
}

export interface SeedRunSummary {
  seed: number;
  quarters: string[];
  rowsByTable: Record<string, number>;
  totalRows: number;
  wipedRows: number;
  /** Postcondition: the seeded database reconciles against the bible. */
  reconcile: { ok: boolean; dbHalf: "armed" | "skipped"; findings: number };
}

/**
 * The inclusive UTC window (epoch ms) a quarter tag maps to, anchored to
 * the DEMO_EPOCH convention (architecture.md §8): quarter tags are the
 * canonical calendar quarters of the tag itself, so `2025-Q3` is
 * 2025-07-01T00:00:00Z → 2025-10-01T00:00:00Z. Generators derive every
 * timestamp from this window — never from the wall clock — so the
 * clock-shift job moving timestamps +1 day can never move a row across a
 * reconciliation bucket boundary (reconcile buckets by tag, not time).
 */
export function quarterWindow(quarter: string): { startMs: number; endMs: number } {
  const match = QUARTER_TAG_RE.exec(quarter);
  if (!match) throw new Error(`invalid quarter tag: ${quarter}`);
  const year = Number(quarter.slice(0, 4));
  const q = Number(quarter.slice(6));
  const startMs = Date.UTC(year, (q - 1) * 3, 1);
  const endMs = Date.UTC(year, q * 3, 1);
  return { startMs, endMs };
}

/** Delete every `data_origin='seed'` row, children before parents. */
export function wipeSeedRows(
  sqlite: Database.Database,
  tables: readonly string[] = SEED_WIPE_ORDER,
): number {
  let wiped = 0;
  const run = sqlite.transaction(() => {
    for (const table of tables) {
      wiped += sqlite
        .prepare(`DELETE FROM ${table} WHERE data_origin = 'seed'`)
        .run().changes;
    }
    // The job ledgers are origin-stamped too; their seed rows are seed-run
    // residue, so a reseed starts them clean as well.
    for (const ledger of ["job_runs", "job_run_ledger"] as const) {
      wiped += sqlite
        .prepare(`DELETE FROM ${ledger} WHERE data_origin = 'seed'`)
        .run().changes;
    }
    // Reset AUTOINCREMENT sequences for fully-wiped tables so a reseed
    // reproduces the same rowids — without this, determinism holds only
    // for the first run on a fresh database. A table that still holds
    // demo/agent rows keeps its sequence (resetting it could reissue an
    // id those rows' FKs already reference).
    const sequences = sqlite
      .prepare("SELECT name FROM sqlite_sequence")
      .all() as { name: string }[];
    for (const table of [...tables, "job_runs", "job_run_ledger"]) {
      const remaining = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      if (remaining.n === 0 && sequences.some((s) => s.name === table)) {
        sqlite.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(table);
      }
    }
  });
  run();
  return wiped;
}

/**
 * Run the full seed: wipe prior seed rows, then walk every bible quarter in
 * order, invoking each registered generator per quarter. The whole run is
 * one transaction — a generator failure leaves the database untouched.
 */
export function runSeed(
  sqlite: Database.Database,
  options: {
    seed?: number | string;
    generators?: readonly DomainGenerator[];
    bible?: BibleRow[];
  } = {},
): SeedRunSummary {
  const ctx: SeedContext = createSeedContext(options.seed ?? DEFAULT_SEED);
  const bible = options.bible ?? loadBible();
  const generators = options.generators ?? [];

  const tables = dedupeTables(generators);
  const counts = new Map<string, number>();

  // One prepared statement per table + column-set, not per row. A full seed
  // inserts ~700k rows; preparing a statement for each held every one of them
  // alive and cost 5.6GB of peak memory — more than the demo host has. The
  // shapes repeat (a generator writes the same columns every time), so the
  // cache stays small.
  const statements = new Map<string, Database.Statement>();
  const handle: SeedHandle = {
    insert(table, row) {
      const columns = Object.keys(row);
      const key = `${table}|${columns.join(",")}`;
      let stmt = statements.get(key);
      if (!stmt) {
        stmt = sqlite.prepare(
          `INSERT INTO ${table} (${columns.join(", ")}, data_origin) ` +
            `VALUES (${columns.map(() => "?").join(", ")}, 'seed')`,
        );
        statements.set(key, stmt);
      }
      const id = stmt.run(...columns.map((c) => row[c] as never))
        .lastInsertRowid as number;
      counts.set(table, (counts.get(table) ?? 0) + 1);
      return id;
    },
  };

  let wipedRows = 0;
  sqlite.transaction(() => {
    wipedRows = wipeSeedRows(sqlite, tables);
    for (const row of bible) {
      for (const generator of generators) {
        generator.generateQuarter(handle, {
          quarter: row.quarter,
          bible: row,
          rng: ctx.stream(generator.name),
        });
      }
    }
  })();

  // Postcondition: the seeded database must reconcile against the bible
  // (reconciliation.md). A broken bible or a mis-tagged row is fatal — those
  // mean the seed itself is wrong.
  //
  // The DB-vs-bible diffs (D*) are reported but not fatal while the domain
  // generators are still landing: the backbone deliberately ships before the
  // supplier-SLA and fulfillment generators that calibrate lateness and order
  // value, so drift here is the expected state, not a defect. E3#7 is the
  // issue that drives that drift under tolerance, and arming this is its
  // acceptance criterion — flip `dbHalfFatal` there, not before.
  const dbHalfFatal = false;
  const report = reconcile(sqlite, bible);
  const fatal = report.findings.filter(
    (f) => dbHalfFatal || !f.check.startsWith("D"),
  );
  const advisory = report.findings.filter((f) => !fatal.includes(f));
  if (fatal.length > 0) {
    const message = fatal
      .map((f) => `[${f.check}]${f.quarter ? ` ${f.quarter}:` : ""} ${f.message}`)
      .join("; ");
    throw new Error(`seed reconcile postcondition failed: ${message}`);
  }
  if (advisory.length > 0) {
    console.warn(
      `seed: ${advisory.length} DB-vs-bible drift finding(s) — expected until the ` +
        `domain generators land (E3#7 drives these under tolerance)`,
    );
  }

  return {
    seed: ctx.seed,
    quarters: bible.map((r) => r.quarter),
    rowsByTable: Object.fromEntries(counts),
    totalRows: [...counts.values()].reduce((a, b) => a + b, 0),
    wipedRows,
    reconcile: {
      ok: report.ok,
      dbHalf: report.dbHalf,
      findings: report.findings.length,
    },
  };
}

function dedupeTables(generators: readonly DomainGenerator[]): string[] {
  const declared = new Set(generators.flatMap((g) => g.tables));
  // Keep the canonical FK-safe order; a generator may declare any subset.
  const ordered = SEED_WIPE_ORDER.filter((t) => declared.has(t));
  return ordered.length > 0 ? ordered : [...SEED_WIPE_ORDER];
}
