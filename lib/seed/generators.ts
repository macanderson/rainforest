/**
 * Built-in domain generators for the master seed orchestrator (issue #20,
 * E3#1). These are the orchestrator's reference implementations of the
 * common generator interface: quarter tag + typed bible row in, rows out.
 * They seed the referential backbone of the synthetic history — suppliers,
 * warehouses, categories, products, stock levels, purchase orders, sales
 * orders, shipments, and support tickets — in dependency order, so every
 * quarter of the 23-quarter walk is fully populated and FK-complete.
 *
 * The richer story calibrations of the sibling data specs (Brightline's
 * SLA collapse, the tariff landed-cost climb, the ticket-cluster lag) build
 * on this backbone in E3#2–#6; the per-quarter aggregates here already
 * track the bible's `orders_k`, `aov_usd`, `on_time_delivery_pct`, and
 * `tickets_per_1k_orders` columns, which is what the orchestrator's
 * determinism and reconciliation contracts require.
 *
 * Determinism rules every generator here obeys:
 * - every random draw comes from the named sub-stream in `QuarterInput.rng`;
 * - every timestamp derives from the quarter window (quarterWindow), never
 *   from the wall clock;
 * - every row is stamped `data_origin='seed'` by the handle and carries a
 *   quarter tag relative to the DEMO_EPOCH anchor (architecture.md §8).
 */
import type { DomainGenerator } from "./orchestrator.ts";
import { quarterWindow } from "./orchestrator.ts";

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

