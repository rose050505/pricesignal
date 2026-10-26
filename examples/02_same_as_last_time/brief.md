# PriceSignal brief
> same as last time, but what if we go -2%?

**-2% is below the market benchmark in DE, CA and AU.**

Cost policy: recover 70% of incremental unit cost (remembered from an earlier request (mem-1)) · proposed change: -2%. This policy does not scale the market benchmark.

Your unit costs: +8% (remembered from your last request). Current unit cost is 60% of current selling price (remembered); recovering 70% of the incremental cost gives a +3.4% selling-price scenario.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price.

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| DE (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +0.4% | +1.4% (12 of 12 monthly observations) | easing | +3.3% | 0.4–1.4% | below the market benchmark |
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% (12 of 12 monthly observations) | easing | +3.1% | 2.2–4.1% | below the market benchmark |
| AU (Australian Bureau of Statistics (CPI)) | Food and non-alcoholic beverages | 2026-08 | +3.0% | +3.2% (12 of 12 monthly observations) | flat | +4.0% | 3.0–3.2% | below the market benchmark |

Every rate above comes from Zetaris query **Q7** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Same-period comparison

Latest common observation: **2026-08** (monthly; 2 months before this brief). Only observation dates are aligned. National baskets and category coverage can still differ, so equal dates do not make these series identical measures.

| Market | Selected official category | Common-period YoY | Latest observation | Source |
|---|---|---|---|---|
| DE | Food and non-alcoholic beverages | +0.2% | 2026-09: +0.4% | eurostat:prc_hicp_minr:CP01:RCH_A · Q7 |
| CA | Food | +2.9% | 2026-09: +2.2% | statcan:18100004:v41690974 · Q7 |
| AU | Food and non-alcoholic beverages | +3.0% | 2026-08: +3.0% | abs:CPI:1.20001.10.50.M · Q7 |

The latest-period market benchmarks and SKU price scenarios remain unchanged. This table aligns observation dates only.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list_night1027c11`) joined in query **Q15** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.

| SKU | Product | Market | Current price | Benchmark price scenario | At -2% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | AU | 8.50 AUD | 8.61–8.62 AUD (+1.3–1.4%) | 8.33 AUD (below the market benchmark) | +1.3% 2026-08 · Food additives and condiments (product match; remembered match) |
| HBC-60 | Honey butter chips 60 g | AU | 3.99 AUD | 4.01–4.19 AUD (+0.6–4.9%) | 3.91 AUD (below the market benchmark) | +0.6% 2026-08 · Snacks and confectionery (product match; remembered match) |
| KRM-5P | Kimchi ramen 5-pack | AU | 10.50 AUD | 10.82–10.84 AUD (+3.0–3.2%) | 10.29 AUD (below the market benchmark) | +3.0% 2026-08 · Food and non-alcoholic beverages |
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.65–7.80 CAD (+2.2–4.1%) | 7.34 CAD (below the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.87–3.95 CAD (+2.2–4.1%) | 3.71 CAD (below the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.21–10.40 CAD (+2.2–4.1%) | 9.79 CAD (below the market benchmark) | +2.2% 2026-09 · Food |
| GCJ-500 | Gochujang 500 g | DE | 4.99 EUR | 4.98–5.06 EUR (-0.2–1.4%) | 4.89 EUR (below the market benchmark) | +1.4% 2026-09 · Salt, condiments and sauces (ND) (product match; remembered match) |
| HBC-60 | Honey butter chips 60 g | DE | 2.49 EUR | 2.50–2.52 EUR (+0.4–1.4%) | 2.44 EUR (below the market benchmark) | +0.4% 2026-09 · Food and non-alcoholic beverages (broader proxy; remembered match) |
| KRM-5P | Kimchi ramen 5-pack | DE | 6.99 EUR | 7.02–7.09 EUR (+0.4–1.4%) | 6.85 EUR (below the market benchmark) | +0.4% 2026-09 · Food and non-alcoholic beverages |

## By market
### DE — Eurostat (HICP)
Food and non-alcoholic beverages: +0.4% year on year in 2026-09 (easing vs. six months ago; average +1.4%, 12 of 12 monthly observations). Historical market benchmark 0.4–1.4%.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q7</sub>

### CA — Statistics Canada (CPI)
Food: +2.2% year on year in 2026-09 (easing vs. six months ago; average +4.1%, 12 of 12 monthly observations). Historical market benchmark 2.2–4.1%.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q7</sub>

### AU — Australian Bureau of Statistics (CPI)
Food and non-alcoholic beverages: +3.0% year on year in 2026-08 (flat vs. six months ago; average +3.2%, 12 of 12 monthly observations). Historical market benchmark 3.0–3.2%.
<sub>source: `abs:CPI:1.20001.10.50.M` · monthly · cite Q7</sub>

## Costs vs. the market
Compare the cost-recovery price scenario with the historical movement of consumer prices. Neither establishes demand, competitor responses or a profit-maximizing price.

- DE: the +3.4% cost-recovery price scenario is above the market benchmark (Food and non-alcoholic beverages: 0.4–1.4%).
- CA: the +3.4% cost-recovery price scenario is within the market benchmark (Food: 2.2–4.1%).
- AU: the +3.4% cost-recovery price scenario is above the market benchmark (Food and non-alcoholic beverages: 3.0–3.2%).

## Since your last brief (remembered in H-MEM)
- DE Food and non-alcoholic beverages (last brief 2026-10-26, mem-14): no new official release (still 2026-09, +0.4%); market benchmark unchanged; last time +5% was above the market benchmark; now -2% is below the market benchmark.
- CA Food (last brief 2026-10-26, mem-15): no new official release (still 2026-09, +2.2%); market benchmark unchanged; last time +5% was above the market benchmark; now -2% is below the market benchmark.
- AU Food and non-alcoholic beverages (last brief 2026-10-26, mem-16): no new official release (still 2026-08, +3.0%); market benchmark unchanged; last time +5% was above the market benchmark; now -2% is below the market benchmark.

## Fragmentation the agent found
- DE: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr. (remembered from an earlier run)
- CA condiments: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products. (remembered SKU selection)
- DE condiments: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr. (remembered SKU selection)
- CA snacks: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products. (remembered SKU selection)
- DE snacks: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr. Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products. (remembered SKU selection)

## Evidence
Views: `psig.v_au_food_20001_m_yoyv2_night1027c11` (memory), `psig.v_ca_food_v41690974_live_yoyv2_night1027c11` (memory), `psig.v_de_food_prc_hicp_minr_cp01_night1027c11` (memory), `psig.v_ca_all_items_v41690973_live_yoyv2_night1027c11` (memory), `psig.v_au_all_items_10001_m_yoyv2_night1027c11` (memory), `psig.v_de_all_items_prc_hicp_minr_total_night1027c11` (memory), `psig.v_ca_condiments_v41690974_live_yoyv2_night1027c11` (memory), `psig.v_de_condiments_prc_hicp_minr_cp01193_night1027c11` (memory), `psig.v_au_condiments_97549_m_yoyv2_night1027c11` (memory), `psig.v_ca_snacks_v41690974_live_yoyv2_night1027c11` (memory), `psig.v_de_snacks_prc_hicp_minr_cp01_night1027c11` (memory), `psig.v_au_snacks_115501_m_yoyv2_night1027c11` (memory)

<details><summary>Q1 · 1 rows · 698 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_food_20001_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q2 · 1 rows · 884 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q3 · 1 rows · 1057 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q4 · 1 rows · 389 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q5 · 1 rows · 587 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_all_items_10001_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 586 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q7 · 84 rows · 4004 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_all_items_10001_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_all_items_prc_hicp_minr_total_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q9 · 1 rows · 516 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q10 · 1 rows · 570 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_condiments_prc_hicp_minr_cp01193_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q11 · 1 rows · 631 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_condiments_97549_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q12 · 1 rows · 495 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q13 · 1 rows · 471 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_snacks_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q14 · 1 rows · 639 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_115501_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q15 · 126 rows · 6279 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_night1027c11 p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_condiments_prc_hicp_minr_cp01193_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_condiments_97549_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001_m_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_yoyv2_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_food_prc_hicp_minr_cp01_night1027c11 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('DE', 'CA', 'AU')
ORDER BY p.country, p.sku, s.period
```
</details>

_Narrative omitted: the model provider returned an error or timed out, so only computed facts are shown._