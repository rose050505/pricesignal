# PriceSignal brief
> our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? costs rose 8%; unit costs are 60% of our selling price; thinking +5% for Q1; we usually pass on ~70% of cost increases

**+5% is within the market benchmark in DE; above the market benchmark in CA and AU.**

Cost policy: recover 70% of incremental unit cost (stated in this request) · proposed change: +5%. This policy does not scale the market benchmark.

Your unit costs: +8% (stated in this request). Current unit cost is 60% of current selling price; recovering 70% of the incremental cost gives a +3.4% selling-price scenario.

The historical market benchmark spans the latest YoY rate and the mean of available observations in the year ending at the latest observation. It is not a forecast, a confidence interval or evidence that customers will accept a price change. A single value is a reference point, not a recommended price.

| Market | Official category | Latest period | YoY | Available-year average | Trend vs. 6 months ago | All-items YoY | Market benchmark | Proposed change |
|---|---|---|---|---|---|---|---|---|
| DE (Eurostat (HICP)) | Sugar, confectionery and desserts (ND) | 2026-09 | +1.4% | +6.1% (12 of 12 monthly observations) | easing | +3.3% | 1.4–6.1% | within the market benchmark |
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% (12 of 12 monthly observations) | easing | +3.1% | 2.2–4.1% | above the market benchmark |
| AU (Australian Bureau of Statistics (CPI)) | Snacks and confectionery | 2026-08 | +0.6% | +4.9% (12 of 12 monthly observations) | easing | +4.0% | 0.6–4.9% | above the market benchmark |