function int(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  const value = values[Math.floor(rng() * values.length)];
  if (value === undefined) throw new Error("pick: empty values");
  return value;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Box–Muller standard normal. `u1` is nudged off zero so `log` stays finite. */
function standardNormal(rng: () => number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Split `total` into per-entry integers proportional to `weights`, summing to
 * exactly `total` — largest-remainder (Hamilton) apportionment: floor every
 * share, then hand the leftover units to the largest fractional parts.
 *
 * Exactness is the point. The seeded history has to hit integer row counts
 * that reproduce a fractional target, and a per-entry rounding pass does not
 * generally sum back to the target. Ties break on index, so this is a pure
 * function of its inputs — no RNG, and none of the iterate-until-close
 * behavior that oscillates when the target is not expressible in the
 * available denominators (issue #26).
 */
export function largestRemainder(
  weights: readonly number[],
  total: number,
): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map((v) => Math.floor(v));
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  for (let k = 0; remaining > 0; k++, remaining--) {
    const entry = order[k % order.length];
    if (entry === undefined) break;
    counts[entry.i] = (counts[entry.i] ?? 0) + 1;
  }
  return counts;
}

/**
 * Choose exactly `count` distinct indices out of `n`, drawn from `rng`.
 * A partial Fisher–Yates: it draws `count` values rather than `n`, so
 * selecting a quarter's late rows costs the number of late rows, not the
 * number of rows.
 */
export function chooseIndices(
  rng: () => number,
  n: number,
  count: number,
): Set<number> {
  const pool = Array.from({ length: n }, (_, i) => i);
  const picked = new Set<number>();
  for (let i = 0; i < Math.min(count, n); i++) {
    const j = i + Math.floor(rng() * (n - i));
    const swap = pool[j] as number;
    pool[j] = pool[i] as number;
    pool[i] = swap;
    picked.add(swap);
  }
  return picked;
}

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Canon rosters (fictional; suppliers.md §1, inventory.md §1)         */
/* ------------------------------------------------------------------ */

/**
 * The full 22-supplier roster of suppliers.md §1 — every SKU's
 * `supplier_id` must resolve into it (catalog.md §1). The four locked-canon
 * suppliers (Brightline, Apex Plastics, Great Lakes, Saigon Circuit Works)
 * carry their locked SLA figures; the rest carry the roster's lifetime
 * on-time % and mean-days-late. `activeFrom`/`activeTo` are the supplier
 * active windows the PO generator and the catalog's sourcing-shift rules
 * respect (no Saigon before 2026-Q1, no Monterrey before 2026-Q2, no
 * Brightline after 2025-Q4).
 */
const SUPPLIERS = [
  { code: "SUP-BRIGHTLINE", name: "Brightline Electronics Co.", location: "Shenzhen, CN", isImport: 1, onTimeBps: 7100, meanLateHundredths: 850, activeFrom: "2021-Q1", activeTo: "2025-Q4" },
  { code: "SUP-APEX", name: "Apex Plastics Manufacturing", location: "Dongguan, CN", isImport: 1, onTimeBps: 7600, meanLateHundredths: 520, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-GREATLAKES", name: "Great Lakes Packaging", location: "Toledo, OH", isImport: 0, onTimeBps: 9800, meanLateHundredths: 120, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-SAIGON", name: "Saigon Circuit Works", location: "Ho Chi Minh City, VN", isImport: 1, onTimeBps: 9500, meanLateHundredths: 180, activeFrom: "2026-Q1", activeTo: null },
  { code: "SUP-DRAGONGATE", name: "Dragon Gate Components", location: "Shenzhen, CN", isImport: 1, onTimeBps: 9100, meanLateHundredths: 360, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-STERLING", name: "Sterling Housewares Ltd.", location: "Guangzhou, CN", isImport: 1, onTimeBps: 8900, meanLateHundredths: 390, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-GOLDENHARBOR", name: "Golden Harbor Appliance Works", location: "Foshan, CN", isImport: 1, onTimeBps: 9100, meanLateHundredths: 340, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-PEARLRIVER", name: "Pearl River Toy Manufactory", location: "Shantou, CN", isImport: 1, onTimeBps: 9000, meanLateHundredths: 380, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-MONTERREY", name: "Monterrey Kitchen Metals S.A.", location: "Monterrey, MX", isImport: 1, onTimeBps: 9400, meanLateHundredths: 210, activeFrom: "2026-Q2", activeTo: null },
  { code: "SUP-BUCKEYE", name: "Buckeye Foods Distribution", location: "Columbus, OH", isImport: 0, onTimeBps: 9600, meanLateHundredths: 140, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-RIVERBEND", name: "Riverbend Grocery Partners", location: "St. Louis, MO", isImport: 0, onTimeBps: 9500, meanLateHundredths: 160, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-MIAMIVALLEY", name: "Miami Valley Paper Co.", location: "Dayton, OH", isImport: 0, onTimeBps: 9700, meanLateHundredths: 110, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-BLUERIDGE", name: "Blue Ridge Cleaning Products", location: "Roanoke, VA", isImport: 0, onTimeBps: 9500, meanLateHundredths: 150, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-CHESAPEAKE", name: "Chesapeake Paper & Disposables", location: "Baltimore, MD", isImport: 0, onTimeBps: 9400, meanLateHundredths: 180, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-PRAIRIE", name: "Prairie Personal Care Labs", location: "Des Moines, IA", isImport: 0, onTimeBps: 9600, meanLateHundredths: 130, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-HEARTLAND", name: "Heartland Health Essentials", location: "Kansas City, MO", isImport: 0, onTimeBps: 9500, meanLateHundredths: 150, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-CARDINAL", name: "Cardinal Home Goods", location: "Indianapolis, IN", isImport: 0, onTimeBps: 9600, meanLateHundredths: 140, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-ALLEGHENY", name: "Allegheny Tabletop & Glass", location: "Pittsburgh, PA", isImport: 0, onTimeBps: 9400, meanLateHundredths: 190, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-WABASH", name: "Wabash Small Motors", location: "Fort Wayne, IN", isImport: 0, onTimeBps: 9500, meanLateHundredths: 160, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-LAKESHORE", name: "Lakeshore Pet Provisions", location: "Cleveland, OH", isImport: 0, onTimeBps: 9600, meanLateHundredths: 130, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-KEYSTONE", name: "Keystone Office Supply Co.", location: "Harrisburg, PA", isImport: 0, onTimeBps: 9700, meanLateHundredths: 120, activeFrom: "2021-Q1", activeTo: null },
  { code: "SUP-NORTHWIND", name: "Northwind Toys & Games", location: "Grand Rapids, MI", isImport: 0, onTimeBps: 9500, meanLateHundredths: 170, activeFrom: "2021-Q1", activeTo: null },
] as const;

/** The 11 fulfillment centers of inventory.md §1 (Warehouse Zero first). */
const WAREHOUSES = [
  { code: "FC-00", name: "Warehouse Zero", city: "Columbus", state: "OH", opened: "2021-Q1", sqftK: 120, role: "hub" },
  { code: "FC-01", name: "FC Indianapolis", city: "Indianapolis", state: "IN", opened: "2021-Q1", sqftK: 240, role: "regional" },
  { code: "FC-02", name: "FC Chicago", city: "Chicago", state: "IL", opened: "2021-Q3", sqftK: 310, role: "regional" },
  { code: "FC-03", name: "FC Detroit", city: "Detroit", state: "MI", opened: "2022-Q1", sqftK: 260, role: "regional" },
  { code: "FC-04", name: "FC Minneapolis", city: "Minneapolis", state: "MN", opened: "2022-Q3", sqftK: 220, role: "regional" },
  { code: "FC-05", name: "FC Kansas City", city: "Kansas City", state: "MO", opened: "2023-Q1", sqftK: 200, role: "regional" },
  { code: "FC-06", name: "FC Pittsburgh", city: "Pittsburgh", state: "PA", opened: "2023-Q3", sqftK: 210, role: "regional" },
  { code: "FC-07", name: "FC St. Louis", city: "St. Louis", state: "MO", opened: "2024-Q1", sqftK: 190, role: "regional" },
  { code: "FC-08", name: "FC Milwaukee", city: "Milwaukee", state: "WI", opened: "2024-Q3", sqftK: 180, role: "regional" },
  { code: "FC-09", name: "FC Cincinnati", city: "Cincinnati", state: "OH", opened: "2025-Q1", sqftK: 200, role: "regional" },
  { code: "FC-10", name: "FC Cleveland", city: "Cleveland", state: "OH", opened: "2025-Q3", sqftK: 170, role: "regional" },
] as const;

/**
 * The 9 categories of catalog.md §1, with per-category SKU counts, Rainforest
 * Basics counts, log-uniform price bands (USD), and the primary-supplier
 * pools. Exactly two are tariff-exposed: Consumer Electronics and Small
 * Kitchen Appliances (catalog.md §3). Totals: 1,200 SKUs, 185 Basics.
 */
const CATEGORIES = [
  { name: "Consumer Electronics", tariffExposed: 1, skus: 150, basics: 25, priceMin: 12, priceMax: 280, suppliers: ["SUP-BRIGHTLINE", "SUP-DRAGONGATE", "SUP-SAIGON"] },
  { name: "Small Kitchen Appliances", tariffExposed: 1, skus: 110, basics: 20, priceMin: 18, priceMax: 190, suppliers: ["SUP-STERLING", "SUP-GOLDENHARBOR", "SUP-WABASH", "SUP-MONTERREY"] },
  { name: "Home & Kitchen", tariffExposed: 0, skus: 190, basics: 40, priceMin: 6, priceMax: 120, suppliers: ["SUP-CARDINAL", "SUP-ALLEGHENY", "SUP-APEX"] },
  { name: "Grocery & Pantry", tariffExposed: 0, skus: 210, basics: 30, priceMin: 3, priceMax: 45, suppliers: ["SUP-BUCKEYE", "SUP-RIVERBEND"] },
  { name: "Health & Personal Care", tariffExposed: 0, skus: 140, basics: 25, priceMin: 4, priceMax: 60, suppliers: ["SUP-PRAIRIE", "SUP-HEARTLAND"] },
  { name: "Cleaning & Household", tariffExposed: 0, skus: 120, basics: 20, priceMin: 3, priceMax: 40, suppliers: ["SUP-MIAMIVALLEY", "SUP-BLUERIDGE", "SUP-CHESAPEAKE"] },
  { name: "Pet Supplies", tariffExposed: 0, skus: 100, basics: 10, priceMin: 5, priceMax: 75, suppliers: ["SUP-LAKESHORE"] },
  { name: "Office & School", tariffExposed: 0, skus: 90, basics: 10, priceMin: 2, priceMax: 55, suppliers: ["SUP-KEYSTONE"] },
  { name: "Toys & Games", tariffExposed: 0, skus: 90, basics: 5, priceMin: 8, priceMax: 90, suppliers: ["SUP-NORTHWIND", "SUP-PEARLRIVER", "SUP-APEX"] },
] as const;

const CARRIERS = ["Midwest Parcel", "GreatLakes Freight", "Rainforest Logistics"] as const;
const TICKET_CLUSTERS = ["shipping-delay", "product-quality", "billing", "other"] as const;
const TICKET_CHANNELS = ["email", "chat", "phone"] as const;

/** Quarter ordering helper: is `a` at or after `b`? (`YYYY-Qn` tags) */
function quarterAtOrAfter(a: string, b: string): boolean {
  return a >= b; // zero-padded YYYY-Qn tags sort lexicographically
}

/* ------------------------------------------------------------------ */
/* Supplier SLA trajectories (suppliers.md §2)                         */
/* ------------------------------------------------------------------ */

/** Expand a `year → [Q1..Q4]` table into quarter-tag keys. */
function byQuarter(rows: Record<string, readonly number[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [year, values] of Object.entries(rows)) {
    values.forEach((pct, i) => out.set(`${year}-Q${i + 1}`, pct));
  }
  return out;
}

/**
 * The published per-quarter on-time trajectories of the named suppliers
 * (suppliers.md §2), verbatim. These are what make the SLA history a *story*
 * rather than noise: Brightline decays 83 → 54 across five years, Apex decays
 * more gently and then recovers under its 2026 remediation plan, and Saigon
 * arrives strong in 2026-Q1. Great Lakes is deliberately absent — it is the
 * flat control row and is drawn from a band instead (see below).
 */
const NAMED_TRAJECTORIES: Record<string, Map<string, number>> = {
  "SUP-BRIGHTLINE": byQuarter({
    2021: [83, 82, 81, 80],
    2022: [79, 78, 77, 76],
    2023: [75, 74, 72, 71],
    2024: [68, 66, 64, 62],
    2025: [60, 58, 56, 54],
  }),
  "SUP-APEX": byQuarter({
    2021: [85, 84, 84, 83],
    2022: [82, 81, 80, 80],
    2023: [79, 78, 77, 76],
    2024: [74, 73, 72, 71],
    2025: [70, 69, 68, 66],
    2026: [78, 80, 81],
  }),
  "SUP-SAIGON": byQuarter({ 2026: [95, 95, 96] }),
};

/** The four non-canon import suppliers that carry the port-congestion dip. */
const OTHER_IMPORT = new Set([
  "SUP-DRAGONGATE",
  "SUP-STERLING",
  "SUP-GOLDENHARBOR",
  "SUP-PEARLRIVER",
]);

/** Port-congestion texture window (suppliers.md §2), −1.5 pt while inside. */
const PORT_CONGESTION_FROM = "2024-Q3";
const PORT_CONGESTION_TO = "2025-Q2";

/**
 * A supplier's target on-time percentage for one quarter (suppliers.md §2).
 *
 * The named suppliers follow their published trajectories exactly. Everyone
 * else jitters around their roster figure inside the spec's bands, so the
 * scorecard reads like measured data rather than a column of constants —
 * while staying small enough that the blended inbound decline remains
 * attributable to Brightline and Apex, which is the whole point of data
 * story 1.
 */
export function supplierOnTimeTargetPct(
  supplier: { code: string; onTimeBps: number; isImport: number },
  quarter: string,
  rng: () => number,
): number {
  const published = NAMED_TRAJECTORIES[supplier.code]?.get(quarter);
  if (published !== undefined) return published;
  // The control row: flat inside [97.5, 98.5], no trend, by design.
  if (supplier.code === "SUP-GREATLAKES") return 97.5 + rng();
  const isOtherImport = OTHER_IMPORT.has(supplier.code);
  const sigma = supplier.isImport === 1 ? 1.5 : 1.0;
  const dip =
    isOtherImport &&
    quarterAtOrAfter(quarter, PORT_CONGESTION_FROM) &&
    quarterAtOrAfter(PORT_CONGESTION_TO, quarter)
      ? 1.5
      : 0;
  const [lo, hi] = supplier.isImport === 1 ? [85, 95] : [92, 99];
  const center = supplier.onTimeBps / 100 - dip;
  return clamp(center + standardNormal(rng) * sigma, lo as number, hi as number);
}

/**
 * Mean days late among a supplier's late POs in one quarter, in days.
 *
 * Brightline is the one supplier whose lateness deepens as well as widens:
 * suppliers.md §2 puts its per-quarter mean at ~6.5 days in 2021 rising to
 * ~10.5 by 2025, which averages to the locked 8.5. Everyone else holds their
 * roster figure.
 */
export function meanLateDaysFor(
  supplier: { code: string; meanLateHundredths: number },
  quarter: string,
): number {
  if (supplier.code !== "SUP-BRIGHTLINE") return supplier.meanLateHundredths / 100;
  // Linear ramp across the 20 quarters of Brightline's active window.
  const index = (Number(quarter.slice(0, 4)) - 2021) * 4 + Number(quarter.slice(6)) - 1;
  return 6.5 + (clamp(index, 0, 19) / 19) * 4;
}

/**
 * Inbound-delay share of a quarter's late customer shipments, by story phase
 * (suppliers.md §3). Late inbound POs cause stockouts, which cause
 * backordered customer orders, which land late — so the customer-facing
 * on-time decline has to be *attributable*, not just present. The remainder
 * is carrier and warehouse-ops noise (orders.md §5).
 */
export function inboundLateShare(quarter: string): number {
  if (!quarterAtOrAfter(quarter, "2023-Q3")) return 0.2;
  if (!quarterAtOrAfter(quarter, "2025-Q1")) return 0.4;
  if (!quarterAtOrAfter(quarter, "2026-Q1")) return 0.525;
  return 0.25; // Brightline has exited; only residual Apex remains.
}

/**
 * Purchase orders per unit of 1P order volume (`orders_k × 1P share`).
 *
 * suppliers.md §4 pins the shape — 1P purchasing expands through One Basket
 * and contracts under the 2026 catalog rationalization — and its peak, ~2,200
 * POs in 2024-Q4. This constant is that peak divided by the bible's 2024-Q4
 * 1P volume, so the curve follows the bible rather than a second hand-kept
 * table that could drift away from it.
 */
const PO_PER_1P_ORDER_K = 0.482;

/**
 * Great Lakes Packaging supplies packaging and shipping consumables across
 * every category (suppliers.md §1) rather than resale SKUs — which is why it
 * appears in no catalog sourcing pool (catalog.md §1) and why its POs carry
 * no `purchase_order_lines`: there is no catalog SKU for a carton.
 *
 * It still needs PO volume. It is the control row of data story 1 — the
 * supplier whose 98% proves the decline is supplier-specific and not systemic
 * — and a control with no deliveries proves nothing. Weighting it off the
 * whole catalog rather than a sourcing pool gives it a cadence a little above
 * the largest single-category suppliers, which is the right shape for a
 * vendor that packs everything that ships.
 */
const PACKAGING_SUPPLIER = "SUP-GREATLAKES";
const PACKAGING_PO_SHARE_OF_CATALOG = 0.08;

/**
 * Suppliers whose PO cadence is flat rather than scaling with 1P growth,
 * as a `[min, max]` band of POs per active quarter.
 *
 * Brightline is the case suppliers.md §2 calls out: roughly weekly POs per
 * stocking FC, ~65–90 a quarter, until the relationship ends. That is a
 * numerical constraint, not texture. Its on-time trajectory decays 83 → 54
 * across the same years 1P purchasing quintuples, so a volume-scaled cadence
 * would weight its worst quarters five times as heavily as its best and pull
 * the derived lifetime figure ~5 points under the roster's 71%. Holding the
 * cadence flat is what makes the lifetime aggregate track the arithmetic mean
 * of the trajectory table, which is the ≈70.8 the spec predicts.
 */
const FLAT_CADENCE_SUPPLIERS: Record<string, readonly [number, number]> = {
  "SUP-BRIGHTLINE": [65, 90],
};

/* ------------------------------------------------------------------ */
/* Shared per-run state (parent IDs the child generators reference)    */
/* ------------------------------------------------------------------ */

export interface BackboneState {
  supplierIds: Map<string, number>;
  warehouseIds: Map<string, number>;
  categoryIds: Map<string, number>;
  productIds: number[];
  /** product id → supplier code, for PO/ticket attribution. */
  productSupplier: Map<number, string>;
  /** product id → category name, for the tariff landed-cost trend. */
  productCategory: Map<number, string>;
  /** product id → base unit cost in cents (pre-index, catalog.md §3). */
  productBaseCostCents: Map<number, number>;
  /** product id → 1 when the SKU is a Rainforest Basics private label. */
  productPrivateLabel: Map<number, number>;
  /** sales order id → quarter, for ticket attribution. */
  orderQuarter: Map<number, string>;
  /**
   * supplier code → the PO outcomes actually generated, accumulated across
   * the walk. The supplier scorecard is derived from this rather than
   * asserted from the roster — see {@link supplierScorecardGenerator}.
   */
  supplierRealized: Map<string, SupplierRealized>;
}

/** Running tally of one supplier's generated purchase-order outcomes. */
export interface SupplierRealized {
  purchaseOrders: number;
  latePurchaseOrders: number;
  /** Summed days late over late POs only; the mean's numerator. */
  lateDaysTotal: number;
}

export function emptyBackbone(): BackboneState {
  return {
    supplierIds: new Map(),
    warehouseIds: new Map(),
    categoryIds: new Map(),
    productIds: [],
    productSupplier: new Map(),
    productCategory: new Map(),
    productBaseCostCents: new Map(),
    productPrivateLabel: new Map(),
    orderQuarter: new Map(),
    supplierRealized: new Map(),
  };
}

/* ------------------------------------------------------------------ */
/* Generators, in referential dependency order                         */
/* ------------------------------------------------------------------ */

/** E3#2 backbone: the supplier roster (seeded once, in the first quarter). */
export function suppliersGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "suppliers",
    tables: ["suppliers"],
    generateQuarter(handle, input) {
      if (input.quarter !== "2021-Q1") return; // roster is quarter-invariant
      for (const s of SUPPLIERS) {
        const id = handle.insert("suppliers", {
          code: s.code,
          name: s.name,
          location: s.location,
          is_import: s.isImport,
          active_from_quarter: s.activeFrom,
          active_to_quarter: s.activeTo,
          lifetime_on_time_bps: s.onTimeBps,
          mean_days_late_hundredths: s.meanLateHundredths,
        });
        state.supplierIds.set(s.code, id);
      }
    },
  };
}

/** E3#5 backbone: the fulfillment network (seeded once). */
export function warehousesGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "warehouses",
    tables: ["warehouses"],
    generateQuarter(handle, input) {
      if (input.quarter !== "2021-Q1") return;
      for (const w of WAREHOUSES) {
        const id = handle.insert("warehouses", {
          code: w.code,
          name: w.name,
          city: w.city,
          state: w.state,
          opened_quarter: w.opened,
          sqft_k: w.sqftK,
          role: w.role,
        });
        state.warehouseIds.set(w.code, id);
      }
    },
  };
}

