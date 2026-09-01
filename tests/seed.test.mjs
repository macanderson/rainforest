import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  createRng,
  createSeedContext,
  DEFAULT_SEED,
  hashSeed,
} from "../lib/seed.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-seed-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("seed RNG harness (E1#6)", () => {
  it("has a fixed default seed", () => {
    assert.equal(typeof DEFAULT_SEED, "number");
    assert.equal(DEFAULT_SEED, 20260901);
  });

  it("is deterministic: same seed → identical sequences", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    assert.deepEqual(seqA, seqB);
  });

  it("produces floats in [0, 1)", () => {
    const rng = createRng(DEFAULT_SEED);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1, `draw ${i} out of range: ${v}`);
    }
  });

  it("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    assert.notDeepEqual(
      Array.from({ length: 10 }, () => a()),
      Array.from({ length: 10 }, () => b()),
    );
  });

  it("named sub-streams are independent of each other and replayable", () => {
    const ctx = createSeedContext(DEFAULT_SEED);
    const suppliers = ctx.stream("suppliers");
    const catalog = ctx.stream("catalog");
    const s = Array.from({ length: 10 }, () => suppliers());
    const c = Array.from({ length: 10 }, () => catalog());
    assert.notDeepEqual(s, c);
    // Re-deriving the same named stream replays the same sequence.
    const again = createSeedContext(DEFAULT_SEED).stream("suppliers");
    assert.deepEqual(
      s,
      Array.from({ length: 10 }, () => again()),
    );
  });

  it("sub-stream draws do not depend on sibling draw order", () => {
    const first = createSeedContext(7);
    const a1 = Array.from({ length: 5 }, () => first.stream("a")());
    const b1 = Array.from({ length: 5 }, () => first.stream("b")());

    const second = createSeedContext(7);
    const b2 = Array.from({ length: 5 }, () => second.stream("b")());
    const a2 = Array.from({ length: 5 }, () => second.stream("a")());

    assert.deepEqual(a1, a2);
    assert.deepEqual(b1, b2);
  });

  it("accepts string seeds via a stable hash", () => {
    assert.equal(hashSeed("rainforest"), hashSeed("rainforest"));
    assert.notEqual(hashSeed("rainforest"), hashSeed("Rainforest"));
    const a = createRng("rainforest");
    const b = createRng("rainforest");
    assert.deepEqual(
      Array.from({ length: 10 }, () => a()),
      Array.from({ length: 10 }, () => b()),
    );
  });
});

describe("pnpm seed orchestrator CLI", () => {
  const run = (env, args = []) =>
    execFileSync("node", ["lib/seed.mjs", ...args], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, ...env },
      encoding: "utf8",
    });

  it("runs migrations and reports the harness is ready", () => {
    const dbPath = join(dir, "cli.db");
    const out = run({ DATABASE_PATH: dbPath });
    assert.match(out, /root seed 20260901 \(default/);
    assert.match(out, /schema ready/);
    assert.match(out, /no domain generators registered yet/);
  });

  it("is idempotent: a second run applies no migrations", () => {
    const dbPath = join(dir, "cli.db");
    const out = run({ DATABASE_PATH: dbPath });
    assert.match(out, /0 migration\(s\) applied/);
  });

  it("honors --seed and SEED overrides", () => {
    const dbPath = join(dir, "cli2.db");
    assert.match(
      run({ DATABASE_PATH: dbPath }, ["--seed", "123"]),
      /root seed 123/,
    );
    assert.match(run({ DATABASE_PATH: dbPath, SEED: "456" }), /root seed 456/);
  });

  it("rejects a non-numeric seed with exit code 2", () => {
    const dbPath = join(dir, "cli3.db");
    assert.throws(
      () => run({ DATABASE_PATH: dbPath }, ["--seed", "abc"]),
      (err) => {
        assert.equal(err.status, 2);
        assert.match(err.stderr, /invalid seed/);
        return true;
      },
    );
  });
});
