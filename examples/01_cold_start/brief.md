# PriceSignal brief
> our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1, too much? we usually pass on ~70% of cost increases

**+5% Q1 increase exceeds food inflation evidence across DE, CA, and AU.**

Policy used: pass through 70% of category inflation (stated in this request) · proposed change: +5%.

| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |
|---|---|---|---|---|---|---|---|---|
| DE (Eurostat (HICP)) | Sugar, confectionery and desserts (ND) | 2026-09 | +1.4% | +6.1% | easing | +3.3% | 1.0–4.3% | above the evidence |
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% | easing | +3.1% | 1.5–2.9% | above the evidence |
| AU (Australian Bureau of Statistics (CPI)) | Snacks and confectionery | 2026-08 | +0.6% | +4.9% | easing | +4.0% | 0.4–3.4% | above the evidence |

Every rate above comes from Zetaris query **Q7** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list`) joined in query **Q15** with the official series of each product's own category in its market (sauces, snacks, food); each SKU's range uses that series, computed in code.

| SKU | Product | Market | Current price | Suggested new price | At +5% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | AU | 8.50 AUD | 8.58–8.59 AUD | 8.93 AUD (above the evidence) | +1.3% 2026-08 · Food additives and condiments |
| HBC-60 | Honey butter chips 60 g | AU | 3.99 AUD | 4.01–4.13 AUD | 4.19 AUD (above the evidence) | +0.6% 2026-08 · Snacks and confectionery |
| KRM-5P | Kimchi ramen 5-pack | AU | 10.50 AUD | 10.72–10.73 AUD | 11.03 AUD (above the evidence) | +3.0% 2026-08 · Food and non-alcoholic beverages |
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.60–7.71 CAD | 7.86 CAD (above the evidence) | +2.2% 2026-09 · Food (coarser) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.85–3.90 CAD | 3.98 CAD (above the evidence) | +2.2% 2026-09 · Food (coarser) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.14–10.28 CAD | 10.49 CAD (above the evidence) | +2.2% 2026-09 · Food |
| GCJ-500 | Gochujang 500 g | DE | 4.99 EUR | 4.99–5.04 EUR | 5.24 EUR (above the evidence) | +1.4% 2026-09 · Salt, condiments and sauces (ND) |
| HBC-60 | Honey butter chips 60 g | DE | 2.49 EUR | 2.51–2.60 EUR | 2.61 EUR (above the evidence) | +1.4% 2026-09 · Sugar, confectionery and desserts (ND) |
| KRM-5P | Kimchi ramen 5-pack | DE | 6.99 EUR | 7.01–7.06 EUR | 7.34 EUR (above the evidence) | +0.4% 2026-09 · Food and non-alcoholic beverages |

## By market
### DE — Eurostat (HICP)
German food inflation (Sugar, confectionery and desserts) was 1.4% YoY in September 2026, with a 12-month average of 6.1%. The proposed +5% increase falls above the evidence range of 1.0% to 4.3%, given the all-items 3.3% YoY and 2.6% average. Note: the data series switched to its successor.
<sub>source: `eurostat:prc_hicp_minr:CP0118:RCH_A` · monthly · cite Q7</sub>

### CA — Statistics Canada (CPI)
Canadian food inflation was 2.2% YoY in September 2026, down from a 12-month average of 4.1%. The proposed +5% increase falls above the evidence range of 1.5% to 2.9%, with all-items YoY at 3.1% and average 2.6%. Note: snacks are compared at the Food level, which is coarser than other markets.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q7</sub>

### AU — Australian Bureau of Statistics (CPI)
Australian food inflation (Snacks and confectionery) was 0.6% YoY in August 2026, with a 12-month average of 4.9%. The proposed +5% increase falls above the evidence range of 0.4% to 3.4%, given all-items YoY of 4% and average 3.8%.
<sub>source: `abs:CPI:1.115501.10.50.M` · monthly · cite Q7</sub>

## Fragmentation the agent found
- CA: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" and "condiments" are compared at the Food level (coarser than the other markets).
- DE: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.

**Watch:** Re-check DE, CA, and AU food CPI prints next month to verify if evidence ranges persist.

## Evidence
Views: `psig.v_au_snacks_115501` (onboarded), `psig.v_au_all_items_10001` (onboarded), `psig.v_ca_snacks_v41690974_live` (onboarded), `psig.v_de_snacks_prc_hicp_minr_cp0118` (onboarded), `psig.v_ca_all_items_v41690973_live` (onboarded), `psig.v_de_all_items_prc_hicp_minr_total` (onboarded), `psig.v_au_condiments_97549` (onboarded), `psig.v_ca_condiments_v41690974_live` (onboarded), `psig.v_au_food_20001` (onboarded), `psig.v_ca_food_v41690974_live` (onboarded), `psig.v_de_condiments_prc_hicp_minr_cp01193` (onboarded), `psig.v_de_food_prc_hicp_minr_cp01` (onboarded)

<details><summary>Q1 · 1 rows · 584 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_115501 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q2 · 1 rows · 645 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_all_items_10001 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q3 · 1 rows · 1418 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q4 · 1 rows · 1100 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_snacks_prc_hicp_minr_cp0118 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q5 · 1 rows · 731 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 519 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q7 · 84 rows · 4293 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_all_items_10001 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp0118 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q9 · 1 rows · 726 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_condiments_97549 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q10 · 1 rows · 435 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q11 · 1 rows · 423 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_food_20001 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q12 · 1 rows · 454 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q13 · 1 rows · 514 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_condiments_prc_hicp_minr_cp01193 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q14 · 1 rows · 579 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q15 · 126 rows · 6696 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_condiments_97549 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_condiments_prc_hicp_minr_cp01193 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp0118 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('DE', 'CA', 'AU')
ORDER BY p.country, p.sku, s.period
```
</details>