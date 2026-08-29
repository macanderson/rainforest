# Data spec — Reconciliation (`pnpm reconcile`)

**Source of truth:** [`data/numbers-bible.json`](../../data/numbers-bible.json). The
reconciliation engine (E2#3, skeleton in E1#6) is the mechanism that makes drift between the
bible, the financial fiction, and the seeded database **mechanically impossible** — editorial
discipline drifts; CI doesn't.

`pnpm reconcile` is **CI-blocking** and runs on every PR that touches `data/` or seed code
(E1#3). It has two halves: **bible-internal identities** (checkable from day one, before any
seed data exists) and **seeded-DB-vs-bible** aggregation diffs (armed once E3 generators land).

---

## 1. Bible-internal identities (all 23 rows, 2021-Q1 → 2026-Q3)

| # | Identity | Tolerance |
|---|---|---|
| I1 | `orders_k × aov_usd ≈ gmv_usd_m × 1000` | ±1% |
| I2 | `revenue_usd_m ≈ gmv × 1P% + take_rate × gmv × (1 − 1P%)` | ±1% |
| I3 | Margin/net-income consistency: `implied_opex = revenue × gross_margin_pct − net_income` must be positive on every row and match the modeled opex schedule of the P&L derivation layer (E2#4) | ±2% vs the E2#4 model |

Worked examples (recompute these when validating an engine change):

- **2024-Q4 (I2):** 520 × 0.61 = 317.20 (1P) ; 520 × 0.39 × 0.14 = 28.39 (3P take) ;
  317.20 + 28.39 = **345.59 ≈ 345.6** ✓
- **2025-Q3 (I2):** 478 × 0.64 = 305.92 ; 478 × 0.36 × 0.15 = 25.81 ; total
  **331.73 ≈ 331.7** ✓
- **2025-Q3 (I1):** 7,113k × $67.2 = $477.99M ≈ **$478M** ✓
- **2026-Q2 (I2):** 522 × 0.55 = 287.10 ; 522 × 0.45 × 0.15 = 35.24 ; total
  **322.34 ≈ 322.3** ✓

The bible loader (E2#2) fails the **build** if I1/I2 are violated — a bible edit that breaks
its own identities never reaches the generators.

Story-beat guards (asserted structurally, not by eyeball): 23 rows exactly; monotone
`first_party_share_pct` rise 2022-Q1 (34) → 2024-Q4 (61); five consecutive negative
`net_income_usd_m` quarters 2024-Q2 → 2025-Q2; revenue plateau 2025-Q1→Q3 (each within ±2%
of prior); `landed_cost_index_electronics` = 100.0 at 2024-Q1 and 118.0 at 2025-Q4;
on-time = 96.0 at 2023-Q1, 88.0 at 2025-Q3, ≥92.0 at 2026-Q2; net income positive from
2026-Q2.

---

## 2. Seeded-DB-vs-bible (per quarter, ±2%)

The engine aggregates the seeded SQLite database **by quarter tag, never wall-clock date**.
Seed rows carry quarter tags relative to the `DEMO_EPOCH` anchor (architecture.md), so the
daily +1-day clock-shift job (E6#2) can never break reconciliation — shifting moves
timestamps, not tags. Rows with `data_origin` of `'demo'` or `'agent'` are **excluded** from
the diff (they are live-demo texture, not bible-governed history).

Core metrics, each quarter, each within **±2% (relative)** of the bible column:

| # | Metric | DB aggregation | Bible column |
|---|---|---|---|
| D1 | Revenue | per the E2#4 derivation over seeded orders (1P gross + 3P take) | `revenue_usd_m` |
| D2 | Order count | `count(sales_orders)` | `orders_k` |
| D3 | AOV | `avg(order_total)` | `aov_usd` |
| D4 | GMV | `sum(order_total)` | `gmv_usd_m` |
| D5 | On-time delivery % | `delivered_at ≤ promised_at` share | `on_time_delivery_pct` |
| D6 | Tickets per 1k orders | `count(support_tickets) / orders × 1000` | `tickets_per_1k_orders` |

Generators aim tighter than the gate (±0.3 pt on D5, ±0.5% on D2/D3 — see the per-spec
calibration targets) so environment noise never rides the edge of ±2%.

---

## 3. Spec-level checks (the story integrity gates)

Beyond the core metrics, the engine enforces the distribution hooks declared in the sibling
specs — these are what keep the three data stories discoverable rather than decorative:

**From [`suppliers.md`](suppliers.md):**
- Brightline Electronics Co. lifetime on-time = 71.0 ± 0.5 pt; monotone worsening
  2024-Q1 → 2025-Q4; mean late-days 8.5 ± 0.5; zero POs after 2025-Q4.
- Apex Plastics Manufacturing on-time through 2025-Q4 = 76.0 ± 0.5 pt.
- Great Lakes Packaging lifetime = 98.0 ± 0.5 pt (control stays flat).
- Saigon Circuit Works aggregate ≥ 95.0 pt; first PO in 2026-Q1.

**From [`catalog.md`](catalog.md):**
- SKU count 1,200 ± 25 across exactly 9 categories; Rainforest Basics 185 ± 5 at 2024-Q4.
- Landed-cost index recomputed from exposed-category PO costs within ±2% of the bible
  column; exact endpoints 100.0 (2024-Q1) and 118.0 (2025-Q4).
- No Brightline receipts after 2025-Q4; no Saigon before 2026-Q1; no Monterrey before
  2026-Q2.

**From [`orders.md`](orders.md):**
- Late-cause attribution within phase bands; ≥80% of 2024–2025 inbound-stockout lates
  reference Brightline/Apex-sourced SKUs.

**From [`inventory.md`](inventory.md):**
- Exactly 11 warehouses; no rows referencing an FC before its opening quarter.
- Stock conservation per (SKU, FC, week); ≥95% of seeded POs consistent with the reorder
  policy; `fulfillment_cost_per_order_usd` within ±2%.

**From [`tickets.md`](tickets.md):**
- Cluster decomposition within ±0.2/1k of the canonical table; billing cluster flat.
- One-quarter-lag cross-correlation check; ≥70% Brightline/Apex concentration on 2024–2025
  shipping-delay tickets; ≥95% of quality tickets reference a Basics SKU.

---

## 4. Engine behavior

- **Deterministic:** the engine reads the same seeded RNG conventions as `pnpm seed`
  (E1#6); two runs over the same DB produce byte-identical reports.
- **Drift report:** human-readable table per quarter × metric — bible value, DB value,
  delta %, PASS/FAIL — written to stdout and `reconcile-report.txt` (the E3#7 evidence
  artifact commits this report). Failures list the worst offenders first.
- **Exit code:** non-zero on any FAIL — that is the CI gate. There is no warn-only mode;
  a tolerance change is a spec change and belongs in this file first.
- **Postcondition duty:** the clock-shift job (E6#2) and demo-wipe job (E6#3) both run
  reconcile as a postcondition; a red reconcile after a job is a P0 defect in the job, not
  in the data.
- **Scope discipline:** the engine never reads wall-clock dates for bucketing, never
  mutates data, and never "fixes" drift — generators fix drift (E3#7 iterates until green).