/**
 * E3#3 (issue #35): the 9 categories and the 1,200-SKU catalog of
 * catalog.md §1, seeded once in the first quarter. Per-category SKU counts
 * and Rainforest Basics counts come straight from the spec table (totals
 * 1,200 and 185); list prices are log-uniform inside each category's price
 * band; every SKU's supplier resolves into the 22-supplier roster and
 * respects the sourcing-shift windows (no Saigon before 2026-Q1, no
 * Monterrey before 2026-Q2, no Brightline after 2025-Q4 — catalog.md §3/§5).
 * The tariff landed-cost trend itself is applied per quarter by the PO
 * generator (see `landedCostCents`), which is what the reconcile hook
 * measures.
 */
export function catalogGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "catalog",
    tables: ["products", "categories"],
    generateQuarter(handle, input) {
      if (input.quarter !== "2021-Q1") return;
      const rng = input.rng;
      let skuCounter = 0;
      for (const c of CATEGORIES) {
        const categoryId = handle.insert("categories", {
          name: c.name,
          tariff_exposed: c.tariffExposed,
        });
        state.categoryIds.set(c.name, categoryId);
        // The first `c.basics` SKUs of each category are the Rainforest
        // Basics private-label line (catalog.md §1/§2).
        for (let i = 0; i < c.skus; i++) {
          skuCounter += 1;
          const isBasics = i < c.basics;
          const supplierCode = pick(rng, c.suppliers);
          const supplierId = state.supplierIds.get(supplierCode);
          if (supplierId === undefined) {
            throw new Error(`catalog: supplier ${supplierCode} not seeded`);
          }
          // Log-uniform list price inside the category band (catalog.md §1).
          const listPriceCents = Math.round(
            Math.exp(
              Math.log(c.priceMin) +
                rng() * (Math.log(c.priceMax) - Math.log(c.priceMin)),
            ) * 100,
          );
          // Per-SKU margin: national brands 30–50% of list; Basics price
          // ~15–25% below the comparable national brand with initially
          // higher margin (catalog.md §2), so their cost ratio is lower.
          const costRatio = isBasics
            ? 0.45 + rng() * 0.15 // 55–70% initial margin
            : 0.5 + rng() * 0.2; // 30–50% margin
          const baseCostCents = Math.max(
            50,
            Math.round(listPriceCents * costRatio),
          );
          const id = handle.insert("products", {
            sku: `SKU-${String(skuCounter).padStart(5, "0")}`,
            name: isBasics
              ? `Rainforest Basics ${c.name} ${i + 1}`
              : `${c.name} Item ${i + 1}`,
            category_id: categoryId,
            supplier_id: supplierId,
            is_private_label: isBasics ? 1 : 0,
            unit_cost_cents: baseCostCents,
            list_price_cents: listPriceCents,
            first_sold_quarter: "2021-Q1",
          });
          state.productIds.push(id);
          state.productSupplier.set(id, supplierCode);
          state.productCategory.set(id, c.name);
          state.productBaseCostCents.set(id, baseCostCents);
          state.productPrivateLabel.set(id, isBasics ? 1 : 0);
        }
      }
    },
  };
}

