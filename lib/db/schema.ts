/**
 * Drizzle schema — the thirteen core relational tables of architecture.md §4,
 * plus the migration ledger. Every table carries the shared column convention
 * (lib/db/columns.ts, architecture.md §3): `data_origin`, `created_at`,
 * `updated_at`, enforced at the database layer by `data_origin_check`.
 *
 * Conventions (architecture.md §4):
 * - Integer autoincrement primary keys; stable public display codes
 *   (`SKU-…`, `PO-…`, `SO-…`, `SUP-…`, `SHP-…`, `TCK-…`) in unique `code`/`sku`
 *   columns — never expose the rowid.
 * - Money is integer cents (`*_cents`). Percentages that must reconcile
 *   exactly are integer basis points (`*_bps`).
 * - Seed-facing tables carry `quarter_tag` (e.g. `2025-Q3`) aligned to the
 *   numbers bible, so reconciliation buckets by tag, never wall clock (§8).
 *
 * Cascade design — explicit per relation, built so the nightly demo wipe
 * (E6#3) is cascade-safe:
 * - Parent → child composition cascades: deleting an order/PO deletes its
 *   lines and shipments. The wipe deletes `data_origin='demo'` roots and the
 *   database takes the children with them.
 * - Reference FKs into the seeded entity backbone (suppliers, warehouses,
 *   categories, products) RESTRICT: a demo row may point at a seed entity,
 *   and no wipe path may ever take a seed entity down. Demo-created entities
 *   are wiped leaf-first (lines/shipments/stock, then orders/POs, then
 *   products) which the restrict rules permit.
 * - Nullable corroboration-walk FKs on support_tickets SET NULL: wiping a
 *   demo order never deletes a ticket row, it just unlinks it.
 * - agent_actions and audit_log have no hard FKs: the audit trail is
 *   append-only and must survive every wipe.
 */
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { dataOriginCheck, sharedColumns } from "./columns.ts";

/** Quarter tag shape, e.g. `2025-Q3` — DEMO_EPOCH-relative (architecture §8). */
export const QUARTER_TAG_PATTERN = /^\d{4}-Q[1-4]$/;

export const PO_STATUSES = [
  "pending_approval",
  "approved",
  "issued",
  "partially_received",
  "received",
  "cancelled",
] as const;

export const ORDER_STATUSES = [
  "placed",
  "backordered",
  "allocated",
  "picked",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export const SERVICE_LEVELS = ["next_morning", "two_day"] as const;

/** Late-cause attribution (orders.md §5) — causally driven, never painted on. */
export const LATE_CAUSES = [
  "inbound_stockout",
  "carrier",
  "warehouse_ops",
] as const;

export const SHIPMENT_STATUSES = [
  "pending",
  "in_transit",
  "delivered",
  "exception",
] as const;

export const TICKET_CLUSTERS = [
  "shipping-delay",
  "product-quality",
  "billing",
  "other",
] as const;

export const TICKET_CHANNELS = ["email", "chat", "phone"] as const;

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "closed",
] as const;

export const AGENT_NAMES = [
  "auto-reorder",
  "fulfillment",
  "exception",
] as const;

/**
 * Ledger of applied migrations. The runner (lib/db/migrate.mjs) records each
 * applied migration here so re-runs are no-ops and the applied set is
 * inspectable from SQL.
 */
export const drizzleMigrations = sqliteTable(
  "drizzle_migrations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tag: text("tag").notNull().unique(),
    appliedAt: integer("applied_at").notNull(),
    ...sharedColumns,
  },
  () => [dataOriginCheck],
);

/** Supplier roster with SLA attributes (data-specs/suppliers.md §1). */
export const suppliers = sqliteTable(
  "suppliers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable public display code, `SUP-…`. */
    code: text("code").notNull().unique(),
    name: text("name").notNull().unique(),
    /** City + country, e.g. `Shenzhen, CN`. */
    location: text("location").notNull(),
    /** Import suppliers have 28–42 day lead times; domestic 3–10. */
    isImport: integer("is_import", { mode: "boolean" }).notNull(),
    /** First quarter the supplier may receive POs, e.g. `2021-Q1`. */
    activeFromQuarter: text("active_from_quarter").notNull(),
    /** Last active quarter; NULL = still active (e.g. Brightline → `2025-Q4`). */
    activeToQuarter: text("active_to_quarter"),
    /** Lifetime on-time rate in basis points (71.0% → 7100). */
    lifetimeOnTimeBps: integer("lifetime_on_time_bps").notNull(),
    /** Mean days late among late POs, in hundredths of a day (8.5 → 850). */
    meanDaysLateHundredths: integer("mean_days_late_hundredths").notNull(),
    ...sharedColumns,
  },
  () => [dataOriginCheck],
);

