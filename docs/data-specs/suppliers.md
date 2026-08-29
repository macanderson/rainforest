# Data spec — Suppliers

**Source of truth:** [`data/numbers-bible.json`](../../data/numbers-bible.json). Every
distribution in this spec derives from the bible; where this spec and the bible disagree, the
bible wins and this spec is a defect. All entities are fictional.

This spec governs the `suppliers`, `purchase_orders`, and `purchase_order_lines` seed generators
(E3#2) and the supplier scorecard UI (E4#4). Its aggregates are enforced by `pnpm reconcile`
(see [`reconciliation.md`](reconciliation.md)).

---

## 1. Roster — 22 suppliers

Four suppliers are **named, locked canon** (their SLA figures may not be altered by any
generator or doc): Brightline Electronics Co., Apex Plastics Manufacturing, Great Lakes
Packaging, and Saigon Circuit Works.

| # | Supplier | Location | Categories supplied | Active window | Lifetime on-time % | Mean days late (late POs) |
|---|---|---|---|---|---|---|
| 1 | **Brightline Electronics Co.** | Shenzhen, CN | Consumer Electronics | 2021-Q1 → 2025-Q4 (dropped) | **71** | **8.5** |
| 2 | **Apex Plastics Manufacturing** | Dongguan, CN | Home & Kitchen (plastics), Toys & Games | 2021-Q1 → present | **76** (through 2025-Q4) | 5.2 |
| 3 | **Great Lakes Packaging** | Toledo, OH | Packaging & shipping supplies (all categories) | 2021-Q1 → present | **98** | 1.2 |
| 4 | **Saigon Circuit Works** | Ho Chi Minh City, VN | Consumer Electronics | **onboarded 2026-Q1** → present | **95** | 1.8 |
| 5 | Dragon Gate Components | Shenzhen, CN | Consumer Electronics (accessories) | 2021-Q1 → present | 91 | 3.6 |
| 6 | Sterling Housewares Ltd. | Guangzhou, CN | Small Kitchen Appliances | 2021-Q1 → present | 89 | 3.9 |
| 7 | Golden Harbor Appliance Works | Foshan, CN | Small Kitchen Appliances | 2021-Q1 → present | 91 | 3.4 |
| 8 | Pearl River Toy Manufactory | Shantou, CN | Toys & Games | 2021-Q1 → present | 90 | 3.8 |
| 9 | Monterrey Kitchen Metals S.A. | Monterrey, MX | Small Kitchen Appliances | **onboarded 2026-Q2** → present | 94 | 2.1 |
| 10 | Buckeye Foods Distribution | Columbus, OH | Grocery & Pantry | 2021-Q1 → present | 96 | 1.4 |
| 11 | Riverbend Grocery Partners | St. Louis, MO | Grocery & Pantry | 2021-Q1 → present | 95 | 1.6 |
| 12 | Miami Valley Paper Co. | Dayton, OH | Cleaning & Household | 2021-Q1 → present | 97 | 1.1 |
| 13 | Blue Ridge Cleaning Products | Roanoke, VA | Cleaning & Household | 2021-Q1 → present | 95 | 1.5 |
| 14 | Chesapeake Paper & Disposables | Baltimore, MD | Cleaning & Household | 2021-Q1 → present | 94 | 1.8 |
| 15 | Prairie Personal Care Labs | Des Moines, IA | Health & Personal Care | 2021-Q1 → present | 96 | 1.3 |
| 16 | Heartland Health Essentials | Kansas City, MO | Health & Personal Care | 2021-Q1 → present | 95 | 1.5 |
| 17 | Cardinal Home Goods | Indianapolis, IN | Home & Kitchen | 2021-Q1 → present | 96 | 1.4 |
| 18 | Allegheny Tabletop & Glass | Pittsburgh, PA | Home & Kitchen | 2021-Q1 → present | 94 | 1.9 |
| 19 | Wabash Small Motors | Fort Wayne, IN | Small Kitchen Appliances (domestic line) | 2021-Q1 → present | 95 | 1.6 |
| 20 | Lakeshore Pet Provisions | Cleveland, OH | Pet Supplies | 2021-Q1 → present | 96 | 1.3 |
| 21 | Keystone Office Supply Co. | Harrisburg, PA | Office & School | 2021-Q1 → present | 97 | 1.2 |
| 22 | Northwind Toys & Games | Grand Rapids, MI | Toys & Games | 2021-Q1 → present | 95 | 1.7 |

Roster shape: 8 import suppliers (#1–#9 minus the domestic #10+, with two onboarded post-pivot),
14 domestic suppliers. Supplier→category assignments must agree with
[`catalog.md`](catalog.md) §4 (every SKU's `supplier_id` resolves into this roster).

**Story roles:**

- **Brightline Electronics Co.** and **Apex Plastics Manufacturing** are the two chronically
  late suppliers of **data story 1** — the causal drivers of the bible's
  `on_time_delivery_pct` decline from 96 (2023-Q1) to 88 (2025-Q3), worsening through 2024–2025.
- **Great Lakes Packaging** (98%) is the **control**: a supplier this reliable proves the
  lateness is supplier-specific, not systemic.
- **Saigon Circuit Works** is the post-pivot replacement, onboarded 2026-Q1 at 95% on-time —
  the driver (with Brightline's exit) of the recovery to 92 by 2026-Q2.
- Monterrey Kitchen Metals is the Mexico leg of the story-2 sourcing-shift recommendation
  (electronics/appliance sourcing shifts to Vietnam/Mexico suppliers).

---

## 2. Per-quarter on-time trajectories (named suppliers)

Generators draw **per-PO delivery outcomes** (Bernoulli on-time/late per PO) against these
quarterly targets. The quarterly numbers are trajectory targets; the *locked* constraint is the
lifetime aggregate.

### Brightline Electronics Co. — target on-time % by quarter

| Year | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| 2021 | 83 | 82 | 81 | 80 |
| 2022 | 79 | 78 | 77 | 76 |
| 2023 | 75 | 74 | 72 | 71 |
| 2024 | 68 | 66 | 64 | 62 |
| 2025 | 60 | 58 | 56 | 54 |

Constraints (reconcile-checked):
- **Lifetime PO-count-weighted aggregate = 71.0% ± 0.5 pt** (locked fact). Brightline's PO
  cadence is roughly flat (weekly POs per stocking FC, ~65–90 POs/quarter) until the
  auto-reorder agent routes volume away in 2025-Q4, so the weighted aggregate tracks the
  arithmetic mean of the table (≈ 70.8).
- **Monotone worsening through 2024–2025** (each quarter ≤ the prior, 2024-Q1 → 2025-Q4).
- **Mean lateness among late POs = 8.5 days ± 0.5** lifetime. Draw late-days from a lognormal
  whose per-quarter mean rises ~6.5 days (2021) → ~10.5 days (2025); long tail capped at 35 days.
- Relationship terminated after 2025-Q4: zero Brightline POs from 2026-Q1 onward.

### Apex Plastics Manufacturing — target on-time % by quarter

| Year | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| 2021 | 85 | 84 | 84 | 83 |
| 2022 | 82 | 81 | 80 | 80 |
| 2023 | 79 | 78 | 77 | 76 |
| 2024 | 74 | 73 | 72 | 71 |
| 2025 | 70 | 69 | 68 | 66 |
| 2026 | 78 | 80 | 81 | — |

Constraints:
- **Aggregate through 2025-Q4 = 76.0% ± 0.5 pt** (locked fact; the headline "76% on-time" is
  relationship-to-date at the moment the insight surfaces).
- Late-days lognormal, lifetime mean 5.2 days ± 0.5.
- 2026: kept at **reduced volume** (−60% PO count vs 2025 average) under a remediation plan;
  modest recovery as shown. The 2026 improvement must not retroactively move the ≤2025 aggregate.

### Great Lakes Packaging (control)

Every quarter in **[97.5, 98.5]**, lifetime aggregate 98.0% ± 0.5 pt; late POs mean 1.2 days
late; no trend. Flat by design — the visual control row on the supplier scorecard.

### Saigon Circuit Works

| 2026-Q1 | 2026-Q2 | 2026-Q3 |
|---|---|---|
| 95 | 95 | 96 |

Aggregate ≥ 95.0% (locked: "95% on-time"); late POs mean 1.8 days. Volume ramps to absorb
Brightline's former electronics share within two quarters (see catalog.md §4).

### The other 18 suppliers

- **Domestic (14):** steady-state on-time drawn per quarter from a normal centered on the
  roster's lifetime figure, σ = 1.0 pt, clamped to [92, 99]. No secular trend.
- **Other import (Dragon Gate, Sterling, Golden Harbor, Pearl River):** centered on roster
  figure, σ = 1.5 pt, clamped to [85, 95], with a mild dip of −1.5 pt during 2024-Q3 → 2025-Q2
  (port congestion texture) — small enough that the blended inbound decline remains
  **overwhelmingly attributable to Brightline and Apex**.

---

## 3. Consistency with the bible's `on_time_delivery_pct` column

The bible's customer-facing on-time column (96.0 at 2023-Q1 → 88.0 at 2025-Q3 → 92.0 at
2026-Q2) is an *output* of the causal chain: late inbound POs → stockouts → backordered
customer orders → late deliveries. The generators must make that chain literal:

| Phase | Bible on-time range | Inbound-delay share of late customer shipments | Of which Brightline/Apex-sourced SKUs |
|---|---|---|---|
| 2021-Q1 → 2023-Q2 | 94.8–96.0 | ~20% | ≥ 60% |
| 2023-Q3 → 2024-Q4 | 90.1–94.8 | 35–45% | ≥ 75% |
| 2025-Q1 → 2025-Q4 | 88.0–89.4 | 50–55% | ≥ 80% |
| 2026-Q1 → 2026-Q3 | 90.6–92.8 | falls back to ~25% | Brightline zero (exited); residual Apex |

The remaining late shipments are carrier and warehouse-ops noise (see
[`orders.md`](orders.md) §5). Calibration loop: after generation, the per-quarter customer
on-time aggregate must land within **±0.3 pt** of the bible column (well inside the ±2%
reconcile gate) — iterate the stockout propagation factor until it does.

---

## 4. Purchase-order volume and shape

- PO volume scales with the bible's `orders_k` and `first_party_share_pct` columns: 1P
  purchasing expands through One Basket (2022→2024) and contracts under catalog
  rationalization (2026). Roughly: total POs/quarter ≈ 900 (2021) → 2,200 (2024-Q4) → 1,600
  (2026-Q3), split across suppliers proportional to their category SKU counts and velocity.
- PO lines: 4–18 SKUs per PO (uniform); line quantities from the reorder policy in
  [`inventory.md`](inventory.md) §4 (the seeded history must look like the auto-reorder agent's
  policy produced it).
- Lead times (order → promised dock date): import suppliers 28–42 days, domestic 3–10 days.
  Lateness is measured against the promised dock date.
- Every PO row carries `data_origin='seed'`, quarter tag relative to `DEMO_EPOCH`
  (see architecture.md), and an `audit_log` entry.

---

## 5. Reconcile hooks (enforced by `pnpm reconcile`)

1. Brightline lifetime on-time = 71.0 ± 0.5 pt; monotone worsening 2024-Q1 → 2025-Q4; mean
   late-days 8.5 ± 0.5; zero POs after 2025-Q4.
2. Apex on-time through 2025-Q4 = 76.0 ± 0.5 pt.
3. Great Lakes Packaging lifetime = 98.0 ± 0.5 pt.
4. Saigon aggregate ≥ 95.0 pt, first PO in 2026-Q1, none earlier.
5. Per-quarter blended customer on-time within ±2% of the bible's `on_time_delivery_pct`
   (the DB-vs-bible gate; the generator's own calibration target is the tighter ±0.3 pt).
