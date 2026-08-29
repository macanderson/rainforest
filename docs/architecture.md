# Architecture

This document is the binding technical specification for the Rainforest demo application — the ops
control plane that the "Fulfillment Flywheel" fiction says runs the business. Every issue in the
backlog builds against the decisions recorded here. This repository itself contains **no application
code**; the app described below is built by the autonomous agent working the issue backlog.

Canonical companions:

- [`../RAINFOREST.md`](../RAINFOREST.md) — the business fiction.
- [`../data/numbers-bible.json`](../data/numbers-bible.json) — canonical quarterly metrics (machine-readable).
- [`numbers-bible.md`](numbers-bible.md) — the bible rendered as narrative.
- `data-specs/` — per-domain data distributions, all derived from the bible.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict; no `any`) |
| Framework | Next.js **16** — App Router, Turbopack |
| Components | `@base-ui-components/react` |
| Styling | Tailwind CSS with a **locked** black/white/red token sheet (§2) |
| ORM / DB | Drizzle ORM + SQLite via `better-sqlite3` |
| Validation | Zod at every boundary (API input, seed generators, bible loader) |
| Auth / sessions | `iron-session`, credential (email + password) auth, three roles (§5) |
| Charts | Recharts — sparingly. KPI tiles and dense tables carry the enterprise feel; charts are garnish |

Rationale in brief: a single-writer demo workload with nightly batch jobs is SQLite's home turf;
Next.js 16 standalone output plus better-sqlite3 runs comfortably on one small box (§7); Base UI is
unstyled, so the locked palette is enforceable rather than fought.

---

## 2. Design tokens — the locked black/white/red sheet