/** The 11 fulfillment centers, including Warehouse Zero (inventory.md §1). */
export const warehouses = sqliteTable(
  "warehouses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable public code, e.g. `CMH1`. */
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    /** Opening quarter, e.g. `2017-Q2`; no stock/order row may predate it. */
    openedQuarter: text("opened_quarter").notNull(),
    sqftK: integer("sqft_k").notNull(),
    role: text("role").notNull(),
    ...sharedColumns,
  },
  () => [dataOriginCheck],
);

/** The 9 product categories; tariff-exposed ones flagged (catalog.md §1). */
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    /** Consumer Electronics and Small Kitchen Appliances (catalog.md §3). */
    tariffExposed: integer("tariff_exposed", { mode: "boolean" })
      .notNull()
      .default(false),
    ...sharedColumns,
  },
  () => [dataOriginCheck],
);

/** ~1,200 SKUs; the Rainforest Basics private-label line flagged. */
export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable public display code, `SKU-…`. */
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    /** Rainforest Basics flag (catalog.md §2). */
    isPrivateLabel: integer("is_private_label", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Base unit cost in cents, before the quarterly landed-cost index. */
    unitCostCents: integer("unit_cost_cents").notNull(),
    listPriceCents: integer("list_price_cents").notNull(),
    firstSoldQuarter: text("first_sold_quarter").notNull(),
    /** Set on pruned SKUs; they retain history but stop selling. */
    discontinuedQuarter: text("discontinued_quarter"),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("products_category_idx").on(t.categoryId),
    index("products_supplier_idx").on(t.supplierId),
  ],
);

/**
 * Weekly snapshot time series per (SKU, FC): on-hand / reserved / inbound,
 * reorder point, days of cover (inventory.md §2).
 */
export const stockLevels = sqliteTable(
  "stock_levels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    /** Snapshot instant (the week boundary), epoch ms. */
    snapshotAt: integer("snapshot_at", { mode: "timestamp_ms" }).notNull(),
    quarterTag: text("quarter_tag").notNull(),
    onHand: integer("on_hand").notNull(),
    reserved: integer("reserved").notNull(),
    /** Open PO quantity inbound to this FC. */
    inbound: integer("inbound").notNull(),
    reorderPoint: integer("reorder_point").notNull(),
    daysOfCover: real("days_of_cover").notNull(),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    uniqueIndex("stock_levels_product_wh_snapshot_unique").on(
      t.productId,
      t.warehouseId,
      t.snapshotAt,
    ),
    index("stock_levels_warehouse_idx").on(t.warehouseId),
    index("stock_levels_quarter_idx").on(t.quarterTag),
  ],
);

/** Inbound POs to suppliers; lifecycle + promised vs. actual delivery. */
export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable public display code, `PO-…`. */
    code: text("code").notNull().unique(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    /** Receiving dock: ORD1 for imports, nearest regional FC for domestic. */
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    status: text("status", { enum: PO_STATUSES }).notNull(),
    quarterTag: text("quarter_tag").notNull(),
    orderedAt: integer("ordered_at", { mode: "timestamp_ms" }).notNull(),
    /** Promised dock date; lateness is measured against this. */
    promisedAt: integer("promised_at", { mode: "timestamp_ms" }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }),
    /** Total landed cost in cents (tariff index applied at line level). */
    totalLandedCents: integer("total_landed_cents").notNull(),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("purchase_orders_supplier_idx").on(t.supplierId),
    index("purchase_orders_warehouse_idx").on(t.warehouseId),
    index("purchase_orders_status_idx").on(t.status),
    index("purchase_orders_quarter_idx").on(t.quarterTag),
  ],
);

/** PO line items; unit cost carries the quarter's landed-cost index. */
export const purchaseOrderLines = sqliteTable(
  "purchase_order_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    purchaseOrderId: integer("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    /** Landed unit cost in cents at PO time (catalog.md §3). */
    unitCostCents: integer("unit_cost_cents").notNull(),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("purchase_order_lines_po_idx").on(t.purchaseOrderId),
    index("purchase_order_lines_product_idx").on(t.productId),
  ],
);