/** E3#5 backbone: one stock-level snapshot per SKU per open FC per quarter. */
export function inventoryGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "inventory",
    tables: ["stock_levels"],
    generateQuarter(handle, input) {
      const rng = input.rng;
      const openWarehouses = WAREHOUSES.filter((w) =>
        quarterAtOrAfter(input.quarter, w.opened),
      );
      const snapshotAt = quarterWindow(input.quarter).endMs - DAY_MS;
      for (const productId of state.productIds) {
        for (const w of openWarehouses) {
          const onHand = int(rng, 0, 400);
          handle.insert("stock_levels", {
            product_id: productId,
            warehouse_id: state.warehouseIds.get(w.code),
            snapshot_at: snapshotAt,
            quarter_tag: input.quarter,
            on_hand: onHand,
            reserved: int(rng, 0, Math.min(onHand, 40)),
            inbound: int(rng, 0, 120),
            reorder_point: 50,
            days_of_cover: onHand / 8,
          });
        }
      }
    },
  };
}

/**
 * Landed unit cost for a SKU in a quarter (catalog.md §3): the SKU's base
 * cost scaled by the quarter's `landed_cost_index_electronics` when the SKU
 * sits in a tariff-exposed category (Consumer Electronics, Small Kitchen
 * Appliances); flat at base cost otherwise. The index is 100.0 at 2024-Q1
 * and 118.0 at 2025-Q4, so exposed-category PO unit costs climb +18% across
 * the tariff window while unexposed categories stay flat — the reconcile
 * hook (catalog.md §5.2) measures exactly this from PO unit costs.
 */
