# Data spec — Catalog

**Source of truth:** [`data/numbers-bible.json`](../../data/numbers-bible.json). Every
distribution here derives from the bible; where they disagree, the bible wins. All entities are
fictional.

This spec governs the `categories` and `products` seed generators (E3#3) and feeds the tariff
insight (E8#2). Landed-cost aggregates are enforced by `pnpm reconcile`
(see [`reconciliation.md`](reconciliation.md)).

---

## 1. Categories — 9, ~1,200 SKUs total

| # | Category | SKUs | Tariff-exposed | Rainforest Basics SKUs | Price band (USD) | Primary suppliers |
|---|---|---|---|---|---|---|
| 1 | Consumer Electronics | 150 | **Yes** | 25 | 12–280 | Brightline Electronics Co. (→2025-Q4), Dragon Gate Components, Saigon Circuit Works (2026-Q1→) |
| 2 | Small Kitchen Appliances | 110 | **Yes** | 20 | 18–190 | Sterling Housewares, Golden Harbor Appliance Works, Wabash Small Motors, Monterrey Kitchen Metals (2026-Q2→) |
| 3 | Home & Kitchen | 190 | No | 40 | 6–120 | Cardinal Home Goods, Allegheny Tabletop & Glass, Apex Plastics Manufacturing |
| 4 | Grocery & Pantry | 210 | No | 30 | 3–45 | Buckeye Foods Distribution, Riverbend Grocery Partners |
| 5 | Health & Personal Care | 140 | No | 25 | 4–60 | Prairie Personal Care Labs, Heartland Health Essentials |
| 6 | Cleaning & Household | 120 | No | 20 | 3–40 | Miami Valley Paper Co., Blue Ridge Cleaning Products, Chesapeake Paper & Disposables |
| 7 | Pet Supplies | 100 | No | 10 | 5–75 | Lakeshore Pet Provisions |
| 8 | Office & School | 90 | No | 10 | 2–55 | Keystone Office Supply Co. |
| 9 | Toys & Games | 90 | No | 5 | 8–90 | Northwind Toys & Games, Pearl River Toy Manufactory, Apex Plastics Manufacturing |
| | **Total** | **1,200** | | **185** | | |

- Every SKU carries: `sku` (stable, deterministic from the seeded RNG), `category_id`,
  `supplier_id` (must resolve into the 22-supplier roster in
  [`suppliers.md`](suppliers.md) §1), `is_private_label` (Rainforest Basics flag),
  `unit_cost_usd`, `list_price_usd`, `first_sold_quarter`, `discontinued_quarter` (nullable),
  `data_origin='seed'`.
- Price bands are log-uniform within the ranges above. Blended catalog economics must support
  the bible's `aov_usd` column (58.4 → ~70) given the basket model in
  [`orders.md`](orders.md) §3 — the calibration knob is the category sales-mix weights, not
  the bible.
- Per-SKU gross margin distributions are set per category so the sales-mix-weighted blended
  margin reproduces the bible's `gross_margin_pct` column (26.0 in 2021-Q1 → 14.0 in 2025-Q2 →
  17.5 in 2026-Q3). Tariff erosion (§3) and Basics mix (§2) are the two moving parts;
  everything else stays near-constant.

---

## 2. Rainforest Basics — the private-label line

- **Launch:** 2022-Q2, following the One Basket announcement in Q1-2022. First quarter with
  Basics sales: 2022-Q2 (a handful of SKUs); ramp to the full **185 SKUs by 2024-Q4**.
- **Rationalization:** the Fulfillment Flywheel (announced Q4-2025) shrinks the 1P catalog to
  data-proven winners — Basics SKUs are pruned to **~120 active by 2026-Q3**
  (`discontinued_quarter` set on the pruned ~65; they retain history, they stop selling).
- Basics share of 1P *unit* sales: 0% (pre-2022-Q2) → ~22% (2024-Q4→2025-Q4) → ~17% (2026-Q3).
  This tracks, and partially drives, the bible's `first_party_share_pct` arc (34 → 61 → 52).
- Basics SKUs price ~15–25% below the comparable national-brand SKU in the same category, with
  initially higher margin — the margin advantage erodes in tariff-exposed categories (§3).
- **Quality-story hook (data story 3):** Basics SKUs — concentrated in Home & Kitchen and
  Small Kitchen Appliances — are the reference targets of the quality-complaint ticket cluster
  that peaks 2024–2025 (see [`tickets.md`](tickets.md) §3). Generators must attach the
  quality-cluster tickets to *Basics* SKUs specifically.

---

## 3. Tariff exposure — the landed-cost index (data story 2)

The bible's `landed_cost_index_electronics` column applies to the two tariff-exposed
categories: **Consumer Electronics and Small Kitchen Appliances** (imported, predominantly
China-sourced through 2025). Index base: **2024-Q1 = 100.0**.

| Quarter | Index | Quarter | Index | Quarter | Index |
|---|---|---|---|---|---|
| 2021-Q1 | 96.8 | 2023-Q1 | 98.7 | 2025-Q1 | 112.1 |
| 2021-Q2 | 97.0 | 2023-Q2 | 99.0 | 2025-Q2 | 114.6 |
| 2021-Q3 | 97.2 | 2023-Q3 | 99.2 | 2025-Q3 | 116.4 |
| 2021-Q4 | 97.5 | 2023-Q4 | 99.5 | 2025-Q4 | **118.0** |
| 2022-Q1 | 97.9 | 2024-Q1 | **100.0** | 2026-Q1 | 117.2 |
| 2022-Q2 | 98.2 | 2024-Q2 | 103.2 | 2026-Q2 | 116.1 |
| 2022-Q3 | 98.0 | 2024-Q3 | 106.5 | 2026-Q3 | 114.8 |
| 2022-Q4 | 98.4 | 2024-Q4 | 109.4 | | |

(Values transcribed from the bible — the JSON is canonical; regenerate this table rather than
editing it if the bible ever changes.)

Rules for the generator:

- Per-SKU `unit_cost_usd` in the two exposed categories is a base cost (drawn once per SKU)
  **multiplied by the quarter's index / 100** at purchase-order time. Non-exposed categories
  use a flat index of 100 with ±1% quarterly noise.
- The rise is **+18% from 2024-Q1 (100) to 2025-Q4 (118)** — the locked tariff fact. List
  prices in the exposed categories rise only ~7% over the same window (competitive ceiling),
  so **category gross margin erodes ~6 pts** — the locked margin-erosion fact. The exposed
  categories' margin decline plus the Basics mix shift must jointly reproduce the bible's
  blended `gross_margin_pct` column.
- Exposure is **unhedged and un-mitigated until the pivot**: no sourcing changes before
  2026-Q1. The 2026 index easing (118.0 → 114.8) coincides with the sourcing shift to
  Vietnam (Saigon Circuit Works, 2026-Q1) and Mexico (Monterrey Kitchen Metals, 2026-Q2) —
  the surfaced recommendation of insight E8#2.

---

## 4. Supplier→category volume shares (electronics detail)

Consumer Electronics inbound unit share, by supplier:

| Phase | Brightline | Dragon Gate | Saigon |
|---|---|---|---|
| 2021 → 2023 | ~55% | ~45% | — |
| 2024 → 2025-Q3 | ~60% | ~40% | — |
| 2025-Q4 (agent routes away) | ~35% | ~65% | — |
| 2026-Q1 → | 0% | ~45% | ~55% ramp |

Small Kitchen Appliances: Sterling ~40%, Golden Harbor ~35%, Wabash ~25% through 2025;
Monterrey takes ~20% from 2026-Q2 (proportionally from the two China suppliers). These shares
make the supplier lateness (suppliers.md §2) fall on the right SKUs for the ticket
correlation in [`tickets.md`](tickets.md) §4.

---

## 5. Reconcile hooks

1. SKU count 1,200 ± 25 across exactly 9 categories; Basics count 185 ± 5 at 2024-Q4,
   ~120 active at 2026-Q3.
2. Landed-cost index reproduced from PO unit costs in the exposed categories per quarter
   within ±2% of the bible column; exact endpoints checked: 100.0 at 2024-Q1, 118.0 at 2025-Q4.
3. Exposed-category realized gross margin declines ~6 pts 2024-Q1 → 2025-Q4.
4. Every SKU's `supplier_id` resolves; no exposed-category SKU sources from Saigon before
   2026-Q1 or Monterrey before 2026-Q2; no Brightline-sourced receipts after 2025-Q4.
