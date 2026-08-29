# The Numbers Bible

**Canonical source: [`data/numbers-bible.json`](../data/numbers-bible.json).** This document is the
rendered narrative of that file. Every financial figure cited anywhere in this repository —
RAINFOREST.md, the data specs in `docs/data-specs/`, seed generators, the financial-reports UI —
derives from the JSON. If this page and the JSON ever disagree, the JSON wins and this page is a
defect. `pnpm reconcile` (CI-blocking) enforces the bible's internal identities and, once seed data
exists, diffs the seeded database against the bible within ±2% per quarter.

All entities and figures are fictional. Rainforest, Inc. is a fictional company; the data is
synthetic, authored for a demonstration.

---

## 1. The story the numbers tell

The bible covers **23 quarters, 2021-Q1 through 2026-Q3**, and encodes five acts:

**Act I — The growth years (2021–2023).** Rainforest, Inc. rides its next-morning-delivery
promise from $310.7M revenue in FY2021 to $650.0M in FY2023 — a **44.6% revenue CAGR** — on a
GMV base that is still majority third-party marketplace. The company IPOs in **May 2023
(NASDAQ: RAIN, priced at $21/share)**; headcount jumps **+19.9%** in the two quarters after the
offering (2,760 → 3,310) as the post-IPO hiring wave lands.

**Act II — "One Basket" takes over the P&L (2022–2024).** The strategy announced in Q1-2022 —
aggressive first-party expansion, the `Rainforest Basics` private label, universal free same-day
delivery — mechanically inflates recognized revenue (1P sales book gross) while hollowing out the
economics. First-party share of GMV climbs monotonically from **34% (2022-Q1) to 61% (2024-Q4)**;
gross margin slides from **24% (2022-Q4) to 14% (2025-Q2)**; fulfillment cost per order rises from
~$5.10 to ~$7.60 as free same-day zones expand.

**Act III — The stall (2024–2025).** Net income goes negative in 2024-Q2 and stays negative for
**five consecutive quarters through 2025-Q2** (the "five straight loss-making quarters by
mid-2025"). Revenue plateaus across 2025-Q1→Q3 ($331.1M → $333.1M → $331.7M, each within ±2% of
the prior quarter). Operationally, on-time delivery decays from **96% (2023-Q1) to 88% (2025-Q3)**
— causally driven by two chronically late suppliers, Brightline Electronics Co. (71% on-time,
mean 8.5 days late) and Apex Plastics Manufacturing (76% on-time), spec'd in
`docs/data-specs/suppliers.md` — and support tickets per 1,000 orders climb from **9 to 19 over
the same window, lagging the on-time decline by one quarter**. On top of it, import tariffs push
the electronics landed-cost index from **100 (2024-Q1) to 118 (2025-Q4)**, eroding category
margin unhedged.

**Act IV — The transition (2025-Q3/Q4).** **Priya Raghavan** is hired as CEO in **August 2025**
(2025-Q3 — no numeric effect that quarter; Evelyn Marsh moves to Executive Chair). The
**"Fulfillment Flywheel"** pivot is announced in **Q4-2025**: open the warehouses to third-party
merchants as the Rainforest Fulfillment Network (RFN), shrink the 1P catalog to data-proven
winners, exit unprofitable same-day zones, run operations with AI agents. The bible shows the
inflection exactly at 2025-Q4 and not before: gross margin turns up (14.2 → 15.0), first-party
share turns down (64.0 → 62.0), and the loss narrows sharply (−$16.2M → −$9.4M).

**Act V — Green shoots (2026).** First-party share falls to **52% by 2026-Q3**; gross margin
recovers to **17.5% by 2026-Q3**; on-time delivery is back to **92% by 2026-Q2** (Brightline
dropped; Saigon Circuit Works onboarded Q1-2026 at 95% on-time); marketplace (3P) GMV grows
**+9.7% QoQ in 2026-Q1 and +10.1% QoQ in 2026-Q2**; net income turns positive in **2026-Q2**
(+$4.2M, then +$9.8M). Note the deliberate texture: total *revenue* drifts down through 2026 even
as GMV grows, because the mix shifts from gross-booked 1P sales to take-rate commission on 3P —
that is what a healthy Flywheel looks like on this P&L, and the demo should say so out loud.