export function landedCostCents(
  state: BackboneState,
  productId: number,
  bible: { landed_cost_index_electronics: number },
): number {
  const base = state.productBaseCostCents.get(productId);
  if (base === undefined) throw new Error(`no base cost for product ${productId}`);
  const category = state.productCategory.get(productId);
  const exposed = CATEGORIES.find((c) => c.name === category)?.tariffExposed === 1;
  if (!exposed) return base;
  return Math.max(1, Math.round((base * bible.landed_cost_index_electronics) / 100));
}

/**
 * Days late for one late PO: lognormal around the quarter's mean, long tail
 * capped at 35 days (suppliers.md §2). σ = 0.5 keeps the tail visible without
 * letting one draw dominate a supplier's mean.
 */
function lateDaysDraw(rng: () => number, meanDays: number): number {
  const sigma = 0.5;
  const mu = Math.log(Math.max(meanDays, 0.1)) - (sigma * sigma) / 2;
  return clamp(Math.round(Math.exp(mu + sigma * standardNormal(rng))), 1, 35);
}

/**
 * E3#2 (issue #26): inbound POs and their per-PO SLA outcomes.
 *
 * Volume follows the bible's 1P purchasing curve (suppliers.md §4) and is
 * apportioned across the quarter's active suppliers by SKU count, so a
 * supplier's PO cadence tracks the catalog it actually supplies. Within each
 * supplier-quarter the number of late receipts is fixed up front from that
 * supplier's published on-time trajectory (§2) and realized exactly, rather
 * than drawn per PO — a Bernoulli draw per PO leaves the quarter's rate
 * wherever the coin landed, which is what made earlier attempts at this
 * generator oscillate instead of converge (issue #26).
 */
