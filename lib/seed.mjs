#!/usr/bin/env node
/**
 * `pnpm seed` orchestrator (E1#6) — the single entry point the E3 domain
 * generators plug into.
 *
 * Guarantees:
 * - **Deterministic:** fixed default seed (DEFAULT_SEED), overridable via
 *   `--seed <n>` or `SEED=<n>`; same seed → byte-identical database.
 * - **Idempotent:** migrations run through the drizzle ledger, and generators
 *   (once they land) key on stable public codes so re-runs are no-ops.
 * - **Reconcilable:** every generated row is stamped `data_origin='seed'`
 *   with a quarter tag relative to DEMO_EPOCH, so `pnpm reconcile` buckets by
 *   tag, never by wall clock (architecture.md §8).
 *
 * Usage: pnpm seed [--seed <n>]   (DATABASE_PATH=... to override the file)
 */
import { runMigrations } from "./db/migrate.mjs";
import { createSeedContext, DEFAULT_SEED } from "./seed.ts";

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
const ctx = createSeedContext(seed);

console.log(
  `seed: root seed ${ctx.seed}${seed === DEFAULT_SEED ? " (default; override with --seed <n> or SEED=<n>)" : ""}`,
);

const applied = runMigrations(dbPath);
console.log(
  `seed: schema ready at ${dbPath} (${applied.length} migration(s) applied)`,
);

// Domain generators register here as E3 lands. Each receives the database
// path and a named sub-stream, e.g.:
//   await generateSuppliers(dbPath, ctx.stream("suppliers"));
//   await generateCatalog(dbPath, ctx.stream("catalog"));
// Deriving sub-streams by name keeps every generator's draws stable when
// siblings are added or reordered.
const generators = [];

if (generators.length === 0) {
  console.log(
    "seed: no domain generators registered yet — they plug in with E3; schema and RNG harness are ready",
  );
}
for (const generate of generators) {
  await generate(dbPath, ctx);
}

console.log("seed: done");