The entire visual identity is **black, white, red, and grey. No other hue is permitted anywhere in
the app.** A lint rule (E1#1) rejects any color literal or Tailwind class outside this sheet.

### 2.1 Core

| Token | Value | Use |
|---|---|---|
| `black` | `#000000` | Topbar, sidebar surfaces, `status:blocked`-style emphasis, text on light |
| `white` | `#ffffff` | Content plane, text on dark |

Pure `#000` and pure `#fff` — not near-black or off-white.

### 2.2 Red scale (accent — alerts, CTAs, deltas, low-stock flags)

| Token | Value |
|---|---|
| `red-900` | `#7f1d1d` |
| `red-800` | `#991b1b` |
| `red-700` | `#b91c1c` |
| `red-600` | `#dc2626` |
| `red-500` | `#ef4444` |
| `red-400` | `#f87171` |
| `red-300` | `#fca5a5` |

Red is an **accent**, never a surface wash: alerts, destructive actions, primary CTAs, negative
deltas, late-shipment badges, low-stock rows. If a screen is more red than white, it is wrong.

### 2.3 Grey scale (chrome — borders, secondary text, table zebra, disabled states)

| Token | Value |
|---|---|
| `grey-900` | `#111827` |
| `grey-800` | `#1f2937` |
| `grey-700` | `#374151` |
| `grey-600` | `#4b5563` |
| `grey-500` | `#6b7280` |
| `grey-400` | `#9ca3af` |
| `grey-300` | `#d1d5db` |
| `grey-200` | `#e5e7eb` |
| `grey-100` | `#f3f4f6` |
| `grey-50`  | `#f9fafb` |

The Tailwind config exposes **only** these tokens; the default palette is stripped. The repo's
GitHub label colors intentionally reuse this exact sheet.

### 2.4 Layout idiom

Black topbar · dense grey-bordered sidebar · white content plane · red used only where the eye must
go. Enterprise density over whitespace: virtualized tables, tight KPI tile rows, drill-through links.

---

## 3. The `data_origin` column convention

Every table carries three shared columns:

| Column | Type | Meaning |
|---|---|---|
| `data_origin` | `'seed' \| 'demo' \| 'agent'` | Who created this row |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

- **`seed`** — produced by the deterministic seed generators from the numbers bible. The clock-shift
  job (§8) moves only these rows.
- **`demo`** — created during a live sales demo by a `sales-rep` session. Middleware stamps this
  automatically; unit tests prove no write path can create demo data unstamped (E6#1). The nightly
  wipe deletes exactly these rows.
- **`agent`** — written by the automation agents (§9). Never wiped; always paired with an
  `audit_log` entry.

This one column is what makes the living demo possible: shift `seed`, wipe `demo`, keep `agent`.

---

## 4. Schema overview

Thirteen tables (E2#1), all honoring the shared columns from §3, with Drizzle relations and indexes:

| Table | Purpose |
|---|---|
| `suppliers` | Supplier roster with SLA attributes (see `data-specs/suppliers.md`) |
| `warehouses` | The 11 fulfillment centers, including Warehouse Zero |
| `categories` | 9 product categories; tariff-exposed ones flagged |
| `products` | ~1,200 SKUs; `Rainforest Basics` private-label line flagged |
| `stock_levels` | On-hand / reserved per SKU per warehouse, reorder points, snapshots |
| `purchase_orders` | Inbound POs to suppliers; lifecycle + promised vs. actual delivery |
| `purchase_order_lines` | PO line items |
| `sales_orders` | Customer orders; quarter tag (§8), fulfillment lifecycle timestamps |
| `sales_order_lines` | Order line items |
| `shipments` | Outbound shipments; carrier, promised vs. actual, late flags |
| `support_tickets` | Tickets with cluster tags (shipping-delay, quality, billing) |
| `agent_actions` | Every agent decision: identity, idempotency key, reason, dry-run flag |
| `audit_log` | Append-only trail of every mutation (§9.3) |

Conventions:

- Integer autoincrement primary keys (SQLite rowid-friendly); stable public codes (`SKU-…`,
  `PO-…`, `SO-…`) for display.
- Foreign keys enforced (`PRAGMA foreign_keys = ON`); cascade behavior explicit per relation,
  designed so the demo wipe (E6#3) is cascade-safe.
- Money stored as integer cents; percentages as numeric basis points where precision matters.
- Seeded rows carry a quarter tag aligned to the numbers bible so reconciliation buckets by tag,
  not wall clock (§8).

---

## 5. Auth and roles

`iron-session` cookie sessions; credential login only (this is a demo box, not an IdP integration).
Three roles:

| Role | Who | Powers |
|---|---|---|
| `admin` | Demo operator | Everything: approvals, job observability, agent config |
| `sales-rep` | Person giving the demo | Normal app use; **every row they create is stamped `data_origin='demo'`** and wiped nightly |
| `agent` | The automation agents (§9) | API-only; authenticated via bearer secret on the cron endpoints, never an interactive session |

Seeded demo accounts for `admin` and `sales-rep` ship with the seed (E8#4). Navigation is
role-aware (E1#4).

---

## 6. Data integrity — the numbers bible and `pnpm reconcile`

`data/numbers-bible.json` (23 quarterly rows, Q1-2021→Q3-2026) is the single source of truth for
every financial and operational figure. A typed loader (E2#2) exposes per-quarter targets to the
seed generators, the P&L derivation layer, and the reports UI — nobody restates a number.

`pnpm reconcile` (E2#3) is CI-blocking whenever `data/` or seed code changes. It checks:

1. **Bible-internal identities** — `orders_k × aov_usd ≈ gmv_usd_m × 1000` (±1%);
   `revenue = 1P GMV + take_rate × 3P GMV` (±1%); margin / net-income consistency with the
   modeled opex schedule.
2. **DB vs. bible** — aggregates the seeded database per quarter (revenue, orders, AOV, on-time %,
   tickets/1K) and diffs against the bible within **±2%**.

Editorial discipline drifts; CI doesn't.

---

## 7. Deploy target — one Lightsail box

**A single AWS Lightsail instance (2 GB RAM, ~$12/mo) running the Next.js standalone build, the
SQLite database file, and system cron, with Caddy terminating TLS.**

### 7.1 Why this and not serverless

- **Flat, tiny cost.** ~$12/mo total, all-in. No per-request billing to reason about.
- **Zero cold starts.** A 15-second Aurora Serverless v2 auto-pause resume in the middle of a live
  sales demo is disqualifying. Lambda+Aurora's idle cost is near-zero, but its complexity and
  demo-time latency are not.
- **SQLite fits the workload.** Single writer, modest read volume, and the nightly wipe/shift jobs
  become trivial local transactions instead of distributed operations.
- **SQLite-on-EFS is rejected outright.** NFS advisory locking is a documented SQLite corruption
  footgun; the database lives on the instance's local disk, backed up before every deploy (E7#3).
- **System cron is the scheduler.** Agent ticks and demo jobs are host cron entries hitting
  authenticated endpoints (§9.2) — no queue infrastructure for a demo box.

### 7.2 Topology

```
[ Lightsail 2 GB, static IP, firewall 80/443/22 ]
  Caddy (TLS, reverse proxy :443 → :3000)
  Next.js 16 standalone (node, port 3000)
  /var/lib/rainforest/rainforest.db   (SQLite, local disk)
  system crontab:
    agent ticks   → POST /api/agents/run/<agent>   (bearer secret)
    04:00 UTC     → clock-shift job (+1 day on seed rows)
    08:00 UTC     → demo-wipe job (delete demo rows, restore mutated seed)
```

Deploys: GitHub Actions builds the Docker image (Next standalone output, SQLite volume mount,
healthcheck), pushes it to a registry, and SSH-deploys with an atomic swap; the SQLite file is
backed up before each swap. `/api/health` verifies DB reachability and last-job freshness; deploys
are verified by a live query, not logs (E7#5).

### 7.3 The Postgres escape hatch

The Drizzle schema deliberately avoids SQLite-only constructs so it stays **Postgres-portable**: if
the demo ever needs concurrent writers or horizontal scale, the migration path is Drizzle's
`pg-core` dialect plus a managed Postgres — a driver-and-migrations change, not a redesign. This is
an escape hatch, not a plan; the demo workload does not need it.

---

## 8. The living demo — `DEMO_EPOCH` and the clock-shift mechanism

The demo must always look like it is happening *now*: yesterday's orders were placed yesterday,
this quarter's KPIs are this quarter's. Two mechanisms deliver that:

1. **`DEMO_EPOCH` anchor.** Seeded rows are generated with timestamps relative to a fixed
   `DEMO_EPOCH` constant **and carry an explicit quarter tag** (e.g. `2025-Q3`) that maps the row
   to its numbers-bible quarter. All bible reconciliation buckets by quarter tag, **never** by
   wall-clock timestamp.
2. **Daily +1-day clock-shift job (04:00 UTC).** Shifts every timestamp on `data_origin='seed'`
   rows forward one day, inside a single transaction, guarded by an idempotency ledger that refuses
   a double run for the same day. Because reconciliation keys on quarter tags rather than
   timestamps, the shift can never break `pnpm reconcile` — the postcondition run proves it.

Alongside it, the **nightly demo-wipe job (08:00 UTC)** deletes all `data_origin='demo'` rows
(cascade-safe) and restores any seed rows a demo session mutated. A job observability page (E6#4)
shows last run, rows shifted/wiped, duration, failures, and a red banner if a job missed its window.

---

## 9. The agent-automation loop

The pivot fiction says AI agents run operations; the app makes that literally true and **visibly
auditable** — the agent activity feed is the demo money-shot.

### 9.1 Agents

| Agent | Policy |
|---|---|
| Auto-reorder | Reorder when `on_hand + inbound < reorder_point`; EOQ-lite quantity; supplier selection penalizes SLA laggards (post-pivot it visibly routes away from Brightline Electronics Co.); writes POs to a human approval queue, auto-approving under a configurable spend threshold |
| Fulfillment | Advances open orders through allocate→pick→ship against available stock each tick; releases backorders when stock arrives |
| Exception | Flags shipments past SLA, drafts supplier escalation notes, opens linked support-ticket annotations; feeds the insight cards |

### 9.2 Loop shape — cron-triggered endpoints

There is no resident daemon. Each agent is an authenticated HTTP endpoint:

```
POST /api/agents/run/[agent]     Authorization: Bearer <secret from env file>
```

Host cron (§7.2) hits each endpoint on its schedule. Every tick writes a row to a **run ledger**
(agent, started/finished, actions taken, outcome), surfaced on the job observability page. Agent
actions carry **idempotency keys** so a re-delivered tick cannot double-order, and every agent
supports a **dry-run mode** that records intended actions without mutating state.

### 9.3 Audit trail with actor identity

Every mutation in the system — human or agent — writes an `audit_log` row:

| Field | Content |
|---|---|
| `actor` | `human:<user>` or `agent:<name>` |
| `action` | Machine-readable verb |
| `before` / `after` | Row snapshots |
| `reason` | Machine-readable reason string (agents) or free text (humans) |

`audit_log` is append-only. Agent writes additionally stamp `data_origin='agent'`. The UI's agent
activity feed and the reorder approval queue both render straight from this trail — the
transparency surface is the same data the compliance story stands on.

---

## 10. Non-goals

- No multi-tenancy, no IdP/SSO, no email — it is a demo box.
- No Postgres, no queues, no Kubernetes — see §7.3 for the one sanctioned escape hatch.
- No colors outside §2. Ever.