export function purchaseOrdersGenerator(state: BackboneState): DomainGenerator {
  // SKU→supplier assignment is fixed at catalog time and never changes, so
  // the per-supplier SKU pools are built once and reused for all 23 quarters
  // rather than re-scanned 1,200 products deep on every supplier-quarter.
  let skuPools: Map<string, number[]> | null = null;

  return {
    name: "purchase-orders",
    tables: ["purchase_order_lines", "purchase_orders"],
    generateQuarter(handle, input) {
      const rng = input.rng;
      const { startMs } = quarterWindow(input.quarter);
      const openWarehouses = WAREHOUSES.filter((w) =>
        quarterAtOrAfter(input.quarter, w.opened),
      );
      if (skuPools === null) {
        skuPools = new Map();
        for (const productId of state.productIds) {
          const code = state.productSupplier.get(productId);
          if (code === undefined) continue;
          const pool = skuPools.get(code);
          if (pool) pool.push(productId);
          else skuPools.set(code, [productId]);
        }
      }

      const active = SUPPLIERS.filter(
        (s) =>
          quarterAtOrAfter(input.quarter, s.activeFrom) &&
          !(s.activeTo && !quarterAtOrAfter(s.activeTo, input.quarter)) &&
          state.supplierIds.has(s.code),
      );
      if (active.length === 0) return;

      // The quarter's PO budget, apportioned by each supplier's SKU count.
      // Largest-remainder so the per-supplier counts sum to the budget exactly.
      const quarterTotal = Math.max(
        active.length,
        Math.round(
          input.bible.orders_k *
            (input.bible.first_party_share_pct / 100) *
            PO_PER_1P_ORDER_K,
        ),
      );
      // Flat-cadence suppliers take their fixed count off the top; the rest
      // of the budget is apportioned across everyone else by SKU count.
      const perSupplier: number[] = active.map((s) => {
        const band = FLAT_CADENCE_SUPPLIERS[s.code];
        return band ? int(rng, band[0], band[1]) : -1;
      });
      const flexible = active
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => perSupplier[i] === -1);
      const split = largestRemainder(
        flexible.map(({ s }) =>
          s.code === PACKAGING_SUPPLIER
            ? Math.round(state.productIds.length * PACKAGING_PO_SHARE_OF_CATALOG)
            : (skuPools?.get(s.code)?.length ?? 0),
        ),
        Math.max(
          0,
          quarterTotal -
            perSupplier.reduce((a, n) => a + Math.max(n, 0), 0),
        ),
      );
      flexible.forEach(({ i }, k) => {
        perSupplier[i] = split[k] ?? 0;
      });

      let seq = 0;
      active.forEach((s, supplierIndex) => {
        const supplierId = state.supplierIds.get(s.code);
        const skus = skuPools?.get(s.code) ?? [];
        const poCount = perSupplier[supplierIndex] ?? 0;
        if (supplierId === undefined || poCount === 0) return;

        // How many of this supplier's POs land late this quarter, fixed from
        // its trajectory before any row is written.
        const targetPct = supplierOnTimeTargetPct(s, input.quarter, rng);
        const lateSet = chooseIndices(
          rng,
          poCount,
          Math.round(poCount * (1 - targetPct / 100)),
        );
        const meanLate = meanLateDaysFor(s, input.quarter);
        // Lead times: import suppliers 28–42 days, domestic 3–10
        // (suppliers.md §4). Lateness is measured against the promised dock.
        const [leadMin, leadMax] = s.isImport === 1 ? [28, 42] : [3, 10];

        const tally = state.supplierRealized.get(s.code) ?? {
          purchaseOrders: 0,
          latePurchaseOrders: 0,
          lateDaysTotal: 0,
        };

        for (let k = 0; k < poCount; k++) {
          seq += 1;
          const orderedAt = startMs + int(rng, 0, 30) * DAY_MS;
          const promisedAt = orderedAt + int(rng, leadMin, leadMax) * DAY_MS;
          const late = lateSet.has(k);
          const daysLate = late ? lateDaysDraw(rng, meanLate) : 0;
          const receivedAt =
            promisedAt + (late ? daysLate : -int(rng, 0, 2)) * DAY_MS;
          const warehouseId = state.warehouseIds.get(
            pick(rng, openWarehouses).code,
          );
          // 1–3 lines per PO from that supplier's SKUs, priced at the
          // quarter's landed cost (tariff index on exposed categories). A
          // packaging supplier has no catalog SKUs, so its POs are lineless
          // and carry a flat consumables cost instead.
          const lines: { productId: number; quantity: number; unitCost: number }[] =
            [];
          let totalLanded = int(rng, 40_000, 260_000);
          if (skus.length > 0) {
            totalLanded = 0;
            const lineCount = Math.min(skus.length, int(rng, 1, 3));
            const offset = Math.floor(rng() * skus.length);
            for (let i = 0; i < lineCount; i++) {
              const quantity = int(rng, 50, 500);
              const productId = skus[(offset + i) % skus.length];
              if (productId === undefined) throw new Error("no SKU for supplier");
              const unitCost = landedCostCents(state, productId, input.bible);
              totalLanded += quantity * unitCost;
              lines.push({ productId, quantity, unitCost });
            }
          }
          const poId = handle.insert("purchase_orders", {
            code: `PO-${input.quarter}-${String(seq).padStart(5, "0")}`,
            supplier_id: supplierId,
            warehouse_id: warehouseId,
            status: "received",
            quarter_tag: input.quarter,
            ordered_at: orderedAt,
            promised_at: promisedAt,
            received_at: receivedAt,
            total_landed_cents: totalLanded,
          });
          for (const line of lines) {
            handle.insert("purchase_order_lines", {
              purchase_order_id: poId,
              product_id: line.productId,
              quantity: line.quantity,
              unit_cost_cents: line.unitCost,
            });
          }
          tally.purchaseOrders += 1;
          if (late) {
            tally.latePurchaseOrders += 1;
            tally.lateDaysTotal += daysLate;
          }
        }
        state.supplierRealized.set(s.code, tally);
      });
    },
  };
}

