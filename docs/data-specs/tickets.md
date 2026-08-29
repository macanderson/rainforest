# Data spec — Support Tickets

**Source of truth:** [`data/numbers-bible.json`](../../data/numbers-bible.json) —
specifically the `tickets_per_1k_orders` and `orders_k` columns. All entities are fictional.

This spec governs the `support_tickets` seed generator (E3#6), the ticket explorer (E4#6),
and the ticket-cluster insight (E8#3). It encodes **data story 3**: a shipping-delay
complaint cluster that tracks the on-time-% decline **with a one-quarter lag** and
concentrates on Brightline/Apex-sourced SKUs; a `Rainforest Basics` quality cluster peaking
2024–2025; and a flat billing cluster as the control.

---

## 1. Cluster taxonomy

| Cluster tag | Contents | Story role |
|---|---|---|
| `shipping-delay` | "Where is my order", late-delivery complaints, backorder escalations | Data story 3 primary — lags the on-time dip by one quarter |
| `product-quality` | Defects, DOA units, "broke after a week" — attached to `Rainforest Basics` SKUs | Basics quality cluster, peaks 2024–2025 |
| `billing` | Charge disputes, refund timing, duplicate charge | **Control** — flat ~2.0/1k throughout |
| `other` | Returns logistics, account/access, catalog questions, misc | Baseline noise, flat ~5.2–5.5/1k |

---

## 2. Per-quarter decomposition (tickets per 1,000 orders)

The four cluster rates must sum to the bible's `tickets_per_1k_orders` **exactly** (the bible
column is the total; this table is its canonical decomposition). Total ticket volume per
quarter = `orders_k × tickets_per_1k_orders` (e.g. 2025-Q3: 7,113k × 18.2 ≈ 129.5k tickets;
2021-Q1: 2,911k × 8.9 ≈ 25.9k).

| Quarter | Total (bible) | billing | other | shipping-delay | product-quality |
|---|---|---|---|---|---|
| 2021-Q1 | 8.9 | 2.0 | 5.4 | 1.5 | 0.0 |
| 2021-Q2 | 8.7 | 2.0 | 5.3 | 1.4 | 0.0 |
| 2021-Q3 | 8.8 | 2.0 | 5.4 | 1.4 | 0.0 |
| 2021-Q4 | 9.2 | 2.0 | 5.5 | 1.7 | 0.0 |
| 2022-Q1 | 9.0 | 2.0 | 5.4 | 1.6 | 0.0 |
| 2022-Q2 | 9.1 | 2.0 | 5.4 | 1.7 | 0.0 |
| 2022-Q3 | 8.9 | 2.0 | 5.3 | 1.5 | 0.1 |
| 2022-Q4 | 9.3 | 2.0 | 5.4 | 1.7 | 0.2 |
| 2023-Q1 | 9.1 | 2.0 | 5.3 | 1.5 | 0.3 |
| 2023-Q2 | 9.0 | 2.0 | 5.2 | 1.4 | 0.4 |
| 2023-Q3 | 9.6 | 2.0 | 5.5 | 1.6 | 0.5 |
| 2023-Q4 | 10.4 | 2.0 | 5.4 | 2.4 | 0.6 |
| 2024-Q1 | 11.2 | 2.0 | 5.4 | 2.9 | 0.9 |
| 2024-Q2 | 12.1 | 2.0 | 5.4 | 3.4 | 1.3 |
| 2024-Q3 | 13.3 | 2.0 | 5.4 | 4.2 | 1.7 |
| 2024-Q4 | 14.6 | 2.0 | 5.4 | 5.2 | 2.0 |
| 2025-Q1 | 15.9 | 2.0 | 5.4 | 6.2 | 2.3 |
| 2025-Q2 | 17.1 | 2.0 | 5.4 | 7.2 | 2.5 |
| 2025-Q3 | 18.2 | 2.0 | 5.4 | 8.2 | 2.6 |
| 2025-Q4 | 19.0 | 2.0 | 5.4 | 9.0 | 2.6 |
| 2026-Q1 | 17.6 | 2.0 | 5.4 | 8.1 | 2.1 |
| 2026-Q2 | 15.8 | 2.0 | 5.4 | 6.7 | 1.7 |
| 2026-Q3 | 14.2 | 2.0 | 5.4 | 5.5 | 1.3 |

Reading the story out of the table:

- **The one-quarter lag (locked):** on-time delivery starts dipping in **2023-Q3**
  (95.4 → 94.8); the shipping-delay cluster jumps one quarter later, in **2023-Q4**
  (1.6 → 2.4). On-time bottoms at **2025-Q3** (88.0); the shipping cluster peaks one quarter
  later, at **2025-Q4** (9.0). On-time recovery begins 2025-Q4; the cluster declines from
  2026-Q1. Mechanism (§4): tickets attach to orders *delivered late near quarter
  boundaries*, plus complaint latency — the lag is generated, not painted.
- **Basics quality cluster:** zero before the 2022-Q2 Basics launch, first tickets 2022-Q3
  (returns cycle), **peaks 2024–2025** (2.0–2.6), declines through 2026 as the pruned SKUs
  (catalog.md §2) exit the sold base.
- **Billing is flat at 2.0/1k across all 23 quarters** — the control that proves the other
  two clusters are signal.

---

## 3. Ticket row shape

Every ticket: `cluster_tag`, `opened_at` (quarter-tagged relative to `DEMO_EPOCH`),
`order_id` (nullable only for `other`/account tickets, ≤30% of that cluster), `sku_id`
(required for `product-quality`, present on ~80% of `shipping-delay`), `channel`
(email 55% / chat 35% / phone 10%), `first_response_hours` (lognormal, median 4 h),
`resolution_days` (lognormal, median 1.8 d; shipping-delay median 3.0 d during 2024–2025
backlog), `status`, `data_origin='seed'`.

---

## 4. Attachment rules (the corroboration walk)

The demo's three-way walk — ticket → order → SKU → supplier — requires literal foreign keys:

1. **`shipping-delay` tickets attach to actually-late orders** (orders.md §5). Sampling:
   P(ticket | late order) rises with lateness magnitude (~8% for <1 day late, ~45% for >4
   days late). Complaint latency: opened 2–21 days after the promise date (lognormal,
   median 6 d) — this latency plus the late-quarter skew of order volume produces the
   one-quarter lag mechanically.
2. **Concentration (locked):** during 2024–2025, **≥70% of `shipping-delay` tickets
   reference orders containing Brightline- or Apex-sourced SKUs** — inherited from the
   late-cause attribution in orders.md §5 (inbound-stockout lates are ≥80% Brightline/Apex,
   and those are the latest, most-complained-about orders).
3. **`product-quality` tickets attach to `Rainforest Basics` SKUs** (catalog.md §2),
   weighted toward Home & Kitchen and Small Kitchen Appliances Basics; opened 5–60 days
   after delivery.
4. **`billing` and `other` tickets** sample orders uniformly — no correlation with lateness,
   supplier, or Basics (that's what makes them controls).

---

## 5. Reconcile hooks

1. Per-quarter `tickets/1k orders` (DB) within ±2% of the bible column.
2. Cluster decomposition within ±0.2/1k of the §2 table per quarter; billing flat
   (max−min ≤ 0.3/1k across all quarters).
3. Lag check: cross-correlation of Δ`on_time_delivery_pct`(q) against
   Δ`shipping-delay rate`(q+1) over 2023-Q2 → 2026-Q2 is strongly negative (|r| maximal at
   lag 1, not lag 0 or 2).
4. Concentration check: ≥70% of 2024–2025 `shipping-delay` tickets resolve through their
   order to a Brightline/Apex-sourced SKU; ≥95% of `product-quality` tickets reference a
   `Rainforest Basics` SKU.
