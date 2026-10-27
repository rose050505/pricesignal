# PriceSignal brief
> USA & canada food: can we raise prices 3%? we pass on 70%

**+3% is above the market benchmark in US; within the market benchmark in CA.**

How far: +3% is 0.1 pp above the US benchmark top (2.9%), within CA (2.2–4.1%). US is a close call (0.2 pp or less outside the benchmark).

Within every market benchmark: +2.5% to +2.9%.

> Nemotron: +3% above benchmark in US; within benchmark in CA

Cost policy: recover 70% of incremental unit cost (stated in this request) · proposed change: +3%. Add your cost change and unit-cost share (for example “costs rose 8%, unit costs are 60% of our selling price”) to turn this policy into a cost-recovery target.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price. It compares a one-off price change with about a year of consumer-price growth; if your last increase was longer ago, the comparable growth is larger. Exchange-rate moves are not included.

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| US (U.S. Bureau of Labor Statistics (CPI)) | Food | 2026-09 | +2.5% | +2.9% (11 of 12 monthly observations) | flat | +3.7% (All-items context only; 2026-09) | 2.5–2.9% | above the market benchmark |
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% (12 of 12 monthly observations) | easing | +3.1% (All-items context only; 2026-09) | 2.2–4.1% | within the market benchmark |

Every rate above comes from Zetaris query **Q14** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Same-period comparison

Latest common observation: **2026-09** (monthly; 1 month before this brief). Only observation dates are aligned. National baskets and category coverage can still differ, so equal dates do not make these series identical measures.

| Market | Selected official category | Common-period YoY | Latest observation | Source |
|---|---|---|---|---|
| US | Food | +2.5% | 2026-09: +2.5% | bls:CU:CUUR0000SAF1 · Q14 |
| CA | Food | +2.2% | 2026-09: +2.2% | statcan:18100004:v41690974 · Q14 |

The latest-period market benchmarks and SKU price scenarios remain unchanged. This table aligns observation dates only.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list_ex20261028_005844_2524371`) joined in query **Q21** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.

| SKU | Product | Market | Current price | Benchmark price scenario | At +3% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.65–7.80 CAD (+2.2–4.1%) | 7.71 CAD (within the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.87–3.95 CAD (+2.2–4.1%) | 3.90 CAD (within the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.21–10.40 CAD (+2.2–4.1%) | 10.29 CAD (within the market benchmark) | +2.2% 2026-09 · Food |

## By market
### US — U.S. Bureau of Labor Statistics (CPI)
Food inflation is 2.5% YoY in September 2026, with a 12-month average of 2.9% across 11 monthly observations. +3% is above the market benchmark.
<sub>source: `bls:CU:CUUR0000SAF1` · monthly · cite Q14</sub>

### CA — Statistics Canada (CPI)
Food inflation is 2.2% YoY in September 2026, with a 12-month average of 4.1% across 12 monthly observations. +3% is within the market benchmark.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q14</sub>

## Since your last brief (remembered in H-MEM)
- CA Food (last brief 2026-10-27, mem-43): no new official release (still 2026-09, +2.2%); market benchmark unchanged; last time +4% was within the market benchmark; now +3% is within the market benchmark.

## Fragmentation the agent found
- CA condiments: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products; no product-specific official series was found. (remembered SKU selection)
- CA snacks: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products; no product-specific official series was found. (remembered SKU selection)

**Watch:** Re-check next month's food prints for any change in trend.

## Evidence
Views: `psig.v_ca_food_v41690974_live_yoyv2_ex20261028_005844_2524371` (memory), `psig.v_us_food_cuur0000saf1_yoyv2_ex20261028_005844_2524371` (onboarded), `psig.v_us_all_items_cuur0000sa0_yoyv2_ex20261028_005844_2524371` (onboarded), `psig.v_ca_all_items_v41690973_live_yoyv2_ex20261028_005844_2524371` (memory), `psig.v_ca_condiments_v41690974_live_yoyv2_ex20261028_005844_2524371` (memory), `psig.v_ca_snacks_v41690974_live_yoyv2_ex20261028_005844_2524371` (memory)

<details><summary>Q2 · 1 row · 360 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 row · 320 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_us_food_cuur0000saf1_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q10 · 1 row · 302 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_us_all_items_cuur0000sa0_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q12 · 1 row · 180 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q14 · 56 rows · 1938 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_market_inflation_31da20e0_ex20261028_005844_2524371 WHERE period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q18 · 1 row · 204 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q20 · 1 row · 221 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q21 · 42 rows · 769 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_ex20261028_005844_2524371 p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_yoyv2_ex20261028_005844_2524371 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('US', 'CA')
ORDER BY p.country, p.sku, s.period
```
</details>