/** Customer orders; quarter tag, fulfillment lifecycle timestamps. */
export const salesOrders = sqliteTable(
  "sales_orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable public display code, `SO-…`. */
    code: text("code").notNull().unique(),
    /** Seed-generated customer pool reference (orders.md §3). */
    customerRef: text("customer_ref").notNull(),
    /** Fulfilling FC — nearest FC holding stock (orders.md §6). */
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    status: text("status", { enum: ORDER_STATUSES }).notNull(),
    serviceLevel: text("service_level", { enum: SERVICE_LEVELS }).notNull(),
    quarterTag: text("quarter_tag").notNull(),
    /** Order total in cents; per-quarter sums reconcile to GMV. */
    totalCents: integer("total_cents").notNull(),
    placedAt: integer("placed_at", { mode: "timestamp_ms" }).notNull(),
    allocatedAt: integer("allocated_at", { mode: "timestamp_ms" }),
    pickedAt: integer("picked_at", { mode: "timestamp_ms" }),
    shippedAt: integer("shipped_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    /** Promise date — the on-time denominator (orders.md §4). */
    promisedAt: integer("promised_at", { mode: "timestamp_ms" }).notNull(),
    /** Late-cause attribution; NULL when on time (orders.md §5). */
    lateCause: text("late_cause", { enum: LATE_CAUSES }),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("sales_orders_warehouse_idx").on(t.warehouseId),
    index("sales_orders_status_idx").on(t.status),
    index("sales_orders_quarter_idx").on(t.quarterTag),
    index("sales_orders_customer_idx").on(t.customerRef),
  ],
);

/** Order line items. */
export const salesOrderLines = sqliteTable(
  "sales_order_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    salesOrderId: integer("sales_order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("sales_order_lines_order_idx").on(t.salesOrderId),
    index("sales_order_lines_product_idx").on(t.productId),
  ],
);

/** Outbound shipments; carrier, promised vs. actual, late flags. */
export const shipments = sqliteTable(
  "shipments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable public display code, `SHP-…`. */
    code: text("code").notNull().unique(),
    salesOrderId: integer("sales_order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    carrier: text("carrier").notNull(),
    status: text("status", { enum: SHIPMENT_STATUSES }).notNull(),
    quarterTag: text("quarter_tag").notNull(),
    shippedAt: integer("shipped_at", { mode: "timestamp_ms" }),
    promisedAt: integer("promised_at", { mode: "timestamp_ms" }).notNull(),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    /** Derived late flag: delivered_at > promised_at (orders.md §5). */
    isLate: integer("is_late", { mode: "boolean" }).notNull().default(false),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("shipments_order_idx").on(t.salesOrderId),
    index("shipments_warehouse_idx").on(t.warehouseId),
    index("shipments_status_idx").on(t.status),
    index("shipments_quarter_idx").on(t.quarterTag),
  ],
);

/** Tickets with cluster tags (tickets.md §1); the corroboration walk's head. */
export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stable public display code, `TCK-…`. */
    code: text("code").notNull().unique(),
    clusterTag: text("cluster_tag", { enum: TICKET_CLUSTERS }).notNull(),
    /** Nullable only for `other`/account tickets (tickets.md §3). */
    salesOrderId: integer("sales_order_id").references(() => salesOrders.id, {
      onDelete: "set null",
    }),
    /** Required for `product-quality`; ~80% of `shipping-delay`. */
    productId: integer("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    channel: text("channel", { enum: TICKET_CHANNELS }).notNull(),
    status: text("status", { enum: TICKET_STATUSES }).notNull(),
    quarterTag: text("quarter_tag").notNull(),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    /** Lognormal, median 4 h (tickets.md §3); NULL until first response. */
    firstResponseMinutes: integer("first_response_minutes"),
    /** Lognormal, median 1.8 d; NULL until resolved. */
    resolutionMinutes: integer("resolution_minutes"),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("support_tickets_order_idx").on(t.salesOrderId),
    index("support_tickets_product_idx").on(t.productId),
    index("support_tickets_cluster_idx").on(t.clusterTag),
    index("support_tickets_status_idx").on(t.status),
    index("support_tickets_quarter_idx").on(t.quarterTag),
  ],
);

/**
 * Every agent decision: identity, idempotency key, reason, dry-run flag
 * (architecture §9.2). The entity pointer is deliberately soft — no hard FK —
 * so the record survives any wipe of the row it acted on.
 */
