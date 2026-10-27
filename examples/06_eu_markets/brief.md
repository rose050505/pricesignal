# PriceSignal brief
> france, italy and spain food prices: can we raise prices +3%? we pass on about 70%

**+3% is above the market benchmark in FR, IT and ES.**

How far: +3% is 1.5 pp above the FR benchmark top (1.5%), 0.9 pp above IT (2.1%), 0.3 pp above ES (2.7%).

No single change is within every market benchmark: the FR top (1.5%) is below the ES bottom (2.5%). Highest change within each: FR +1.5%, IT +2.1%, ES +2.7%.

> Nemotron: Inflation easing in FR and IT, flat in ES; +3% is above the market benchmark in FR, IT and ES

Cost policy: recover 70% of incremental unit cost (stated in this request) · proposed change: +3%. Add your cost change and unit-cost share (for example “costs rose 8%, unit costs are 60% of our selling price”) to turn this policy into a cost-recovery target.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price. It compares a one-off price change with about a year of consumer-price growth; if your last increase was longer ago, the comparable growth is larger. Exchange-rate moves are not included.

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| FR (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.5% | +1.5% (12 of 12 monthly observations) | easing | +3.4% (All-items context only; 2026-09) | 1.5% (single value) | above the market benchmark |
| IT (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.7% | +2.1% (12 of 12 monthly observations) | easing | +4.2% (All-items context only; 2026-09) | 1.7–2.1% | above the market benchmark |
| ES (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +2.7% | +2.5% (12 of 12 monthly observations) | flat | +5.0% (All-items context only; 2026-09) | 2.5–2.7% | above the market benchmark |

Every rate above comes from Zetaris query **Q28** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Same-period comparison

Latest common observation: **2026-09** (monthly; 1 month before this brief). Only observation dates are aligned. National baskets and category coverage can still differ, so equal dates do not make these series identical measures.

| Market | Selected official category | Common-period YoY | Latest observation | Source |
|---|---|---|---|---|
| FR | Food and non-alcoholic beverages | +1.5% | 2026-09: +1.5% | eurostat:prc_hicp_minr:CP01:RCH_A · Q28 |
| IT | Food and non-alcoholic beverages | +1.7% | 2026-09: +1.7% | eurostat:prc_hicp_minr:CP01:RCH_A · Q28 |
| ES | Food and non-alcoholic beverages | +2.7% | 2026-09: +2.7% | eurostat:prc_hicp_minr:CP01:RCH_A · Q28 |

The latest-period market benchmarks and SKU price scenarios remain unchanged. This table aligns observation dates only.

## By market
### FR — Eurostat (HICP)
Food inflation is 1.5% YoY in September 2026, with a 12-month average of 1.5% across 12 monthly observations. +3% is above the market benchmark (1.5 to 1.5).
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q28</sub>

### IT — Eurostat (HICP)
Food inflation is 1.7% YoY in September 2026, with a 12-month average of 2.1% across 12 monthly observations. +3% is above the market benchmark (1.7 to 2.1).
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q28</sub>

### ES — Eurostat (HICP)
Food inflation is 2.7% YoY in September 2026, with a 12-month average of 2.5% across 12 monthly observations. +3% is above the market benchmark (2.5 to 2.7).
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q28</sub>

## Fragmentation the agent found
- FR: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- IT: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- ES: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- ES: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr. (remembered from an earlier run)
- Your price list has no products in FR, IT, ES; SKU prices are omitted.

**Watch:** Re-check next month's food prints for any change in trend.

## Evidence
Views: `psig.v_fr_food_prc_hicp_minr_cp01_ex20261027_234114_2269488` (onboarded), `psig.v_fr_all_items_prc_hicp_minr_total_ex20261027_234114_2269488` (onboarded), `psig.v_it_food_prc_hicp_minr_cp01_ex20261027_234114_2269488` (onboarded), `psig.v_it_all_items_prc_hicp_minr_total_ex20261027_234114_2269488` (onboarded), `psig.v_es_food_prc_hicp_minr_cp01_ex20261027_234114_2269488` (memory), `psig.v_es_all_items_prc_hicp_minr_total_ex20261027_234114_2269488` (onboarded)

<details><summary>Q4 · 1 row · 307 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_food_prc_hicp_minr_cp01_ex20261027_234114_2269488 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q8 · 1 row · 271 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_all_items_prc_hicp_minr_total_ex20261027_234114_2269488 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q12 · 1 row · 334 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_food_prc_hicp_minr_cp01_ex20261027_234114_2269488 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q16 · 1 row · 279 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_all_items_prc_hicp_minr_total_ex20261027_234114_2269488 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q20 · 1 row · 303 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_food_prc_hicp_minr_cp01_ex20261027_234114_2269488 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q22 · 1 row · 331 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_food_prc_hicp_minr_cp01_ex20261027_234114_2269488 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q26 · 1 row · 318 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_all_items_prc_hicp_minr_total_ex20261027_234114_2269488 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q28 · 90 rows · 3017 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_market_inflation_bfecf282_ex20261027_234114_2269488 WHERE period >= '2025-07'
ORDER BY country, concept, period
```
</details>