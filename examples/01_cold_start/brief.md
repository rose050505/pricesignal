# PriceSignal brief
> our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? our costs rose 8%, unit costs are 60% of our selling price. we pass on ~70% of cost increases. thinking +5% for Q1, too much?

**+5% is above the market benchmark in DE, CA and AU.**

How far: +5% is 3.6 pp above the DE benchmark top (1.4%), 0.9 pp above CA (4.1%), 1.8 pp above AU (3.2%). Your cost-recovery scenario is +3.1%: +5% is 1.9 pp more.

No single change is within every market benchmark: the DE top (1.4%) is below the AU bottom (3.0%). Highest change within each: DE +1.4%, CA +4.1%, AU +3.2%.

> Nemotron: +5% above benchmark in DE, CA and AU

Cost policy: recover 70% of incremental unit cost (stated in this request) · proposed change: +5%. This policy does not scale the market benchmark.

Your unit costs: +8% (stated in this request). Cost share is 60%: unit cost after the stated cost change / unchanged selling price; recovering 70% of the incremental cost gives a +3.1% selling-price scenario.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price. It compares a one-off price change with about a year of consumer-price growth; if your last increase was longer ago, the comparable growth is larger. Exchange-rate moves are not included.

Basket note: the CA (StatCan Food) and AU (ABS Food and non-alcoholic beverages) series include restaurant and take-away meals; the DE (Eurostat Food and non-alcoholic beverages) series does not (HICP counts restaurants separately).

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| DE (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +0.4% | +1.4% (12 of 12 monthly observations) | easing | +3.3% (All-items context only; 2026-09) | 0.4–1.4% | above the market benchmark |
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% (12 of 12 monthly observations) | easing | +3.1% (All-items context only; 2026-09) | 2.2–4.1% | above the market benchmark |
| AU (Australian Bureau of Statistics (CPI)) | Food and non-alcoholic beverages | 2026-08 | +3.0% | +3.2% (12 of 12 monthly observations) | flat | +4.0% (All-items context only; 2026-08) | 3.0–3.2% | above the market benchmark |

Every rate above comes from Zetaris query **Q26** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Same-period comparison

Latest common observation: **2026-08** (monthly; 2 months before this brief). Only observation dates are aligned. National baskets and category coverage can still differ, so equal dates do not make these series identical measures.

| Market | Selected official category | Common-period YoY | Latest observation | Source |
|---|---|---|---|---|
| DE | Food and non-alcoholic beverages | +0.2% | 2026-09: +0.4% | eurostat:prc_hicp_minr:CP01:RCH_A · Q26 |
| CA | Food | +2.9% | 2026-09: +2.2% | statcan:18100004:v41690974 · Q26 |
| AU | Food and non-alcoholic beverages | +3.0% | 2026-08: +3.0% | abs:CPI:1.20001.10.50.M · Q26 |

The latest-period market benchmarks and SKU price scenarios remain unchanged. This table aligns observation dates only.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list_ex20261028_003921_2475718`) joined in query **Q52** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.

| SKU | Product | Market | Current price | Benchmark price scenario | At +5% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | AU | 8.50 AUD | 8.61–8.62 AUD (+1.3–1.4%) | 8.93 AUD (above the market benchmark) | +1.3% 2026-08 · Food additives and condiments (product match; model-selected) |
| HBC-60 | Honey butter chips 60 g | AU | 3.99 AUD | 4.01–4.19 AUD (+0.6–4.9%) | 4.19 AUD (above the market benchmark) | +0.6% 2026-08 · Snacks and confectionery (product match; model-selected) |
| KRM-5P | Kimchi ramen 5-pack | AU | 10.50 AUD | 10.82–10.84 AUD (+3.0–3.2%) | 11.03 AUD (above the market benchmark) | +3.0% 2026-08 · Food and non-alcoholic beverages |
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.65–7.80 CAD (+2.2–4.1%) | 7.86 CAD (above the market benchmark) | +2.2% 2026-09 · Food (broader proxy; only official option) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.87–3.95 CAD (+2.2–4.1%) | 3.98 CAD (above the market benchmark) | +2.2% 2026-09 · Food (broader proxy; only official option) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.21–10.40 CAD (+2.2–4.1%) | 10.49 CAD (above the market benchmark) | +2.2% 2026-09 · Food |
| GCJ-500 | Gochujang 500 g | DE | 4.99 EUR | 4.98–5.06 EUR (-0.2–1.4%) | 5.24 EUR (above the market benchmark) | +1.4% 2026-09 · Salt, condiments and sauces (ND) (product match; model-selected) |
| HBC-60 | Honey butter chips 60 g | DE | 2.49 EUR | 2.50–2.52 EUR (+0.4–1.4%) | 2.61 EUR (above the market benchmark) | +0.4% 2026-09 · Food and non-alcoholic beverages (broader proxy; unconfirmed match) |
| KRM-5P | Kimchi ramen 5-pack | DE | 6.99 EUR | 7.02–7.09 EUR (+0.4–1.4%) | 7.34 EUR (above the market benchmark) | +0.4% 2026-09 · Food and non-alcoholic beverages |

## By market
### DE — Eurostat (HICP)
Food inflation is 0.4% YoY in September 2026, with a 12-month average of 1.4% across 12 monthly observations. +5% is above the market benchmark.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q26</sub>

### CA — Statistics Canada (CPI)
Food inflation is 2.2% YoY in September 2026, with a 12-month average of 4.1% across 12 monthly observations. +5% is above the market benchmark.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q26</sub>

### AU — Australian Bureau of Statistics (CPI)
Food inflation is 3.0% YoY in August 2026, with a 12-month average of 3.2% across 12 monthly observations. +5% is above the market benchmark.
<sub>source: `abs:CPI:1.20001.10.50.M` · monthly · cite Q26</sub>

## Costs vs. the market
Compare the cost-recovery price scenario with the historical movement of consumer prices. Neither establishes demand, competitor responses or a profit-maximizing price.

- DE: the +3.1% cost-recovery price scenario is above the market benchmark (Food and non-alcoholic beverages: 0.4–1.4%).
- CA: the +3.1% cost-recovery price scenario is within the market benchmark (Food: 2.2–4.1%).
- AU: the +3.1% cost-recovery price scenario is within the market benchmark (Food and non-alcoholic beverages: 3.0–3.2%).

## Fragmentation the agent found
- DE: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- CA condiments: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products; no product-specific official series was found.
- CA snacks: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products; no product-specific official series was found.
- DE snacks: Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.

**Watch:** Re-check next month's food prints for any change in trend.

## Evidence
Views: `psig.v_ca_food_v41690974_live_yoyv2_ex20261028_003921_2475718` (onboarded), `psig.v_au_food_20001_m_yoyv2_ex20261028_003921_2475718` (onboarded), `psig.v_ca_all_items_v41690973_live_yoyv2_ex20261028_003921_2475718` (onboarded), `psig.v_de_food_prc_hicp_minr_cp01_ex20261028_003921_2475718` (onboarded), `psig.v_au_all_items_10001_m_yoyv2_ex20261028_003921_2475718` (onboarded), `psig.v_de_all_items_prc_hicp_minr_total_ex20261028_003921_2475718` (onboarded), `psig.v_ca_condiments_v41690974_live_yoyv2_ex20261028_003921_2475718` (onboarded), `psig.v_au_condiments_97549_m_yoyv2_ex20261028_003921_2475718` (onboarded), `psig.v_ca_snacks_v41690974_live_yoyv2_ex20261028_003921_2475718` (onboarded), `psig.v_de_condiments_prc_hicp_minr_cp01193_ex20261028_003921_2475718` (onboarded), `psig.v_de_snacks_prc_hicp_minr_cp01_ex20261028_003921_2475718` (onboarded), `psig.v_au_snacks_115501_m_yoyv2_ex20261028_003921_2475718` (onboarded)

<details><summary>Q7 · 1 row · 315 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q8 · 1 row · 693 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_food_20001_m_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q18 · 1 row · 310 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q19 · 1 row · 369 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_food_prc_hicp_minr_cp01_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q20 · 1 row · 587 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_all_items_10001_m_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q24 · 1 row · 291 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_all_items_prc_hicp_minr_total_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q26 · 84 rows · 3296 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_market_inflation_818677fc_ex20261028_003921_2475718 WHERE period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q36 · 1 row · 393 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q40 · 1 row · 496 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_condiments_97549_m_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q43 · 1 row · 323 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q45 · 1 row · 290 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_condiments_prc_hicp_minr_cp01193_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q50 · 1 row · 391 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_snacks_prc_hicp_minr_cp01_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q51 · 1 row · 600 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_115501_m_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q52 · 126 rows · 2527 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_ex20261028_003921_2475718 p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_condiments_97549_m_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_condiments_prc_hicp_minr_cp01193_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp01_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501_m_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001_m_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_yoyv2_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_food_prc_hicp_minr_cp01_ex20261028_003921_2475718 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('DE', 'CA', 'AU')
ORDER BY p.country, p.sku, s.period
```
</details>