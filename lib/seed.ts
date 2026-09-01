/**
 * Deterministic seeded RNG for the `pnpm seed` orchestrator (E1#6).
 *
 * Every domain generator (E3) draws from a named sub-stream derived from one
 * root seed, so two runs with the same seed produce byte-identical databases
 * and `pnpm reconcile` stays deterministic (reconciliation.md §4). The
 * default seed is fixed; override with `pnpm seed --seed <n>` or `SEED=<n>`
 * to explore the space — never to dodge a reconciliation failure (a
 * tolerance change is a spec change and belongs in reconciliation.md first).
 */

/** Fixed default root seed. The demo dataset is reproducible from this constant. */
export const DEFAULT_SEED = 20260901;

/** FNV-1a 32-bit hash — turns a stream name into a stable uint32. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalize(seed: number | string): number {
  return typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
}

/**
 * mulberry32 PRNG. Returns a function producing floats in [0, 1).
 * Deterministic across platforms: same seed → same sequence, always.
 */
export function createRng(seed: number | string = DEFAULT_SEED): () => number {
  let state = normalize(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedContext {
  /** The resolved root seed (uint32). */
  seed: number;
  /** Root stream — generators should prefer `stream(name)`. */
  rng: () => number;
  /**
   * Named sub-stream. Deriving by name (not by call order) keeps each
   * generator's draws stable when sibling generators are added, reordered,
   * or draw a different number of values.
   */
  stream: (name: string) => () => number;
}

export function createSeedContext(
  seed: number | string = DEFAULT_SEED,
): SeedContext {
  const resolved = normalize(seed);
  return {
    seed: resolved,
    rng: createRng(resolved),
    stream: (name) => createRng(hashSeed(`${resolved}:${name}`)),
  };
}
