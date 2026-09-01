import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  BIBLE_LAST_QUARTER,
  BIBLE_FIRST_QUARTER,
  BIBLE_ROW_COUNT,
  BibleValidationError,
  checkIdentityDiagnostics,
  impliedGmvUsdM,
  impliedRevenueUsdM,
  loadNumbersBible,
  numbersBible,
  quarterRow,
  quarterRowSchema,
  quarterTags,
} from "../lib/numbers-bible.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-bible-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Write a bible variant to a temp file and return its path. */
function bibleFile(rows) {
  const path = join(dir, `bible-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(rows));
  return path;
}

const committed = loadNumbersBible();

describe("numbers-bible loader — happy path on the committed bible", () => {
  it("parses exactly 23 rows spanning 2021-Q1 → 2026-Q3", () => {
    assert.equal(committed.length, BIBLE_ROW_COUNT);
    assert.equal(committed[0].quarter, BIBLE_FIRST_QUARTER);
    assert.equal(committed.at(-1).quarter, BIBLE_LAST_QUARTER);
  });

  it("every row carries all 15 typed bible columns", () => {
    const keys = [
      "quarter",
      "gmv_usd_m",
      "revenue_usd_m",
      "gross_margin_pct",
      "net_income_usd_m",
      "orders_k",
      "aov_usd",
      "active_customers_k",
      "first_party_share_pct",
      "marketplace_take_rate_pct",
      "fulfillment_cost_per_order_usd",
      "on_time_delivery_pct",
      "tickets_per_1k_orders",
      "landed_cost_index_electronics",
      "headcount",
    ];
    for (const row of committed) {
      assert.deepEqual(Object.keys(row).sort(), keys.sort());
      for (const key of keys) {
        assert.equal(typeof row[key], key === "quarter" ? "string" : "number");
      }
    }
  });

  it("the committed bible satisfies I1 and I2 on every row", () => {
    assert.deepEqual(checkIdentityDiagnostics(committed), []);
  });

  it("exposes typed accessors by quarter tag", () => {
    const row = quarterRow("2024-Q4");
    assert.equal(row.gmv_usd_m, 520);
    assert.equal(numbersBible().length, 23);
    assert.equal(quarterTags().length, 23);
    assert.equal(quarterTags()[0], "2021-Q1");
  });

  it("rejects an unknown quarter tag with a clear diagnostic", () => {
    assert.throws(() => quarterRow("2019-Q4"), /unknown quarter tag 2019-Q4/);
  });
});

describe("numbers-bible loader — worked examples (reconciliation.md §1)", () => {
  it("2024-Q4 (I2): 520×0.61 + 520×0.39×0.14 = 345.59 ≈ 345.6", () => {
    const row = quarterRow("2024-Q4");
    assert.ok(Math.abs(row.gmv_usd_m * 0.61 - 317.2) < 0.01);
    assert.ok(Math.abs(520 * 0.39 * 0.14 - 28.39) < 0.01);
    assert.ok(Math.abs(impliedRevenueUsdM(row) - 345.59) < 0.01);
    assert.ok(Math.abs(impliedRevenueUsdM(row) - row.revenue_usd_m) / row.revenue_usd_m <= 0.01);
  });

  it("2025-Q3 (I2): 478×0.64 + 478×0.36×0.15 = 331.73 ≈ 331.7", () => {
    const row = quarterRow("2025-Q3");
    assert.ok(Math.abs(478 * 0.64 - 305.92) < 0.01);
    assert.ok(Math.abs(478 * 0.36 * 0.15 - 25.81) < 0.01);
    assert.ok(Math.abs(impliedRevenueUsdM(row) - 331.73) < 0.01);
    assert.ok(Math.abs(impliedRevenueUsdM(row) - row.revenue_usd_m) / row.revenue_usd_m <= 0.01);
  });

  it("2025-Q3 (I1): 7,113k × $67.2 = $477.99M ≈ $478M", () => {
    const row = quarterRow("2025-Q3");
    assert.ok(Math.abs(impliedGmvUsdM(row) - 477.99) < 0.01);
    assert.ok(Math.abs(impliedGmvUsdM(row) - row.gmv_usd_m) / row.gmv_usd_m <= 0.01);
  });

  it("2026-Q2 (I2): 522×0.55 + 522×0.45×0.15 = 322.34 ≈ 322.3", () => {
    const row = quarterRow("2026-Q2");
    assert.ok(Math.abs(522 * 0.55 - 287.1) < 0.01);
    assert.ok(Math.abs(522 * 0.45 * 0.15 - 35.24) < 0.01);
    assert.ok(Math.abs(impliedRevenueUsdM(row) - 322.34) < 0.01);
    assert.ok(Math.abs(impliedRevenueUsdM(row) - row.revenue_usd_m) / row.revenue_usd_m <= 0.01);
  });
});

describe("numbers-bible loader — identity violations fail the build", () => {
  it("rejects an I1 violation with a clear diagnostic", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[0].aov_usd *= 2;
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      (err) => {
        assert.ok(err instanceof BibleValidationError);
        assert.match(err.message, /I1 violated at 2021-Q1/);
        assert.match(err.message, /outside ±1%/);
        return true;
      },
    );
  });

  it("rejects an I2 violation with a clear diagnostic", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[5].revenue_usd_m *= 1.5;
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      (err) => {
        assert.ok(err instanceof BibleValidationError);
        assert.match(err.message, new RegExp(`I2 violated at ${rows[5].quarter}`));
        return true;
      },
    );
  });

  it("reports every violated row, not just the first", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[0].aov_usd *= 2;
    rows[1].aov_usd *= 2;
    try {
      loadNumbersBible(bibleFile(rows));
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.diagnostics.filter((d) => d.startsWith("I1")).length, 2);
    }
  });
});

describe("numbers-bible loader — structure violations fail the build", () => {
  it("rejects a missing row", () => {
    const rows = committed.slice(0, -1);
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      /bible has 22 rows, expected exactly 23/,
    );
  });

  it("rejects an extra row", () => {
    const rows = [...committed, { ...committed.at(-1), quarter: "2026-Q4" }];
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      /bible has 24 rows, expected exactly 23/,
    );
  });

  it("rejects duplicate quarter tags", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[1].quarter = rows[0].quarter;
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      /duplicate quarter tag 2021-Q1/,
    );
  });

  it("rejects a wrong span", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[0].quarter = "2020-Q4";
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      /span is 2020-Q4 → 2026-Q3, expected 2021-Q1 → 2026-Q3/,
    );
  });
});

describe("numbers-bible loader — malformed columns fail the build", () => {
  it("rejects a missing column", () => {
    const rows = committed.map((r) => ({ ...r }));
    delete rows[3].aov_usd;
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      (err) => {
        assert.ok(err instanceof BibleValidationError);
        assert.match(err.message, /aov_usd/);
        return true;
      },
    );
  });

  it("rejects an extra (unknown) column", () => {
    const rows = committed.map((r) => ({ ...r, ebitda_usd_m: 1 }));
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      /[Uu]nrecognized key.*ebitda_usd_m/,
    );
  });

  it("rejects a wrong-typed column", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[2].orders_k = "many";
    assert.throws(() => loadNumbersBible(bibleFile(rows)), BibleValidationError);
  });

  it("rejects a malformed quarter tag", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[0].quarter = "Q1-2021";
    assert.throws(
      () => loadNumbersBible(bibleFile(rows)),
      /quarter tags look like 2024-Q4/,
    );
  });

  it("rejects a non-integer headcount", () => {
    const rows = committed.map((r) => ({ ...r }));
    rows[0].headcount = 1450.5;
    assert.throws(() => loadNumbersBible(bibleFile(rows)), BibleValidationError);
  });

  it("rejects a file that is not valid JSON", () => {
    const path = join(dir, "bible-broken.json");
    writeFileSync(path, "{ not json");
    assert.throws(
      () => loadNumbersBible(path),
      /cannot read or parse/,
    );
  });

  it("rejects a file that is not an array of rows", () => {
    assert.throws(
      () => loadNumbersBible(bibleFile({ quarter: "2021-Q1" })),
      BibleValidationError,
    );
  });
});

describe("quarterRowSchema", () => {
  it("accepts a well-formed row", () => {
    assert.equal(quarterRowSchema.safeParse(committed[0]).success, true);
  });

  it("rejects out-of-range percentages", () => {
    const row = { ...committed[0], first_party_share_pct: 101 };
    assert.equal(quarterRowSchema.safeParse(row).success, false);
  });
});