**FY2025 scale (matches the locked facts):** ~$1.9B GMV ($1,959M), ~$1.4B revenue ($1,342.5M),
~6,400 employees at end-2025 (exactly 6,400 in 2025-Q4), and **11 fulfillment centers**
(the fulfillment-center count is a fact of the fiction, not a bible column; warehouse layout is
spec'd in `docs/data-specs/inventory.md`).

Annual roll-ups for quick reference (sums of the quarterly rows):

| FY | GMV ($M) | Revenue ($M) | Net income ($M) | Headcount (EOY) |
|---|---:|---:|---:|---:|
| 2021 | 780.0 | 310.7 | +10.1 | 1,820 |
| 2022 | 1,029.0 | 467.3 | +7.3 | 2,440 |
| 2023 | 1,198.3 | 650.0 | +8.9 | 3,310 |
| 2024 | 1,735.0 | 1,101.8 | −31.7 | 5,400 |
| 2025 | 1,959.0 | 1,342.5 | −65.6 | 6,400 |
| 2026 (Q1–Q3) | 1,568.0 | 967.4 | +10.9 | 6,300 |

---

## 2. The quarterly table

Rendered from `data/numbers-bible.json` — generated, do not edit by hand.

| Quarter | GMV $M | Revenue $M | Gross margin % | Net income $M | Orders k | AOV $ | Active cust. k | 1P share % | Take rate % | Fulfill $/order | On-time % | Tickets /1k | Landed-cost idx | Headcount |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2021-Q1 | 170.0 | 65.3 | 26.0 | 1.8 | 2,911 | 58.40 | 1,180 | 30.0 | 12.0 | 4.90 | 95.5 | 8.9 | 96.8 | 1,450 |
| 2021-Q2 | 182.0 | 71.5 | 25.8 | 2.2 | 3,080 | 59.10 | 1,260 | 31.0 | 12.0 | 4.85 | 95.8 | 8.7 | 97.0 | 1,560 |
| 2021-Q3 | 196.0 | 78.7 | 25.6 | 2.6 | 3,278 | 59.80 | 1,350 | 32.0 | 12.0 | 4.80 | 96.0 | 8.8 | 97.2 | 1,680 |
| 2021-Q4 | 232.0 | 95.2 | 25.0 | 3.5 | 3,671 | 63.20 | 1,480 | 33.0 | 12.0 | 4.75 | 95.2 | 9.2 | 97.5 | 1,820 |
| 2022-Q1 | 230.0 | 97.2 | 24.6 | 2.4 | 3,802 | 60.50 | 1,610 | 34.0 | 12.5 | 5.10 | 95.8 | 9.0 | 97.9 | 1,980 |
| 2022-Q2 | 245.0 | 107.8 | 24.4 | 1.8 | 4,003 | 61.20 | 1,730 | 36.0 | 12.5 | 5.30 | 95.6 | 9.1 | 98.2 | 2,130 |
| 2022-Q3 | 262.0 | 121.0 | 24.2 | 1.1 | 4,240 | 61.80 | 1,850 | 38.5 | 12.5 | 5.50 | 95.9 | 8.9 | 98.0 | 2,280 |
| 2022-Q4 | 292.0 | 141.3 | 24.0 | 2.0 | 4,465 | 65.40 | 2,010 | 41.0 | 12.5 | 5.70 | 95.4 | 9.3 | 98.4 | 2,440 |
| 2023-Q1 | 281.2 | 143.0 | 22.8 | 1.5 | 4,492 | 62.60 | 2,160 | 43.5 | 13.0 | 5.90 | 96.0 | 9.1 | 98.7 | 2,600 |
| 2023-Q2 | 290.5 | 154.0 | 21.9 | 2.4 | 4,604 | 63.10 | 2,310 | 46.0 | 13.0 | 6.10 | 95.4 | 9.0 | 99.0 | 2,760 |
| 2023-Q3 | 298.9 | 165.0 | 21.0 | 1.9 | 4,678 | 63.90 | 2,450 | 48.5 | 13.0 | 6.30 | 94.8 | 9.6 | 99.2 | 3,050 |
| 2023-Q4 | 327.7 | 188.0 | 20.2 | 3.1 | 4,833 | 67.80 | 2,640 | 51.0 | 13.0 | 6.50 | 94.0 | 10.4 | 99.5 | 3,310 |
| 2024-Q1 | 380.0 | 228.0 | 19.0 | 0.8 | 5,873 | 64.70 | 2,850 | 53.5 | 14.0 | 6.80 | 93.2 | 11.2 | 100.0 | 3,700 |
| 2024-Q2 | 405.0 | 251.7 | 18.0 | −6.5 | 6,212 | 65.20 | 3,040 | 56.0 | 14.0 | 7.00 | 92.3 | 12.1 | 103.2 | 4,200 |
| 2024-Q3 | 430.0 | 276.5 | 16.8 | −11.2 | 6,535 | 65.80 | 3,210 | 58.5 | 14.0 | 7.20 | 91.2 | 13.3 | 106.5 | 4,800 |
| 2024-Q4 | 520.0 | 345.6 | 15.6 | −14.8 | 7,482 | 69.50 | 3,420 | 61.0 | 14.0 | 7.40 | 90.1 | 14.6 | 109.4 | 5,400 |
| 2025-Q1 | 486.0 | 331.1 | 14.8 | −18.4 | 7,319 | 66.40 | 3,540 | 62.5 | 15.0 | 7.50 | 89.4 | 15.9 | 112.1 | 5,900 |
| 2025-Q2 | 483.0 | 333.1 | 14.0 | −21.6 | 7,220 | 66.90 | 3,610 | 63.5 | 15.0 | 7.60 | 88.6 | 17.1 | 114.6 | 6,250 |
| 2025-Q3 | 478.0 | 331.7 | 14.2 | −16.2 | 7,113 | 67.20 | 3,650 | 64.0 | 15.0 | 7.50 | 88.0 | 18.2 | 116.4 | 6,380 |
| 2025-Q4 | 512.0 | 346.6 | 15.0 | −9.4 | 7,232 | 70.80 | 3,720 | 62.0 | 15.0 | 7.20 | 89.0 | 19.0 | 118.0 | 6,400 |
| 2026-Q1 | 508.0 | 326.6 | 15.8 | −3.1 | 7,460 | 68.10 | 3,810 | 58.0 | 15.0 | 6.80 | 90.6 | 17.6 | 117.2 | 6,350 |
| 2026-Q2 | 522.0 | 322.3 | 16.6 | 4.2 | 7,598 | 68.70 | 3,930 | 55.0 | 15.0 | 6.40 | 92.0 | 15.8 | 116.1 | 6,320 |
| 2026-Q3 | 538.0 | 318.5 | 17.5 | 9.8 | 7,763 | 69.30 | 4,060 | 52.0 | 15.0 | 6.10 | 92.8 | 14.2 | 114.8 | 6,300 |

Column notes:

- `landed_cost_index_electronics` is indexed to **2024-Q1 = 100** (values before 2024-Q1 sit just
  below 100). It covers the tariff-exposed categories: consumer electronics + small kitchen
  appliances.
- `revenue_usd_m` is recognized revenue: first-party GMV booked gross, plus the marketplace take
  rate applied to third-party GMV (see identities below).
- `orders_k` × `aov_usd` reproduces GMV by construction (see identities below).

---

## 3. The 10 story-beat constraints

These are the constraints the bible's values were authored to satisfy, verbatim from the master
plan (§5.3). Any regeneration of the bible must re-satisfy all ten.

1. Revenue grows ~45% CAGR 2021→2023 (from ~$310M FY2021 to ~$650M FY2023 revenue).
2. IPO Q2-2023; headcount jumps ~20% in the two quarters after.
3. `first_party_share_pct`: 34 (Q1-2022) → 61 (Q4-2024), monotone rise.
4. `gross_margin_pct`: 24 (Q4-2022) → 14 (Q2-2025), decline tracking beat 3.
5. Revenue plateaus Q1-2025→Q3-2025 (each quarter within ±2% of the prior); `net_income_usd_m` negative for 5 consecutive quarters Q2-2024→Q2-2025.
6. `on_time_delivery_pct`: 96 (Q1-2023) → 88 (Q3-2025), with the two named suppliers' SLA (spec'd in suppliers.md) as the causal driver.
7. `tickets_per_1k_orders`: 9 → 19 over the same window, lagging beat 6 by one quarter.
8. `landed_cost_index_electronics`: 100 (Q1-2024) → 118 (Q4-2025).
9. New CEO Q3-2025 (no numeric effect that quarter); pivot announced Q4-2025.
10. Green shoots: `first_party_share_pct` falls to 52 by Q3-2026; `gross_margin_pct` recovers to 17.5 by Q3-2026; `on_time_delivery_pct` back to 92 by Q2-2026 (Brightline dropped / Saigon onboarded Q1-2026); marketplace (3P) GMV grows ≥9% QoQ in Q1-2026 and Q2-2026; net income turns positive in Q2-2026.

## 4. The identities `pnpm reconcile` enforces (bible-internal)

Checked on every one of the 23 rows:

- `orders_k × aov_usd ≈ gmv_usd_m × 1000` (±1%)
- `revenue_usd_m = gmv_usd_m × 1P% + take_rate% × gmv_usd_m × (1 − 1P%)` (±1%)
- Margin / net-income consistency with the modeled opex schedule (E2#4): gross profit
  (`revenue × gross_margin_pct`) is positive everywhere and net income always sits below it by a
  plausible opex wedge.

Once seed generators exist, `pnpm reconcile` additionally aggregates the seeded database per
quarter (revenue, orders, AOV, on-time %, tickets/1k) and diffs against the bible within ±2% —
see `docs/data-specs/reconciliation.md`.

## 5. DEMO_EPOCH note (living-demo clock safety)

The daily +1-day clock-shift job moves *timestamps*, so seeded rows are generated with **quarter
tags relative to a `DEMO_EPOCH` anchor**; the reconcile aggregation buckets by quarter tag, not
wall-clock, so shifting never breaks reconciliation. The bible's `quarter` values (`YYYY-Qn`) are
those relative tags — the demo clock can drift +1 day forever and every row still reconciles to
its quarter.