/**
 * E3#4 backbone: sales orders + lines + shipments, calibrated to the
 * quarter's `orders_k`, `aov_usd`, and `on_time_delivery_pct` bible targets.
 */
export function ordersGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "orders",
    tables: ["shipments", "sales_order_lines", "sales_orders"],
    generateQuarter(handle, input) {
      const rng = input.rng;
      const { startMs, endMs } = quarterWindow(input.quarter);
      const spanDays = (endMs - startMs) / DAY_MS;
      // The bible's orders_k is in thousands; the demo database carries a
      // 1:1000 scale factor so a quarter is hundreds of rows, not millions.
      const orderCount = Math.max(1, Math.round(input.bible.orders_k));
      const aovCents = Math.round(input.bible.aov_usd * 100);
      const openWarehouses = WAREHOUSES.filter((w) =>
        quarterAtOrAfter(input.quarter, w.opened),
      );

      // The quarter's late-delivery budget, taken straight off the bible and
      // realized exactly. `on_time_delivery_pct` is the constraint reconcile
      // enforces (D5), and an integer count of late shipments out of a known
      // order count can always express it to within half a shipment — where a
      // per-order Bernoulli draw only lands there on average, and a small
      // quarter can miss by whole percentage points.
      const lateCount = Math.round(
        orderCount * (1 - input.bible.on_time_delivery_pct / 100),
      );
      const lateOrders = chooseIndices(rng, orderCount, lateCount);
      // Of those, the share attributable to late inbound POs (suppliers.md
      // §3) — the link that makes the customer-facing decline traceable back
      // to Brightline and Apex rather than unexplained.
      const lateList = [...lateOrders].sort((a, b) => a - b);
      const inboundPicks = chooseIndices(
        rng,
        lateList.length,
        Math.round(lateList.length * inboundLateShare(input.quarter)),
      );
      const inboundCaused = new Set(
        [...inboundPicks].map((k) => lateList[k] as number),
      );

      for (let i = 0; i < orderCount; i++) {
        const seq = i + 1;
        const placedAt = startMs + Math.floor(rng() * (spanDays - 10)) * DAY_MS;
        const promisedAt = placedAt + 3 * DAY_MS;
        const onTime = !lateOrders.has(i);
        const deliveredAt =
          promisedAt + (onTime ? -int(rng, 0, 2) : int(rng, 1, 9)) * DAY_MS;
        const warehouseId = state.warehouseIds.get(
          pick(rng, openWarehouses).code,
        );
        if (warehouseId === undefined) throw new Error("no open warehouse");
        // Order total calibrated to AOV: spread around the target.
        const totalCents = Math.max(
          500,
          Math.round(aovCents * (0.4 + rng() * 1.6)),
        );
        const orderId = handle.insert("sales_orders", {
          code: `SO-${input.quarter}-${String(seq).padStart(5, "0")}`,
          customer_ref: `CUST-${int(rng, 1, Math.round(input.bible.active_customers_k))}`,
          warehouse_id: warehouseId,
          status: "delivered",
          service_level: pick(rng, ["next_morning", "two_day"] as const),
          quarter_tag: input.quarter,
          total_cents: totalCents,
          placed_at: placedAt,
          allocated_at: placedAt + 4 * 3_600_000,
          picked_at: placedAt + 10 * 3_600_000,
          shipped_at: placedAt + DAY_MS,
          delivered_at: deliveredAt,
          promised_at: promisedAt,
          late_cause: onTime
            ? null
            : inboundCaused.has(i)
              ? "inbound_stockout"
              : pick(rng, ["carrier", "warehouse_ops"] as const),
        });
        state.orderQuarter.set(orderId, input.quarter);
        // 1–3 lines summing near the order total.
        const lineCount = int(rng, 1, 3);
        let remaining = totalCents;
        for (let l = 0; l < lineCount; l++) {
          const productId = pick(rng, state.productIds);
          const qty = int(rng, 1, 3);
          const unit =
            l === lineCount - 1
              ? Math.max(100, Math.round(remaining / qty))
              : Math.max(100, Math.round(totalCents / lineCount / qty));
          remaining -= unit * qty;
          handle.insert("sales_order_lines", {
            sales_order_id: orderId,
            product_id: productId,
            quantity: qty,
            unit_price_cents: unit,
          });
        }
        handle.insert("shipments", {
          code: `SHP-${input.quarter}-${String(seq).padStart(5, "0")}`,
          sales_order_id: orderId,
          warehouse_id: warehouseId,
          carrier: pick(rng, CARRIERS),
          status: "delivered",
          quarter_tag: input.quarter,
          shipped_at: placedAt + DAY_MS,
          promised_at: promisedAt,
          delivered_at: deliveredAt,
          // Kept in step with the timestamps above by construction — the
          // column is the derived `delivered_at > promised_at` flag, and it is
          // what reconcile's D5 aggregates.
          is_late: onTime ? 0 : 1,
        });
      }
    },
  };
}

