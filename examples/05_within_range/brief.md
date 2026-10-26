# PriceSignal brief
> canada & australia food: is +2% enough this quarter? we pass on 70%

**Proposed 2% increase: within evidence in CA, below in AU**

Policy used: pass through 70% of category inflation (stated in this request) · proposed change: +2%.

| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |
|---|---|---|---|---|---|---|---|---|
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% | easing | +3.1% | 1.5–2.9% | within the evidence |
| AU (Australian Bureau of Statistics (CPI)) | Food and non-alcoholic beverages | 2026-08 | +3.0% | +3.2% | flat | +4.0% | 2.1–2.2% | below the evidence |

Every rate above comes from Zetaris query **Q5** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list`) joined in query **Q11** with the official series of each product's own category in its market (sauces, snacks, food); each SKU's range uses that series, computed in code.

| SKU | Product | Market | Current price | Suggested new price | At +2% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | AU | 8.50 AUD | 8.58–8.59 AUD | 8.67 AUD (above the evidence) | +1.3% 2026-08 · Food additives and condiments |
| HBC-60 | Honey butter chips 60 g | AU | 3.99 AUD | 4.01–4.13 AUD | 4.07 AUD (within the evidence) | +0.6% 2026-08 · Snacks and confectionery |
| KRM-5P | Kimchi ramen 5-pack | AU | 10.50 AUD | 10.72–10.73 AUD | 10.71 AUD (below the evidence) | +3.0% 2026-08 · Food and non-alcoholic beverages |
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.60–7.71 CAD | 7.64 CAD (within the evidence) | +2.2% 2026-09 · Food (coarser) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.85–3.90 CAD | 3.87 CAD (within the evidence) | +2.2% 2026-09 · Food (coarser) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.14–10.28 CAD | 10.19 CAD (within the evidence) | +2.2% 2026-09 · Food |

## By market
### CA — Statistics Canada (CPI)
Canadian food inflation is 2.2% YoY in September 2026, down from a 12-month average of 4.1%. A 70% pass-through supports a suggested range of 1.5% to 2.9%, so the proposed 2% increase falls within the evidence.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q5</sub>

### AU — Australian Bureau of Statistics (CPI)
Australian food inflation is 3.0% YoY in August 2026, with a 12-month average of 3.2%. A 70% pass-through supports a suggested range of 2.1% to 2.2%, so the proposed 2% increase falls below the evidence.
<sub>source: `abs:CPI:1.20001.10.50.M` · monthly · cite Q5</sub>

## Since your last brief (remembered in H-MEM)
- CA Food (last brief 2026-10-26, mem-25): no new official release (still 2026-09, +2.2%); pass-through 60% -> 70%; last time +5% was above the evidence; now +2% is within the evidence.

## Fragmentation the agent found
- CA: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" and "snacks" are compared at the Food level (coarser than the other markets). (remembered from an earlier run)

**Watch:** Re-check October 2026 Canada and September 2026 Australia food CPI to verify if the suggested ranges persist.

## Evidence
Views: `psig.v_au_food_20001` (memory), `psig.v_ca_food_v41690974_live` (memory), `psig.v_ca_all_items_v41690973_live` (memory), `psig.v_au_all_items_10001` (memory), `psig.v_ca_condiments_v41690974_live` (memory), `psig.v_au_condiments_97549` (memory), `psig.v_ca_snacks_v41690974_live` (memory), `psig.v_au_snacks_115501` (memory)

<details><summary>Q1 · 1 rows · 775 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_food_20001 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q2 · 1 rows · 813 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q3 · 1 rows · 417 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q4 · 1 rows · 662 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_all_items_10001 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q5 · 54 rows · 1847 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_all_items_10001 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q7 · 1 rows · 412 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q8 · 1 rows · 444 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_condiments_97549 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q9 · 1 rows · 480 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q10 · 1 rows · 669 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_115501 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q11 · 81 rows · 2399 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_condiments_97549 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('CA', 'AU')
ORDER BY p.country, p.sku, s.period
```
</details>