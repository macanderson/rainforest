import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { runMigrations } from "../lib/db/migrate.mjs";
import * as schema from "../lib/db/schema.ts";

const dir = mkdtempSync(join(tmpdir(), "rf-schema-"));
const dbPath = join(dir, "test.db");
runMigrations(dbPath);
const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const DOMAIN_TABLES = [
  "suppliers",
  "warehouses",
  "categories",
  "products",
  "stock_levels",
  "purchase_orders",
  "purchase_order_lines",
  "sales_orders",
  "sales_order_lines",
  "shipments",
  "support_tickets",
  "agent_actions",
  "audit_log",
];

const QUARTER_TAGGED_TABLES = [
  "stock_levels",
  "purchase_orders",
  "sales_orders",
  "shipments",
  "support_tickets",
];

function tableInfo(table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all();
}

function indexList(table) {
  return sqlite.prepare(`PRAGMA index_list(${table})`).all();
}

describe("db/schema — the thirteen core tables (architecture.md §4)", () => {
  it("defines all thirteen tables in Drizzle and in the migrated database", () => {
    for (const table of DOMAIN_TABLES) {
      assert.ok(schema[table.replace(/_([a-z])/g, (_, c) => c.toUpperCase())],
        `schema export for ${table}`);
      assert.ok(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table),
        `${table} exists in the migrated database`,
      );
    }
  });

  it("every table carries the shared columns with the data_origin CHECK (§3)", () => {
    for (const table of [...DOMAIN_TABLES, "drizzle_migrations"]) {
      const cols = tableInfo(table).map((c) => c.name);
      for (const shared of ["data_origin", "created_at", "updated_at"]) {
        assert.ok(cols.includes(shared), `${table}.${shared} exists`);
      }
      const ddl = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE name=?")
        .get(table).sql;
      assert.match(
        ddl,
        /CHECK\(data_origin in \('seed', 'demo', 'agent'\)\)/,
        `${table} enforces the data_origin CHECK`,
      );
    }
  });

  it("every table has an integer autoincrement primary key", () => {
    for (const table of DOMAIN_TABLES) {
      const pk = tableInfo(table).filter((c) => c.pk === 1);
      assert.equal(pk.length, 1, `${table} has exactly one PK column`);
      assert.equal(pk[0].name, "id");
      assert.equal(pk[0].type.toUpperCase(), "INTEGER");
      const ddl = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE name=?")
        .get(table).sql;
      assert.match(ddl, /AUTOINCREMENT/i, `${table}.id autoincrements`);
    }
  });

  it("stable public display codes are unique (SKU-…, PO-…, SO-…, …)", () => {
    const codeColumns = {
      suppliers: "code",
      warehouses: "code",
      products: "sku",
      purchase_orders: "code",
      sales_orders: "code",
      shipments: "code",
      support_tickets: "code",
    };
    for (const [table, col] of Object.entries(codeColumns)) {
      const unique = indexList(table).some(
        (idx) =>
          idx.unique === 1 &&
          sqlite
            .prepare(`PRAGMA index_info(${idx.name})`)
            .all()
            .map((c) => c.name)
            .join(",") === col,
      );
      assert.ok(unique, `${table}.${col} has a unique index`);
    }
  });

  it("money is integer cents and precision percentages are integer basis points", () => {
    const cents = {
      products: ["unit_cost_cents", "list_price_cents"],
      purchase_orders: ["total_landed_cents"],
      purchase_order_lines: ["unit_cost_cents"],
      sales_orders: ["total_cents"],
      sales_order_lines: ["unit_price_cents"],
    };
    for (const [table, cols] of Object.entries(cents)) {
      const info = tableInfo(table);
      for (const col of cols) {
        assert.equal(
          info.find((c) => c.name === col)?.type.toUpperCase(),
          "INTEGER",
          `${table}.${col} is integer cents`,
        );
      }
    }
    const onTime = tableInfo("suppliers").find(
      (c) => c.name === "lifetime_on_time_bps",
    );
    assert.equal(onTime.type.toUpperCase(), "INTEGER");
  });

  it("seed-facing tables carry a quarter tag (architecture §8)", () => {
    for (const table of QUARTER_TAGGED_TABLES) {
      const col = tableInfo(table).find((c) => c.name === "quarter_tag");
      assert.ok(col, `${table}.quarter_tag exists`);
      assert.equal(col.notnull, 1, `${table}.quarter_tag is NOT NULL`);
    }
  });

  it("indexes cover foreign keys and query-hot columns", () => {
    const indexed = (table, col) =>
      indexList(table).some((idx) =>
        sqlite
          .prepare(`PRAGMA index_info(${idx.name})`)
          .all()
          .some((c) => c.name === col),
      );
    // Foreign-key columns.
    for (const [table, col] of [
      ["products", "category_id"],
      ["products", "supplier_id"],
      ["stock_levels", "product_id"],
      ["stock_levels", "warehouse_id"],
      ["purchase_orders", "supplier_id"],
      ["purchase_orders", "warehouse_id"],
      ["purchase_order_lines", "purchase_order_id"],
      ["purchase_order_lines", "product_id"],
      ["sales_orders", "warehouse_id"],
      ["sales_order_lines", "sales_order_id"],
      ["sales_order_lines", "product_id"],
      ["shipments", "sales_order_id"],
      ["shipments", "warehouse_id"],
      ["support_tickets", "sales_order_id"],
      ["support_tickets", "product_id"],
    ]) {
      assert.ok(indexed(table, col), `${table}(${col}) is indexed`);
    }
    // Query-hot columns: quarter tags, order/PO status, SKU code.
    for (const table of QUARTER_TAGGED_TABLES) {
      assert.ok(indexed(table, "quarter_tag"), `${table}(quarter_tag) indexed`);
    }
    for (const [table, col] of [
      ["purchase_orders", "status"],
      ["sales_orders", "status"],
      ["shipments", "status"],
      ["support_tickets", "status"],
      ["products", "sku"],
    ]) {
      assert.ok(indexed(table, col), `${table}(${col}) is indexed`);
    }
  });

  it("declares a Drizzle relation for every foreign key", () => {
    const relationsByTable = {
      products: ["category", "supplier"],
      stockLevels: ["product", "warehouse"],
      purchaseOrders: ["supplier", "warehouse"],
      purchaseOrderLines: ["purchaseOrder", "product"],
      salesOrders: ["warehouse"],
      salesOrderLines: ["salesOrder", "product"],
      shipments: ["salesOrder", "warehouse"],
      supportTickets: ["salesOrder", "product"],
    };
    for (const [table, rels] of Object.entries(relationsByTable)) {
      const rel = schema[`${table}Relations`];
      assert.ok(rel, `${table}Relations is exported`);
      // The relations config is a function of the { one, many } helpers;
      // invoke it with pass-through stubs to inspect the declared keys.
      const stub = () => {
        const rel = { kind: "one" };
        rel.withFieldName = () => rel;
        return rel;
      };
      const declared = rel.config({ one: stub, many: stub });
      for (const name of rels) {
        assert.ok(declared[name], `${table}Relations.${name} declared`);
        assert.equal(declared[name].kind, "one");
      }
    }
  });
});

