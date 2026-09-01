import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import { loadBible } from "../lib/reconcile.ts";
import { builtinGenerators } from "../lib/seed/generators.ts";
import {
  quarterWindow,
  runSeed,
  SEED_WIPE_ORDER,
  wipeSeedRows,
} from "../lib/seed/orchestrator.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-seed-orchestrator-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function freshDb(name) {
  const dbPath = join(dir, name);
  runMigrations(dbPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  return { dbPath, sqlite };
}

/** Content digest of every seed row across the seed tables, order-stable.
 * `created_at`/`updated_at` are wall-clock insert stamps (the shared column
 * convention), so they are excluded — determinism is a property of the
 * generated content, not of when the seed ran. */
function seedDigest(sqlite) {
  const strip = (rows) =>
    rows.map((row) => {
      const { created_at, updated_at, ...rest } = row;
      void created_at;
      void updated_at;
      return rest;
    });
  const parts = [];
  for (const table of SEED_WIPE_ORDER) {
    const rows = sqlite
      .prepare(`SELECT * FROM ${table} WHERE data_origin = 'seed' ORDER BY id`)
      .all();
    parts.push(`${table}:${JSON.stringify(strip(rows))}`);
  }
  return parts.join("|");
}

function seedCounts(sqlite) {
  const counts = {};
  for (const table of SEED_WIPE_ORDER) {
    counts[table] = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE data_origin = 'seed'`)
      .get().n;
  }
  return counts;
}

describe("seed orchestrator (issue #20, E3#1)", () => {
  it("walks all 23 bible quarters in order", () => {
    const { sqlite } = freshDb("walk.db");
    const seen = [];
    const spy = {
      name: "spy",
      tables: [],
      generateQuarter(_handle, input) {
        seen.push(input.quarter);
        // Generators receive the typed bible row, never raw JSON.
        assert.equal(typeof input.bible.orders_k, "number");
        assert.equal(typeof input.bible.aov_usd, "number");
        assert.equal(typeof input.rng, "function");
      },
    };
    const summary = runSeed(sqlite, { seed: 1, generators: [spy] });
    const bible = loadBible();
    assert.equal(bible.length, 23);
    assert.deepEqual(seen, bible.map((r) => r.quarter));
    assert.deepEqual(summary.quarters, bible.map((r) => r.quarter));
    assert.equal(seen[0], "2021-Q1");
    assert.equal(seen[22], "2026-Q3");
    sqlite.close();
  });

  it("is deterministic: same seed → identical database contents", () => {
    const a = freshDb("det-a.db");
    const b = freshDb("det-b.db");
    runSeed(a.sqlite, { seed: 42, generators: builtinGenerators() });
    runSeed(b.sqlite, { seed: 42, generators: builtinGenerators() });
    assert.equal(seedDigest(a.sqlite), seedDigest(b.sqlite));
    a.sqlite.close();
    b.sqlite.close();
  });

  it("different seeds produce different contents", () => {
    const a = freshDb("div-a.db");
    const b = freshDb("div-b.db");
    runSeed(a.sqlite, { seed: 1, generators: builtinGenerators() });
    runSeed(b.sqlite, { seed: 2, generators: builtinGenerators() });
    assert.notEqual(seedDigest(a.sqlite), seedDigest(b.sqlite));
    a.sqlite.close();
    b.sqlite.close();
  });

  it("is idempotent: a double run reseeds cleanly with no duplicates", () => {
    const { sqlite } = freshDb("idem.db");
    runSeed(sqlite, { seed: 7, generators: builtinGenerators() });
    const firstDigest = seedDigest(sqlite);
    const firstCounts = seedCounts(sqlite);
    const second = runSeed(sqlite, { seed: 7, generators: builtinGenerators() });
    assert.ok(second.wipedRows > 0, "second run must wipe the first run's rows");
    // The wipe resets AUTOINCREMENT sequences, so the reseed reproduces the
    // first run exactly — rowids included.
    assert.equal(seedDigest(sqlite), firstDigest);
    assert.deepEqual(seedCounts(sqlite), firstCounts);
    for (const [table, column] of [
      ["suppliers", "code"],
      ["warehouses", "code"],
      ["products", "sku"],
      ["purchase_orders", "code"],
      ["sales_orders", "code"],
      ["shipments", "code"],
      ["support_tickets", "code"],
    ]) {
      const dupes = sqlite
        .prepare(
          `SELECT ${column}, COUNT(*) AS n FROM ${table} ` +
            `WHERE data_origin = 'seed' GROUP BY ${column} HAVING n > 1`,
        )
        .all();
      assert.deepEqual(dupes, [], `${table} has duplicate ${column}s`);
    }
    sqlite.close();
  });

  it("stamps every seeded row with data_origin='seed' and a quarter tag", () => {
    const { sqlite } = freshDb("stamp.db");
    runSeed(sqlite, { seed: 7, generators: builtinGenerators() });
    for (const table of SEED_WIPE_ORDER) {
      const bad = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE data_origin != 'seed'`)
        .get().n;
      assert.equal(bad, 0, `${table} has non-seed rows`);
    }
    for (const table of [
      "stock_levels",
      "purchase_orders",
      "sales_orders",
      "shipments",
      "support_tickets",
    ]) {
      const bad = sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM ${table} WHERE quarter_tag NOT GLOB '????-Q[1-4]'`,
        )
        .get().n;
      assert.equal(bad, 0, `${table} has rows without a quarter tag`);
    }
    sqlite.close();
  });

  it("covers every quarter: seed rows exist for all 23 quarter tags", () => {
    const { sqlite } = freshDb("coverage.db");
    runSeed(sqlite, { seed: 7, generators: builtinGenerators() });
    const tags = sqlite
      .prepare("SELECT DISTINCT quarter_tag FROM sales_orders ORDER BY quarter_tag")
      .all()
      .map((r) => r.quarter_tag);
    assert.deepEqual(tags, loadBible().map((r) => r.quarter));
    sqlite.close();
  });

  it("wipeSeedRows removes only seed rows and leaves demo/agent rows", () => {
    const { sqlite } = freshDb("wipe.db");
    runSeed(sqlite, { seed: 7, generators: builtinGenerators() });
    // A demo row that must survive the reseed wipe.
    sqlite
      .prepare(
        "INSERT INTO suppliers (code, name, location, is_import, active_from_quarter, " +
          "lifetime_on_time_bps, mean_days_late_hundredths, data_origin) " +
          "VALUES ('SUP-DEMO', 'Demo Supplier', 'Nowhere', 0, '2026-Q3', 9000, 100, 'demo')",
      )
      .run();
    const wiped = wipeSeedRows(sqlite);
    assert.ok(wiped > 0);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE data_origin = 'seed'").get().n,
      0,
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE data_origin = 'demo'").get().n,
      1,
    );
    sqlite.close();
  });

  it("quarterWindow maps tags to canonical calendar quarters", () => {
    const q3 = quarterWindow("2025-Q3");
    assert.equal(new Date(q3.startMs).toISOString(), "2025-07-01T00:00:00.000Z");
    assert.equal(new Date(q3.endMs).toISOString(), "2025-10-01T00:00:00.000Z");
    assert.throws(() => quarterWindow("2025-Q5"), /invalid quarter tag/);
  });

  it("a generator failure rolls the whole run back", () => {
    const { sqlite } = freshDb("rollback.db");
    const bad = {
      name: "bad",
      tables: ["suppliers"],
      generateQuarter(handle, input) {
        if (input.quarter === "2021-Q2") throw new Error("boom");
        handle.insert("suppliers", {
          code: `SUP-${input.quarter}`,
          name: `Supplier ${input.quarter}`,
          location: "Nowhere",
          is_import: 0,
          active_from_quarter: input.quarter,
          lifetime_on_time_bps: 9000,
          mean_days_late_hundredths: 100,
        });
      },
    };
    assert.throws(() => runSeed(sqlite, { seed: 1, generators: [bad] }), /boom/);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM suppliers").get().n,
      0,
    );
    sqlite.close();
  });
});

describe("pnpm seed CLI (issue #20)", () => {
  function run(env, args = []) {
    return execFileSync("node", ["lib/seed.mjs", ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  }

  it("seeds the full 23-quarter history end to end", () => {
    const dbPath = join(dir, "cli-full.db");
    const out = run({ DATABASE_PATH: dbPath });
    assert.match(out, /walked 23 quarters \(2021-Q1 → 2026-Q3\)/);
    assert.match(out, /inserted [1-9]\d* row\(s\)/);
    assert.match(out, /sales_orders: /);
    // The seeded database is queryable and quarter-tagged.
    const sqlite = new Database(dbPath, { readonly: true });
    const orders = sqlite
      .prepare("SELECT COUNT(*) AS n FROM sales_orders WHERE data_origin = 'seed'")
      .get().n;
    assert.ok(orders > 0);
    sqlite.close();
  });

  it("re-running the CLI reseeds idempotently", () => {
    const dbPath = join(dir, "cli-idem.db");
    run({ DATABASE_PATH: dbPath });
    const out = run({ DATABASE_PATH: dbPath });
    assert.match(out, /wiped [1-9]\d* prior seed row\(s\)/);
    const sqlite = new Database(dbPath, { readonly: true });
    // No duplicate suppliers after two runs.
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE data_origin = 'seed'").get().n,
      8,
    );
    sqlite.close();
  });
});
