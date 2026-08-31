CREATE TABLE `agent_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent` text NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`reason` text NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`entity_table` text,
	`entity_id` integer,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_actions_idempotency_key_unique` ON `agent_actions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_actions_agent_idx` ON `agent_actions` (`agent`);--> statement-breakpoint
CREATE INDEX `agent_actions_entity_idx` ON `agent_actions` (`entity_table`,`entity_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_table` text NOT NULL,
	`entity_id` integer NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_table`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`tariff_exposed` integer DEFAULT false NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category_id` integer NOT NULL,
	`supplier_id` integer NOT NULL,
	`is_private_label` integer DEFAULT false NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`list_price_cents` integer NOT NULL,
	`first_sold_quarter` text NOT NULL,
	`discontinued_quarter` text,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_supplier_idx` ON `products` (`supplier_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `purchase_order_lines_po_idx` ON `purchase_order_lines` (`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `purchase_order_lines_product_idx` ON `purchase_order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`status` text NOT NULL,
	`quarter_tag` text NOT NULL,
	`ordered_at` integer NOT NULL,
	`promised_at` integer NOT NULL,
	`received_at` integer,
	`total_landed_cents` integer NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_code_unique` ON `purchase_orders` (`code`);--> statement-breakpoint
CREATE INDEX `purchase_orders_supplier_idx` ON `purchase_orders` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `purchase_orders_warehouse_idx` ON `purchase_orders` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `purchase_orders_status_idx` ON `purchase_orders` (`status`);--> statement-breakpoint
CREATE INDEX `purchase_orders_quarter_idx` ON `purchase_orders` (`quarter_tag`);--> statement-breakpoint
CREATE TABLE `sales_order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sales_order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE INDEX `sales_order_lines_order_idx` ON `sales_order_lines` (`sales_order_id`);--> statement-breakpoint
CREATE INDEX `sales_order_lines_product_idx` ON `sales_order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `sales_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`customer_ref` text NOT NULL,
	`warehouse_id` integer NOT NULL,
	`status` text NOT NULL,
	`service_level` text NOT NULL,
	`quarter_tag` text NOT NULL,
	`total_cents` integer NOT NULL,
	`placed_at` integer NOT NULL,
	`allocated_at` integer,
	`picked_at` integer,
	`shipped_at` integer,
	`delivered_at` integer,
	`promised_at` integer NOT NULL,
	`late_cause` text,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_orders_code_unique` ON `sales_orders` (`code`);--> statement-breakpoint
CREATE INDEX `sales_orders_warehouse_idx` ON `sales_orders` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `sales_orders_status_idx` ON `sales_orders` (`status`);--> statement-breakpoint
CREATE INDEX `sales_orders_quarter_idx` ON `sales_orders` (`quarter_tag`);--> statement-breakpoint
CREATE INDEX `sales_orders_customer_idx` ON `sales_orders` (`customer_ref`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`sales_order_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`carrier` text NOT NULL,
	`status` text NOT NULL,
	`quarter_tag` text NOT NULL,
	`shipped_at` integer,
	`promised_at` integer NOT NULL,
	`delivered_at` integer,
	`is_late` integer DEFAULT false NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_code_unique` ON `shipments` (`code`);--> statement-breakpoint
CREATE INDEX `shipments_order_idx` ON `shipments` (`sales_order_id`);--> statement-breakpoint
CREATE INDEX `shipments_warehouse_idx` ON `shipments` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `shipments_status_idx` ON `shipments` (`status`);--> statement-breakpoint
CREATE INDEX `shipments_quarter_idx` ON `shipments` (`quarter_tag`);--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`warehouse_id` integer NOT NULL,
	`snapshot_at` integer NOT NULL,
	`quarter_tag` text NOT NULL,
	`on_hand` integer NOT NULL,
	`reserved` integer NOT NULL,
	`inbound` integer NOT NULL,
	`reorder_point` integer NOT NULL,
	`days_of_cover` real NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_levels_product_wh_snapshot_unique` ON `stock_levels` (`product_id`,`warehouse_id`,`snapshot_at`);--> statement-breakpoint
CREATE INDEX `stock_levels_warehouse_idx` ON `stock_levels` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `stock_levels_quarter_idx` ON `stock_levels` (`quarter_tag`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`location` text NOT NULL,
	`is_import` integer NOT NULL,
	`active_from_quarter` text NOT NULL,
	`active_to_quarter` text,
	`lifetime_on_time_bps` integer NOT NULL,
	`mean_days_late_hundredths` integer NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_code_unique` ON `suppliers` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_name_unique` ON `suppliers` (`name`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`cluster_tag` text NOT NULL,
	`sales_order_id` integer,
	`product_id` integer,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`quarter_tag` text NOT NULL,
	`opened_at` integer NOT NULL,
	`first_response_minutes` integer,
	`resolution_minutes` integer,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_tickets_code_unique` ON `support_tickets` (`code`);--> statement-breakpoint
CREATE INDEX `support_tickets_order_idx` ON `support_tickets` (`sales_order_id`);--> statement-breakpoint
CREATE INDEX `support_tickets_product_idx` ON `support_tickets` (`product_id`);--> statement-breakpoint
CREATE INDEX `support_tickets_cluster_idx` ON `support_tickets` (`cluster_tag`);--> statement-breakpoint
CREATE INDEX `support_tickets_status_idx` ON `support_tickets` (`status`);--> statement-breakpoint
CREATE INDEX `support_tickets_quarter_idx` ON `support_tickets` (`quarter_tag`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`opened_quarter` text NOT NULL,
	`sqft_k` integer NOT NULL,
	`role` text NOT NULL,
	`data_origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "data_origin_check" CHECK(data_origin in ('seed', 'demo', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_code_unique` ON `warehouses` (`code`);