export const agentActions = sqliteTable(
  "agent_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agent: text("agent", { enum: AGENT_NAMES }).notNull(),
    /** Machine-readable verb, e.g. `purchase_order.created`. */
    action: text("action").notNull(),
    /** Re-delivered ticks with the same key must not double-act. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** Machine-readable reason string (includes the policy math). */
    reason: text("reason").notNull(),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
    /** Soft pointer to the affected row, e.g. (`purchase_orders`, 412). */
    entityTable: text("entity_table"),
    entityId: integer("entity_id"),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("agent_actions_agent_idx").on(t.agent),
    index("agent_actions_entity_idx").on(t.entityTable, t.entityId),
  ],
);

/**
 * Append-only trail of every mutation (architecture §9.3). No hard FKs and no
 * cascade: the trail must survive the demo wipe and the clock shift intact.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** `human:<user>` or `agent:<name>`. */
    actor: text("actor").notNull(),
    /** Machine-readable verb. */
    action: text("action").notNull(),
    entityTable: text("entity_table").notNull(),
    entityId: integer("entity_id").notNull(),
    /** Row snapshots, JSON-serialized; NULL when not applicable. */
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    /** Machine-readable reason (agents) or free text (humans). */
    reason: text("reason"),
    ...sharedColumns,
  },
  (t) => [
    dataOriginCheck,
    index("audit_log_entity_idx").on(t.entityTable, t.entityId),
    index("audit_log_actor_idx").on(t.actor),
    index("audit_log_action_idx").on(t.action),
  ],
);

/* ----------------------------------------------------------------------- */
/* Relations — one declaration per foreign key (architecture §4).           */
/* ----------------------------------------------------------------------- */

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  products: many(products),
  purchaseOrders: many(purchaseOrders),
}));

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  stockLevels: many(stockLevels),
  purchaseOrders: many(purchaseOrders),
  salesOrders: many(salesOrders),
  shipments: many(shipments),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  supplier: one(suppliers, {
    fields: [products.supplierId],
    references: [suppliers.id],
  }),
  stockLevels: many(stockLevels),
  purchaseOrderLines: many(purchaseOrderLines),
  salesOrderLines: many(salesOrderLines),
  supportTickets: many(supportTickets),
}));

export const stockLevelsRelations = relations(stockLevels, ({ one }) => ({
  product: one(products, {
    fields: [stockLevels.productId],
    references: [products.id],
  }),
  warehouse: one(warehouses, {
    fields: [stockLevels.warehouseId],
    references: [warehouses.id],
  }),
}));

export const purchaseOrdersRelations = relations(
  purchaseOrders,
  ({ one, many }) => ({
    supplier: one(suppliers, {
      fields: [purchaseOrders.supplierId],
      references: [suppliers.id],
    }),
    warehouse: one(warehouses, {
      fields: [purchaseOrders.warehouseId],
      references: [warehouses.id],
    }),
    lines: many(purchaseOrderLines),
  }),
);

export const purchaseOrderLinesRelations = relations(
  purchaseOrderLines,
  ({ one }) => ({
    purchaseOrder: one(purchaseOrders, {
      fields: [purchaseOrderLines.purchaseOrderId],
      references: [purchaseOrders.id],
    }),
    product: one(products, {
      fields: [purchaseOrderLines.productId],
      references: [products.id],
    }),
  }),
);

export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [salesOrders.warehouseId],
    references: [warehouses.id],
  }),
  lines: many(salesOrderLines),
  shipments: many(shipments),
  supportTickets: many(supportTickets),
}));

export const salesOrderLinesRelations = relations(salesOrderLines, ({ one }) => ({
  salesOrder: one(salesOrders, {
    fields: [salesOrderLines.salesOrderId],
    references: [salesOrders.id],
  }),
  product: one(products, {
    fields: [salesOrderLines.productId],
    references: [products.id],
  }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  salesOrder: one(salesOrders, {
    fields: [shipments.salesOrderId],
    references: [salesOrders.id],
  }),
  warehouse: one(warehouses, {
    fields: [shipments.warehouseId],
    references: [warehouses.id],
  }),
}));

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  salesOrder: one(salesOrders, {
    fields: [supportTickets.salesOrderId],
    references: [salesOrders.id],
  }),
  product: one(products, {
    fields: [supportTickets.productId],
    references: [products.id],
  }),
}));
