# PriceSignal brief
> japan + canada food prices, ok to raise 5%?

**Canada food inflation 2.2% YoY; 5% proposed hike above benchmark 2.2–4.1%**

Cost policy: recover 60% of incremental unit cost (remembered from an earlier request (mem-19)) · proposed change: +5%. This policy does not scale the market benchmark.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price.

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% (12 of 12 monthly observations) | easing | +3.1% | 2.2–4.1% | above the market benchmark |

Every rate above comes from Zetaris query **Q3** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list_night1027c7`) joined in query **Q7** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.

| SKU | Product | Market | Current price | Benchmark price scenario | At +5% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.65–7.80 CAD (+2.2–4.1%) | 7.86 CAD (above the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.87–3.95 CAD (+2.2–4.1%) | 3.98 CAD (above the market benchmark) | +2.2% 2026-09 · Food (broader proxy; remembered match) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.21–10.40 CAD (+2.2–4.1%) | 10.49 CAD (above the market benchmark) | +2.2% 2026-09 · Food |

## By market
### CA — Statistics Canada (CPI)
Statistics Canada reports food CPI rose 2.2% YoY in September 2026, with a 12-month average of 4.1% across 12 monthly observations and an easing trend. The proposed 5% increase falls above the historical benchmark range 2.2–4.1%, matching the verdict 'above the market benchmark.'
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q3</sub>

## Fragmentation the agent found
- japan: not covered yet - PriceSignal currently reads Eurostat (EU markets), Statistics Canada (CA) and ABS (AU).
- CA condiments: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products. (remembered SKU selection)
- CA snacks: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products. (remembered SKU selection)

**Watch:** Re-check Canada's next monthly food CPI print to confirm whether the 2.2% YoY pace and easing trend continue, and whether Japan data becomes available per the source caveat.

## Evidence
Views: `psig.v_ca_food_v41690974_live_night1027c7` (memory), `psig.v_ca_all_items_v41690973_live_night1027c7` (memory), `psig.v_ca_condiments_v41690974_live_night1027c7` (memory), `psig.v_ca_snacks_v41690974_live_night1027c7` (memory)

<details><summary>Q1 · 1 rows · 1245 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q2 · 1 rows · 482 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q3 · 28 rows · 767 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q5 · 1 rows · 493 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 312 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q7 · 42 rows · 1256 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_night1027c7 p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('CA')
ORDER BY p.country, p.sku, s.period
```
</details>