describe("db/schema — cascade behavior (demo-wipe-safe, E6#3)", () => {
  const seed = () => {
    const q = "2025-Q3";
    sqlite
      .prepare(
        `INSERT INTO suppliers (code, name, location, is_import, active_from_quarter, lifetime_on_time_bps, mean_days_late_hundredths, data_origin)
         VALUES ('SUP-001', 'Test Supplier', 'Toledo, US', 0, '2021-Q1', 9800, 100, 'seed')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO warehouses (code, name, city, state, opened_quarter, sqft_k, role, data_origin)
         VALUES ('TST1', 'Test FC', 'Columbus', 'OH', '2021-Q1', 100, 'Test', 'seed')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO categories (name, tariff_exposed, data_origin) VALUES ('Test Cat', 0, 'seed')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO products (sku, name, category_id, supplier_id, is_private_label, unit_cost_cents, list_price_cents, first_sold_quarter, data_origin)
         VALUES ('SKU-001', 'Test SKU', 1, 1, 0, 500, 999, '2021-Q1', 'seed')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO sales_orders (code, customer_ref, warehouse_id, status, service_level, quarter_tag, total_cents, placed_at, promised_at, data_origin)
         VALUES ('SO-001', 'CUST-1', 1, 'delivered', 'two_day', ?, 999, 1, 2, 'demo')`,
      )
      .run(q);
    sqlite
      .prepare(
        `INSERT INTO sales_order_lines (sales_order_id, product_id, quantity, unit_price_cents, data_origin)
         VALUES (1, 1, 1, 999, 'demo')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO shipments (code, sales_order_id, warehouse_id, carrier, status, quarter_tag, promised_at, is_late, data_origin)
         VALUES ('SHP-001', 1, 1, 'Test Carrier', 'delivered', ?, 2, 0, 'demo')`,
      )
      .run(q);
    sqlite
      .prepare(
        `INSERT INTO support_tickets (code, cluster_tag, sales_order_id, product_id, channel, status, quarter_tag, opened_at, data_origin)
         VALUES ('TCK-001', 'shipping-delay', 1, 1, 'email', 'open', ?, 1, 'demo')`,
      )
      .run(q);
    sqlite
      .prepare(
        `INSERT INTO purchase_orders (code, supplier_id, warehouse_id, status, quarter_tag, ordered_at, promised_at, total_landed_cents, data_origin)
         VALUES ('PO-001', 1, 1, 'issued', ?, 1, 2, 5000, 'demo')`,
      )
      .run(q);
    sqlite
      .prepare(
        `INSERT INTO purchase_order_lines (purchase_order_id, product_id, quantity, unit_cost_cents, data_origin)
         VALUES (1, 1, 10, 500, 'demo')`,
      )
      .run();
  };

  it("deleting a demo order cascades to its lines and shipments", () => {
    seed();
    sqlite.prepare("DELETE FROM sales_orders WHERE data_origin = 'demo'").run();
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) n FROM sales_order_lines").get().n,
      0,
      "order lines cascade-deleted",
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) n FROM shipments").get().n,
      0,
      "shipments cascade-deleted",
    );
  });

  it("deleting a demo order unlinks (SET NULL) rather than deletes tickets", () => {
    const ticket = sqlite
      .prepare("SELECT sales_order_id, product_id FROM support_tickets")
      .get();
    assert.equal(ticket.sales_order_id, null, "ticket order FK set null");
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) n FROM support_tickets").get().n,
      1,
      "ticket row survives the wipe",
    );
  });

  it("deleting a demo PO cascades to its lines", () => {
    sqlite.prepare("DELETE FROM purchase_orders WHERE data_origin = 'demo'").run();
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) n FROM purchase_order_lines").get().n,
      0,
      "PO lines cascade-deleted",
    );
  });

  it("reference FKs into the seed backbone RESTRICT deletion", () => {
    // Fresh references: a PO pins the supplier and warehouse, an order line
    // pins the product (ticket FKs are SET NULL by design, so they unlink
    // rather than block).
    sqlite
      .prepare(
        `INSERT INTO purchase_orders (code, supplier_id, warehouse_id, status, quarter_tag, ordered_at, promised_at, total_landed_cents, data_origin)
         VALUES ('PO-002', 1, 1, 'issued', '2025-Q3', 1, 2, 100, 'demo')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO sales_orders (code, customer_ref, warehouse_id, status, service_level, quarter_tag, total_cents, placed_at, promised_at, data_origin)
         VALUES ('SO-002', 'CUST-2', 1, 'placed', 'two_day', '2025-Q3', 100, 1, 2, 'demo')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO sales_order_lines (sales_order_id, product_id, quantity, unit_price_cents, data_origin)
         VALUES (2, 1, 1, 100, 'demo')`,
      )
      .run();
    assert.throws(
      () => sqlite.prepare("DELETE FROM products WHERE id = 1").run(),
      /FOREIGN KEY constraint failed/,
      "cannot delete a product still referenced by an order line",
    );
    assert.throws(
      () => sqlite.prepare("DELETE FROM suppliers WHERE id = 1").run(),
      /FOREIGN KEY constraint failed/,
      "cannot delete a supplier still referenced by a product/PO",
    );
    assert.throws(
      () => sqlite.prepare("DELETE FROM warehouses WHERE id = 1").run(),
      /FOREIGN KEY constraint failed/,
      "cannot delete a warehouse still referenced by an order/PO",
    );
    // Leaf-first demo wipe is permitted by the restrict rules.
    sqlite.prepare("DELETE FROM sales_order_lines WHERE data_origin = 'demo'").run();
    sqlite.prepare("DELETE FROM sales_orders WHERE data_origin = 'demo'").run();
    sqlite.prepare("DELETE FROM purchase_orders WHERE data_origin = 'demo'").run();
  });

  it("foreign_keys pragma is honored and rejects orphan writes", () => {
    assert.throws(
      () =>
        sqlite
          .prepare(
            `INSERT INTO sales_order_lines (sales_order_id, product_id, quantity, unit_price_cents, data_origin)
             VALUES (9999, 1, 1, 1, 'demo')`,
          )
          .run(),
      /FOREIGN KEY constraint failed/,
    );
  });

  it("agent_actions enforces idempotency keys and audit_log is appendable", () => {
    sqlite
      .prepare(
        `INSERT INTO agent_actions (agent, action, idempotency_key, reason, dry_run, data_origin)
         VALUES ('auto-reorder', 'purchase_order.created', 'key-1', 'position < ROP', 0, 'agent')`,
      )
      .run();
    assert.throws(
      () =>
        sqlite
          .prepare(
            `INSERT INTO agent_actions (agent, action, idempotency_key, reason, dry_run, data_origin)
             VALUES ('auto-reorder', 'purchase_order.created', 'key-1', 'dup', 0, 'agent')`,
          )
          .run(),
      /UNIQUE constraint failed/,
      "duplicate idempotency key rejected",
    );
    sqlite
      .prepare(
        `INSERT INTO audit_log (actor, action, entity_table, entity_id, after_json, reason, data_origin)
         VALUES ('agent:auto-reorder', 'purchase_order.created', 'purchase_orders', 1, '{}', 'position < ROP', 'agent')`,
      )
      .run();
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) n FROM audit_log").get().n,
      1,
    );
  });
});
