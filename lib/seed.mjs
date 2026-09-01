#!/usr/bin/env node
/**
 * `pnpm seed` — the master seed orchestrator entry point (issue #20, E3#1).
 *
 * Walks every quarter of the numbers bible (2021-Q1 → 2026-Q3) in order,
 * invoking each registered domain generator (lib/seed/generators.ts) with
 * that quarter's typed bible row, so the entire synthetic history is
 * reproducible from one seed and one canonical source of truth.
 *
 * Guarantees:
 * - **Deterministic:** fixed default seed (DEFAULT_SEED), overridable via
 *   `--seed <n>` or `SEED=<n>`; same seed → identical database contents.
 * - **Idempotent:** re-running wipes prior `data_origin='seed'` rows and
 *   reseeds cleanly — no duplicates, no orphans.
 * - **Reconcilable:** every generated row is stamped `data_origin='seed'`
 *   with a quarter tag relative to DEMO_EPOCH, so `pnpm reconcile` buckets
 *   by tag, never by wall clock (architecture.md §8).
 *
 * Usage: pnpm seed [--seed <n>]   (DATABASE_PATH=... to override the file)
 */
import Database from "better-sqlite3";

import { runMigrations } from "./db/migrate.mjs";
import { DEFAULT_SEED } from "./seed.ts";
import { builtinGenerators } from "./seed/generators.ts";
import { runSeed } from "./seed/orchestrator.ts";

function resolveSeed(argv) {
  const index = argv.findIndex((a) => a === "--seed" || a.startsWith("--seed="));
  const flag =
    index === -1
      ? undefined
      : argv[index].includes("=")
        ? argv[index].split("=")[1]
        : argv[index + 1];
  const raw = flag ?? process.env.SEED;
  if (raw === undefined || raw === "") return DEFAULT_SEED;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`seed: invalid seed "${raw}" — expected a number`);
    process.exit(2);
  }
  return n;
}

const dbPath = process.env.DATABASE_PATH ?? "./data/rainforest.db";
const seed = resolveSeed(process.argv.slice(2));

console.log(
  `seed: root seed ${seed}${seed === DEFAULT_SEED ? " (default; override with --seed <n> or SEED=<n>)" : ""}`,
);

const applied = runMigrations(dbPath);
console.log(
  `seed: schema ready at ${dbPath} (${applied.length} migration(s) applied)`,
);

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
try {
  const summary = runSeed(sqlite, {
    seed,
    generators: builtinGenerators(),
  });
  console.log(
    `seed: walked ${summary.quarters.length} quarters ` +
      `(${summary.quarters[0]} → ${summary.quarters[summary.quarters.length - 1]}), ` +
      `wiped ${summary.wipedRows} prior seed row(s), inserted ${summary.totalRows} row(s)`,
  );
  for (const [table, count] of Object.entries(summary.rowsByTable)) {
    console.log(`seed:   ${table}: ${count}`);
  }
} finally {
  sqlite.close();
}

console.log("seed: done");
