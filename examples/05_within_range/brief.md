# PriceSignal brief
> canada & australia food: costs rose 8%, unit costs are 60% of our selling price; we pass on 70%; what about +3%?

**Canada and Australia food CPI YoY trends benchmarked against proposed 3% increase**

Cost policy: recover 70% of incremental unit cost (stated in this request) · proposed change: +3%. This policy does not scale the market benchmark.

Your unit costs: +8% (stated in this request). Current unit cost is 60% of current selling price; recovering 70% of the incremental cost gives a +3.4% selling-price scenario.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price.

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% (12 of 12 monthly observations) | easing | +3.1% | 2.2–4.1% | within the market benchmark |
| AU (Australian Bureau of Statistics (CPI)) | Food and non-alcoholic beverages | 2026-08 | +3.0% | +3.2% (12 of 12 monthly observations) | flat | +4.0% | 3.0–3.2% | within the market benchmark |

Every rate above comes from Zetaris query **Q5** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list_night1027c7`) joined in query **Q13** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.

| SKU | Product | Market | Current price | Benchmark price scenario | At +3% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | AU | 8.50 AUD | 8.61–8.62 AUD (+1.3–1.4%) | 8.76 AUD (above the market benchmark) | +1.3% 2026-08 · Food additives and condiments (product match; model-selected) |
| HBC-60 | Honey butter chips 60 g | AU | 3.99 AUD | 4.01–4.19 AUD (+0.6–4.9%) | 4.11 AUD (within the market benchmark) | +0.6% 2026-08 · Snacks and confectionery (product match; model-selected) |
| KRM-5P | Kimchi ramen 5-pack | AU | 10.50 AUD | 10.82–10.84 AUD (+3.0–3.2%) | 10.82 AUD (within the market benchmark) | +3.0% 2026-08 · Food and non-alcoholic beverages |
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.65–7.80 CAD (+2.2–4.1%) | 7.71 CAD (within the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.87–3.95 CAD (+2.2–4.1%) | 3.90 CAD (within the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.21–10.40 CAD (+2.2–4.1%) | 10.29 CAD (within the market benchmark) | +2.2% 2026-09 · Food |

## By market
### CA — Statistics Canada (CPI)
Canada's food CPI rose 2.2% YoY in September 2026, with a 12-month average of 4.1% across 12 monthly observations and an easing trend. The proposed 3% increase falls within the benchmark range of 2.2-4.1%, matching the verdict 'within the market benchmark'; cost need is 3.4% with 70% pass-through on a 60% cost share, and cost_vs_market confirms 'within the market benchmark'.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q5</sub>

### AU — Australian Bureau of Statistics (CPI)
Australia's food CPI was flat at 3.0% YoY in August 2026, with a 12-month average of 3.2% across 12 monthly observations and a flat trend. The proposed 3% increase falls within the benchmark range of 3-3.2%, consistent with the verdict 'within the market benchmark'; however, cost_vs_market compares it 'above the market benchmark' given the 8% cost rise, 70% pass-through, and 60% cost share.
<sub>source: `abs:CPI:1.20001.10.50.M` · monthly · cite Q5</sub>

## Costs vs. the market
Compare the cost-recovery price scenario with the historical movement of consumer prices. Neither establishes demand, competitor responses or a profit-maximizing price.

- CA: the +3.4% cost-recovery price scenario is within the market benchmark (Food: 2.2–4.1%).
- AU: the +3.4% cost-recovery price scenario is above the market benchmark (Food and non-alcoholic beverages: 3.0–3.2%).

## Since your last brief (remembered in H-MEM)
- CA Food (last brief 2026-10-26, mem-24): no new official release (still 2026-09, +2.2%); market benchmark unchanged; cost-recovery policy 60% -> 70%; last time +5% was above the market benchmark; now +3% is within the market benchmark.

## Fragmentation the agent found
- CA condiments: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products. (remembered SKU selection)
- CA snacks: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products. (remembered SKU selection)

**Watch:** Re-check Canada's October 2026 and Australia's September 2026 food CPI prints to confirm whether the current YoY pace and trend direction persist.

## Evidence
Views: `psig.v_ca_food_v41690974_live_night1027c7` (memory), `psig.v_au_food_20001_night1027c7` (memory), `psig.v_ca_all_items_v41690973_live_night1027c7` (memory), `psig.v_au_all_items_10001_night1027c7` (memory), `psig.v_ca_condiments_v41690974_live_night1027c7` (memory), `psig.v_ca_snacks_v41690974_live_night1027c7` (memory), `psig.v_au_condiments_97549_night1027c7` (onboarded), `psig.v_au_snacks_115501_night1027c7` (onboarded)

<details><summary>Q1 · 1 rows · 758 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q2 · 1 rows · 781 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_food_20001_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q3 · 1 rows · 446 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q4 · 1 rows · 650 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_all_items_10001_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q5 · 54 rows · 1753 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_all_items_10001_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q7 · 1 rows · 397 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q8 · 1 rows · 416 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q11 · 1 rows · 484 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_condiments_97549_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q12 · 1 rows · 649 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_115501_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q13 · 81 rows · 3278 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_night1027c7 p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_condiments_97549_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('CA', 'AU')
ORDER BY p.country, p.sku, s.period
```
</details>