/** E3#6 backbone: support tickets at the quarter's `tickets_per_1k_orders`. */
export function ticketsGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "tickets",
    tables: ["support_tickets"],
    generateQuarter(handle, input) {
      const rng = input.rng;
      const { startMs, endMs } = quarterWindow(input.quarter);
      const orderCount = Math.max(1, Math.round(input.bible.orders_k));
      const ticketCount = Math.max(
        1,
        Math.round((orderCount * input.bible.tickets_per_1k_orders) / 1000),
      );
      const quarterOrders = [...state.orderQuarter.entries()]
        .filter(([, q]) => q === input.quarter)
        .map(([id]) => id);
      for (let i = 0; i < ticketCount; i++) {
        const orderId =
          quarterOrders.length > 0 ? pick(rng, quarterOrders) : null;
        handle.insert("support_tickets", {
          code: `TCK-${input.quarter}-${String(i + 1).padStart(4, "0")}`,
          cluster_tag: pick(rng, TICKET_CLUSTERS),
          sales_order_id: orderId,
          product_id: pick(rng, state.productIds),
          channel: pick(rng, TICKET_CHANNELS),
          status: pick(rng, ["resolved", "closed"] as const),
          quarter_tag: input.quarter,
          opened_at: startMs + Math.floor(rng() * (endMs - startMs)),
          first_response_minutes: int(rng, 5, 240),
          resolution_minutes: int(rng, 60, 4_320),
        });
      }
    },
  };
}

/**
 * E3#2 close-out (issue #26): the supplier scorecard, derived.
 *
 * Each supplier's `lifetime_on_time_bps` and `mean_days_late_hundredths` are
 * recomputed from the purchase orders actually generated and written back
 * over the roster's figures.
 *
 * Why derived rather than asserted. The roster's locked lifetime percentages
 * (suppliers.md §1) and the bible's quarterly `on_time_delivery_pct` series
 * were authored independently, and with integer PO counts the two are not in
 * general both satisfiable — 12 purchase orders can only express twelfths, so
 * a target like 95.5% is simply unreachable, and iterating a blend rate
 * toward it oscillates forever. Something has to give, and it is the roster:
 * the quarterly series is what reconcile enforces and what the demo shows, so
 * it stays hard, and the roster figures survive as the trajectory targets
 * that shape the draw. What the scorecard then reports is what its own PO
 * history supports. A scorecard reading 71.0% over rows that say 70.4% is a
 * worse demo than one that reads 70.4%.
 *
 * The write lands every quarter rather than once at the end, so the row also
 * reads correctly as history-to-date at any point in the walk; the final
 * quarter leaves the lifetime figure.
 */
export function supplierScorecardGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "supplier-scorecard",
    tables: ["suppliers"],
    generateQuarter(handle) {
      for (const [code, realized] of state.supplierRealized) {
        const supplierId = state.supplierIds.get(code);
        if (supplierId === undefined || realized.purchaseOrders === 0) continue;
        const onTime = realized.purchaseOrders - realized.latePurchaseOrders;
        handle.update("suppliers", supplierId, {
          lifetime_on_time_bps: Math.round(
            (10_000 * onTime) / realized.purchaseOrders,
          ),
          mean_days_late_hundredths:
            realized.latePurchaseOrders > 0
              ? Math.round(
                  (100 * realized.lateDaysTotal) / realized.latePurchaseOrders,
                )
              : 0,
        });
      }
    },
  };
}

/**
 * The built-in generator sequence, in referential dependency order:
 * suppliers → warehouses → catalog → inventory → purchase orders →
 * sales orders/shipments → tickets → the derived supplier scorecard.
 * Registration order is execution order.
 */
export function builtinGenerators(
  state: BackboneState = emptyBackbone(),
): DomainGenerator[] {
  return [
    suppliersGenerator(state),
    warehousesGenerator(state),
    catalogGenerator(state),
    inventoryGenerator(state),
    purchaseOrdersGenerator(state),
    ordersGenerator(state),
    ticketsGenerator(state),
    supplierScorecardGenerator(state),
  ];
}
