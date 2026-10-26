# PriceSignal brief
> japan + canada food prices, ok to raise 5%?

**Canada food inflation eases to 2.2% YoY; 5% raise exceeds 60% pass-through evidence range.**

Policy used: pass through 60% of category inflation (remembered from an earlier request (mem-22)) · proposed change: +5%.

| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |
|---|---|---|---|---|---|---|---|---|
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% | easing | +3.1% | 1.3–2.5% | above the evidence |

Every rate above comes from Zetaris query **Q3** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list`) joined in query **Q7** with the official series of each product's own category in its market (sauces, snacks, food); each SKU's range uses that series, computed in code.

| SKU | Product | Market | Current price | Suggested new price | At +5% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.59–7.68 CAD | 7.86 CAD (above the evidence) | +2.2% 2026-09 · Food (coarser) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.84–3.88 CAD | 3.98 CAD (above the evidence) | +2.2% 2026-09 · Food (coarser) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.12–10.24 CAD | 10.49 CAD (above the evidence) | +2.2% 2026-09 · Food |

## By market
### CA — Statistics Canada (CPI)
Canadian food inflation eased to 2.2% YoY in September 2026, down from a 12-month average of 4.1% with a clear downward trend. A 60% pass-through of this food price pressure supports a 1.3% to 2.5% increase, so the proposed 5% rise exceeds the evidence.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q3</sub>

## Fragmentation the agent found
- japan: not covered yet - PriceSignal currently reads Eurostat (EU markets), Statistics Canada (CA) and ABS (AU).
- CA: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "condiments" and "snacks" are compared at the Food level (coarser than the other markets). (remembered from an earlier run)

**Watch:** Re-check October 2026 CPI to confirm if the recent food inflation easing persists and all-items trends stabilize.

## Evidence
Views: `psig.v_ca_food_v41690974_live` (memory), `psig.v_ca_all_items_v41690973_live` (memory), `psig.v_ca_condiments_v41690974_live` (memory), `psig.v_ca_snacks_v41690974_live` (memory)

<details><summary>Q1 · 1 rows · 1145 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q2 · 1 rows · 475 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q3 · 28 rows · 847 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q5 · 1 rows · 342 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 434 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q7 · 42 rows · 1378 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('CA')
ORDER BY p.country, p.sku, s.period
```
</details>