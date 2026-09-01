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

/** E3#2 backbone: inbound POs, one per supplier active in the quarter. */
export function purchaseOrdersGenerator(state: BackboneState): DomainGenerator {
  return {
    name: "purchase-orders",
    tables: ["purchase_order_lines", "purchase_orders"],
    generateQuarter(handle, input) {
      const rng = input.rng;
      const { startMs } = quarterWindow(input.quarter);
      const openWarehouses = WAREHOUSES.filter((w) =>
        quarterAtOrAfter(input.quarter, w.opened),
      );
      let seq = 0;
      for (const s of SUPPLIERS) {
        if (!quarterAtOrAfter(input.quarter, s.activeFrom)) continue;
        if (s.activeTo && !quarterAtOrAfter(s.activeTo, input.quarter)) continue;
        const supplierId = state.supplierIds.get(s.code);
        if (supplierId === undefined) continue;
        seq += 1;
        const orderedAt = startMs + int(rng, 0, 30) * DAY_MS;
        const promisedAt = orderedAt + 21 * DAY_MS;
        // Supplier SLA drives late receipt (suppliers.md §5 hooks).
        const late = rng() * 10_000 >= s.onTimeBps;
        const receivedAt =
          promisedAt + (late ? int(rng, 1, 12) : -int(rng, 0, 2)) * DAY_MS;
        const warehouseId = state.warehouseIds.get(pick(rng, openWarehouses).code);
        // 1–3 lines per PO from that supplier's SKUs, priced at the
        // quarter's landed cost (tariff index applied on exposed categories).
        const skus = state.productIds.filter(
          (id) => state.productSupplier.get(id) === s.code,
        );
        const lines: { productId: number; quantity: number; unitCost: number }[] = [];
        const lineCount = Math.min(skus.length, int(rng, 1, 3));
        let totalLanded = 0;
        for (let i = 0; i < lineCount; i++) {
          const quantity = int(rng, 50, 500);
          const productId = skus[i % skus.length];
          if (productId === undefined) throw new Error("no SKU for supplier");
          const unitCost = landedCostCents(state, productId, input.bible);
          totalLanded += quantity * unitCost;
          lines.push({ productId, quantity, unitCost });
        }
        const poId = handle.insert("purchase_orders", {
          code: `PO-${input.quarter}-${String(seq).padStart(3, "0")}`,
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
      }
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
      for (let i = 0; i < orderCount; i++) {
        const seq = i + 1;
        const placedAt = startMs + Math.floor(rng() * (spanDays - 10)) * DAY_MS;
        const promisedAt = placedAt + 3 * DAY_MS;
        const onTime = rng() * 100 < input.bible.on_time_delivery_pct;
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
          late_cause: onTime ? null : pick(rng, ["inbound_stockout", "carrier", "warehouse_ops"] as const),
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
 * The built-in generator sequence, in referential dependency order:
 * suppliers → warehouses → catalog → inventory → purchase orders →
 * sales orders/shipments → tickets. Registration order is execution order.
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
  ];
}
