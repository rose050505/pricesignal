# PriceSignal brief
> france, italy and spain food prices: can we go +3%? we pass on about 70%

**Proposed 3% food price increase exceeds HICP benchmarks in France, Italy, and Spain.**

Cost policy: recover 70% of incremental unit cost (stated in this request) · proposed change: +3%. This policy does not scale the market benchmark.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price.

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| FR (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.5% | +1.5% (12 of 12 monthly observations) | easing | +3.4% | 1.5–1.5% | above the market benchmark |
| IT (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.7% | +2.1% (12 of 12 monthly observations) | easing | +4.2% | 1.7–2.1% | above the market benchmark |
| ES (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +2.7% | +2.5% (12 of 12 monthly observations) | flat | +5.0% | 2.5–2.7% | above the market benchmark |

Every rate above comes from Zetaris query **Q19** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Same-period comparison

Latest common observation: **2026-09** (monthly; 1 months before this brief). Only observation dates are aligned. National baskets and category coverage can still differ, so equal dates do not make these series identical measures.

| Market | Selected official category | Common-period YoY | Latest observation | Source |
|---|---|---|---|---|
| FR | Food and non-alcoholic beverages | +1.5% | 2026-09: +1.5% | eurostat:prc_hicp_minr:CP01:RCH_A · Q19 |
| IT | Food and non-alcoholic beverages | +1.7% | 2026-09: +1.7% | eurostat:prc_hicp_minr:CP01:RCH_A · Q19 |
| ES | Food and non-alcoholic beverages | +2.7% | 2026-09: +2.7% | eurostat:prc_hicp_minr:CP01:RCH_A · Q19 |

The latest-period market benchmarks and SKU price scenarios remain unchanged. This table aligns observation dates only.

## By market
### FR — Eurostat (HICP)
France's food HICP rose 1.5% YoY in September 2026, with a 12-month average of 1.5% across 12 monthly observations and a benchmark range of 1.5–1.5. A proposed 3% increase exceeds this range, and the verdict is above the market benchmark.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q19</sub>

### IT — Eurostat (HICP)
Italy's food HICP rose 1.7% YoY in September 2026, with a 12-month average of 2.1% across 12 monthly observations and a benchmark range of 1.7–2.1. A proposed 3% increase exceeds this range, and the verdict is above the market benchmark.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q19</sub>

### ES — Eurostat (HICP)
Spain's food HICP rose 2.7% YoY in September 2026, with a 12-month average of 2.5% across 12 monthly observations and a benchmark range of 2.5–2.7. A proposed 3% increase exceeds this range, and the verdict is above the market benchmark.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q19</sub>

## Fragmentation the agent found
- FR: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- IT: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- ES: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- No usable SKU category information was returned; SKU prices are omitted.

**Watch:** Note the discontinued Eurostat prc_hicp_manr series; re-check next month's HICP under successor prc_hicp_minr classification.

## Evidence
Views: `psig.v_fr_food_prc_hicp_minr_cp01_night1027c11` (onboarded), `psig.v_fr_all_items_prc_hicp_minr_total_night1027c11` (onboarded), `psig.v_it_food_prc_hicp_minr_cp01_night1027c11` (onboarded), `psig.v_it_all_items_prc_hicp_minr_total_night1027c11` (onboarded), `psig.v_es_food_prc_hicp_minr_cp01_night1027c11` (onboarded), `psig.v_es_all_items_prc_hicp_minr_total_night1027c11` (onboarded)

<details><summary>Q3 · 1 rows · 654 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 566 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q9 · 1 rows · 658 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q12 · 1 rows · 591 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q15 · 1 rows · 622 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q18 · 1 rows · 548 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q19 · 90 rows · 3079 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_fr_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_fr_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_it_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_it_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_es_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_es_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>