Every rate above comes from Zetaris query **Q19** (one federated SQL over the onboarded sources); market benchmarks and comparisons are computed in code from those rates.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list_night1027c7`) joined in query **Q42** with official category series for the products in each market; broader proxies are marked. Each SKU's benchmark price scenario applies its selected series' historical rates to its current price, computed in code.

| SKU | Product | Market | Current price | Benchmark price scenario | At +5% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | AU | 8.50 AUD | 8.76–8.77 AUD (+3.0–3.2%) | 8.93 AUD (above the market benchmark) | +3.0% 2026-08 · Food and non-alcoholic beverages (broader proxy; unconfirmed match) |
| HBC-60 | Honey butter chips 60 g | AU | 3.99 AUD | 4.11–4.12 AUD (+3.0–3.2%) | 4.19 AUD (above the market benchmark) | +3.0% 2026-08 · Food and non-alcoholic beverages (broader proxy; unconfirmed match) |
| KRM-5P | Kimchi ramen 5-pack | AU | 10.50 AUD | 10.82–10.84 AUD (+3.0–3.2%) | 11.03 AUD (above the market benchmark) | +3.0% 2026-08 · Food and non-alcoholic beverages |
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.65–7.80 CAD (+2.2–4.1%) | 7.86 CAD (above the market benchmark) | +2.2% 2026-09 · Food (broader proxy; unconfirmed match) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.87–3.95 CAD (+2.2–4.1%) | 3.98 CAD (above the market benchmark) | +2.2% 2026-09 · Food (broader proxy; unconfirmed match) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.21–10.40 CAD (+2.2–4.1%) | 10.49 CAD (above the market benchmark) | +2.2% 2026-09 · Food |
| GCJ-500 | Gochujang 500 g | DE | 4.99 EUR | 5.01–5.06 EUR (+0.4–1.4%) | 5.24 EUR (above the market benchmark) | +0.4% 2026-09 · Food and non-alcoholic beverages (broader proxy; unconfirmed match) |
| HBC-60 | Honey butter chips 60 g | DE | 2.49 EUR | 2.50–2.52 EUR (+0.4–1.4%) | 2.61 EUR (above the market benchmark) | +0.4% 2026-09 · Food and non-alcoholic beverages (broader proxy; unconfirmed match) |
| KRM-5P | Kimchi ramen 5-pack | DE | 6.99 EUR | 7.02–7.09 EUR (+0.4–1.4%) | 7.34 EUR (above the market benchmark) | +0.4% 2026-09 · Food and non-alcoholic beverages |

## By market
### DE — Eurostat (HICP)
Sugar, confectionery and desserts (ND): +1.4% year on year in 2026-09 (easing vs. six months ago; average +6.1%, 12 of 12 monthly observations). Historical market benchmark 1.4–6.1%.
<sub>source: `eurostat:prc_hicp_minr:CP0118:RCH_A` · monthly · cite Q19</sub>

### CA — Statistics Canada (CPI)
Food: +2.2% year on year in 2026-09 (easing vs. six months ago; average +4.1%, 12 of 12 monthly observations). Historical market benchmark 2.2–4.1%.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q19</sub>

### AU — Australian Bureau of Statistics (CPI)
Snacks and confectionery: +0.6% year on year in 2026-08 (easing vs. six months ago; average +4.9%, 12 of 12 monthly observations). Historical market benchmark 0.6–4.9%.
<sub>source: `abs:CPI:1.115501.10.50.M` · monthly · cite Q19</sub>

## Costs vs. the market
Compare the cost-recovery price scenario with the historical movement of consumer prices. Neither establishes demand, competitor responses or a profit-maximizing price.

- DE: the +3.4% cost-recovery price scenario is within the market benchmark (Sugar, confectionery and desserts (ND): 1.4–6.1%).
- CA: the +3.4% cost-recovery price scenario is within the market benchmark (Food: 2.2–4.1%).
- AU: the +3.4% cost-recovery price scenario is within the market benchmark (Snacks and confectionery: 0.6–4.9%).

## Fragmentation the agent found
- CA: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" is compared at the Food level (coarser than the other markets).
- DE: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- CA: Food is used as a broader category proxy (coarser) for snacks.
- CA condiments: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.
- DE condiments: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr. Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.
- CA snacks: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" is compared at the Food level (coarser than the other markets). Food is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.
- AU condiments: Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.
- AU snacks: Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.
- DE snacks: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr. Food and non-alcoholic beverages is used as a broader category proxy (coarser) for these products; a product-specific selection was unavailable or unusable.

## Evidence
Views: `psig.v_ca_snacks_v41690974_live_night1027c7` (onboarded), `psig.v_au_snacks_115501_night1027c7` (onboarded), `psig.v_de_snacks_prc_hicp_minr_cp0118_night1027c7` (onboarded), `psig.v_au_all_items_10001_night1027c7` (onboarded), `psig.v_ca_all_items_v41690973_live_night1027c7` (onboarded), `psig.v_de_all_items_prc_hicp_minr_total_night1027c7` (onboarded), `psig.v_ca_condiments_v41690974_live_night1027c7` (onboarded), `psig.v_de_condiments_prc_hicp_minr_cp01_night1027c7` (onboarded), `psig.v_ca_snacks_v41690974_live_night1027c7` (onboarded), `psig.v_au_condiments_20001_night1027c7` (onboarded), `psig.v_au_snacks_20001_night1027c7` (onboarded), `psig.v_de_snacks_prc_hicp_minr_cp01_night1027c7` (onboarded), `psig.v_au_food_20001_night1027c7` (onboarded), `psig.v_ca_food_v41690974_live_night1027c7` (onboarded), `psig.v_de_food_prc_hicp_minr_cp01_night1027c7` (onboarded)

<details><summary>Q5 · 1 rows · 426 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 588 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_115501_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q11 · 1 rows · 547 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_snacks_prc_hicp_minr_cp0118_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q14 · 1 rows · 572 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_all_items_10001_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q15 · 1 rows · 376 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q18 · 1 rows · 476 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_all_items_prc_hicp_minr_total_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q19 · 84 rows · 4218 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp0118_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_all_items_10001_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_all_items_prc_hicp_minr_total_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q28 · 1 rows · 959 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q29 · 1 rows · 488 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_condiments_prc_hicp_minr_cp01_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q30 · 1 rows · 394 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q32 · 1 rows · 594 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_condiments_20001_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q34 · 1 rows · 462 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_20001_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q35 · 1 rows · 529 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_snacks_prc_hicp_minr_cp01_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q37 · 1 rows · 486 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_food_20001_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q39 · 1 rows · 393 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q41 · 1 rows · 660 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_food_prc_hicp_minr_cp01_night1027c7 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q42 · 126 rows · 5995 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_night1027c7 p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_condiments_prc_hicp_minr_cp01_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_condiments_20001_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_20001_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp01_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_food_prc_hicp_minr_cp01_night1027c7 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('DE', 'CA', 'AU')
ORDER BY p.country, p.sku, s.period
```
</details>

_Narrative omitted: the model provider returned an error or timed out, so only computed facts are shown._