# Data spec — Orders & Fulfillment

**Source of truth:** [`data/numbers-bible.json`](../../data/numbers-bible.json). Every quarterly
target below is transcribed from the bible; the JSON is canonical. All entities are fictional.

This spec governs the `sales_orders`, `sales_order_lines`, and `shipments` seed generators
(E3#4) and the orders console (E4#3). Quarterly aggregates are enforced by `pnpm reconcile`
within ±2% (see [`reconciliation.md`](reconciliation.md)).

---

## 1. Per-quarter targets (from the bible)

| Quarter | Orders (k) | AOV (USD) | GMV ($M) | On-time % | Quarter | Orders (k) | AOV (USD) | GMV ($M) | On-time % |
|---|---|---|---|---|---|---|---|---|---|
| 2021-Q1 | 2,911 | 58.4 | 170 | 95.5 | 2024-Q1 | 5,873 | 64.7 | 380 | 93.2 |
| 2021-Q2 | 3,080 | 59.1 | 182 | 95.8 | 2024-Q2 | 6,212 | 65.2 | 405 | 92.3 |
| 2021-Q3 | 3,278 | 59.8 | 196 | 96.0 | 2024-Q3 | 6,535 | 65.8 | 430 | 91.2 |
| 2021-Q4 | 3,671 | 63.2 | 232 | 95.2 | 2024-Q4 | 7,482 | 69.5 | 520 | 90.1 |
| 2022-Q1 | 3,802 | 60.5 | 230 | 95.8 | 2025-Q1 | 7,319 | 66.4 | 486 | 89.4 |
| 2022-Q2 | 4,003 | 61.2 | 245 | 95.6 | 2025-Q2 | 7,220 | 66.9 | 483 | 88.6 |
| 2022-Q3 | 4,240 | 61.8 | 262 | 95.9 | 2025-Q3 | 7,113 | 67.2 | 478 | 88.0 |
| 2022-Q4 | 4,465 | 65.4 | 292 | 95.4 | 2025-Q4 | 7,232 | 70.8 | 512 | 89.0 |
| 2023-Q1 | 4,492 | 62.6 | 281.2 | 96.0 | 2026-Q1 | 7,460 | 68.1 | 508 | 90.6 |
| 2023-Q2 | 4,604 | 63.1 | 290.5 | 95.4 | 2026-Q2 | 7,598 | 68.7 | 522 | 92.0 |
| 2023-Q3 | 4,678 | 63.9 | 298.9 | 94.8 | 2026-Q3 | 7,763 | 69.3 | 538 | 92.8 |
| 2023-Q4 | 4,833 | 67.8 | 327.7 | 94.0 | | | | | |

The bible's identity `orders_k × aov_usd ≈ gmv_usd_m × 1000` holds within ±1% on every row;
the generator inherits it for free by drawing order values to hit the AOV target and order
counts to hit the volume target.

---

## 2. Volume shape within a quarter

Orders are generated per **day**, tagged with a quarter tag relative to `DEMO_EPOCH`
(architecture.md) — never bucketed by wall-clock, so the daily +1-day clock-shift job (E6#2)
cannot break reconciliation.

- **Month weights within a quarter:** 0.31 / 0.32 / 0.37 (orders skew late-quarter; in Q4 the
  third month carries 0.42 for the holiday peak — visible in the Q4 AOV bumps: 63.2, 65.4,
  67.8, 69.5, 70.8).
- **Day-of-week weights:** Mon–Fri ≈ 0.155 each, Sat 0.115, Sun 0.11.
- Daily noise: multiplicative normal σ = 6%, then renormalize so the quarter total hits the
  bible's `orders_k` exactly (±0.5% before the reconcile gate even applies).

---

## 3. Basket model (drives AOV)

- **Lines per order:** shifted Poisson, mean 2.1 (min 1, max 12).
- **Units per line:** 1 + Geometric(0.75) capped at 6 (mean ≈ 1.33).
- **Line price:** drawn from the category price bands in [`catalog.md`](catalog.md) §1, with
  category sales-mix weights as the calibration knob so the order-value distribution's mean
  lands on the quarter's `aov_usd` target (±1%). Order values are right-skewed (lognormal-ish
  by construction); median order ≈ 0.72 × AOV.
- **Customer pool:** sized per the bible's `active_customers_k` column; ~68% repeat orders in
  any quarter. Customer records are seed-generated with `data_origin='seed'`.

---

## 4. Fulfillment lifecycle — timestamp distributions

Every order advances `placed → allocated → picked → shipped → delivered` (the E4#3 timeline;
the fulfillment agent E5#3 replays this same policy live). Stage-duration draws, in hours,
for a normally-fulfilled order:

| Transition | Distribution | Typical |
|---|---|---|
| placed → allocated | lognormal, median 0.2 h, p95 2 h | minutes |
| allocated → picked | lognormal, median 3 h, p95 10 h | same shift |
| picked → shipped | lognormal, median 4 h, p95 12 h | same day |
| shipped → delivered | by service level, below | |

**Service levels and promise dates** (the on-time denominator):

- **Next-morning** (metro zones around each FC): promise = 10:00 local the next calendar day.
  Share of orders: ~45% through 2025 (One Basket's universal free same-day/next-morning push),
  falling to ~35% in 2026 as unprofitable zones are exited post-pivot.
- **Two-day regional** (rest of the 14-state footprint): promise = end of day +2. Remainder
  of orders.
- `on_time = delivered_at ≤ promised_at`. The per-quarter aggregate must reproduce the
  bible's `on_time_delivery_pct` column within **±0.3 pt** (generator calibration target;
  the reconcile gate is ±2%).

---

## 5. Lateness — causally driven, not painted on

Late orders are not drawn independently: lateness must trace to causes, because the demo's
corroboration walk (ticket → order → SKU → supplier) depends on it.

**Late-cause mix among late deliveries** (aligned with [`suppliers.md`](suppliers.md) §3):

| Phase | Inbound stockout/backorder | Carrier | Warehouse ops |
|---|---|---|---|
| 2021-Q1 → 2023-Q2 | ~20% | ~50% | ~30% |
| 2023-Q3 → 2024-Q4 | 35–45% | ~35% | ~25% |
| 2025-Q1 → 2025-Q4 | 50–55% | ~30% | ~18% |
| 2026-Q1 → 2026-Q3 | ~25% | ~45% | ~30% |

- **Inbound-stockout lates:** generated by the mechanism — a late PO (suppliers.md §2) leaves
  a SKU out of stock; orders containing that SKU during the stockout window are allocated late
  (backorder released when the PO docks) and deliver late by `PO lateness carry-through`
  (order lateness ≈ 0.4–0.8 × remaining PO delay, plus normal stage times). During 2024–2025,
  ≥80% of these must involve Brightline- or Apex-sourced SKUs (locked story).
- **Carrier lates:** +0.5–3 days, seasonal bump in Q4 (weather/peak), uniform across SKUs.
- **Ops lates:** +2–18 hours from pick/pack congestion, weighted toward the highest-volume FCs.
- Late-shipment badges and SLA flags (the exception agent E5#4's inputs) derive from these
  same rows — no separate "flag" data is seeded.

**Delivered-late magnitude:** lognormal; median 0.8 days late, p95 4 days — except
inbound-stockout lates during 2024–2025, median 2.5 days, p95 9 days (they inherit the
supplier tail: Brightline's late POs mean 8.5 days).

---

## 6. Row conventions

- Every order/line/shipment row: `data_origin='seed'`, quarter tag, FC assignment from
  [`inventory.md`](inventory.md) §2 (orders route to the nearest FC holding stock), and
  `audit_log` entries for lifecycle transitions attributed to `agent:fulfillment` (so the
  seeded history is continuous with what the live fulfillment agent will write).
- Order status distribution at seed time: all quarters fully delivered except the trailing
  ~10 days of the current quarter, which leave a realistic in-flight mix (~2% placed,
  ~3% allocated/picked, ~6% shipped).

---

## 7. Reconcile hooks

1. Per-quarter DB aggregates vs bible, ±2%: order count, AOV, GMV
   (`sum(order_total)`), on-time %.
2. Identity inherited: `orders × AOV ≈ GMV` within ±1% (bible-internal identity, re-checked
   against the DB).
3. Late-cause attribution shares within the phase bands of §5; ≥80% of inbound-stockout lates
   in 2024–2025 reference Brightline/Apex-sourced SKUs.
4. No order row bucketed by wall-clock date anywhere in reconcile — quarter tags only.
