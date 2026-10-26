# PriceSignal brief
> our gochujang & snacks: is food inflation in deutschland, canada & aus still running hot?? thinking +5% for Q1, too much? we usually pass on ~70% of cost increases

**+5% Q1 increase exceeds food inflation evidence across DE, CA, and AU.**

Policy used: pass through 70% of category inflation (stated in this request) · proposed change: +5%.

| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |
|---|---|---|---|---|---|---|---|---|
| DE (Eurostat (HICP)) | Sugar, confectionery and desserts (ND) | 2026-09 | +1.4% | +6.1% | easing | +3.3% | 1.0–4.3% | above the evidence |
| CA (Statistics Canada (CPI)) | Food | 2026-09 | +2.2% | +4.1% | easing | +3.1% | 1.5–2.9% | above the evidence |
| AU (Australian Bureau of Statistics (CPI)) | Snacks and confectionery | 2026-08 | +0.6% | +4.9% | easing | +4.0% | 0.4–3.4% | above the evidence |

Every rate above comes from Zetaris query **Q19** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.

## Your price list
Internal SKUs (Zetaris view `psig.v_price_list_ex1027`) joined in query **Q39** with the official series of each product's own category in its market (sauces, snacks, food); each SKU's range uses that series, computed in code.

| SKU | Product | Market | Current price | Suggested new price | At +5% | Rate used |
|---|---|---|---|---|---|---|
| GCJ-500 | Gochujang 500 g | AU | 8.50 AUD | 8.58–8.59 AUD (+0.9–1.0%) | 8.93 AUD (above the evidence) | +1.3% 2026-08 · Food additives and condiments |
| HBC-60 | Honey butter chips 60 g | AU | 3.99 AUD | 4.01–4.13 AUD (+0.4–3.4%) | 4.19 AUD (above the evidence) | +0.6% 2026-08 · Snacks and confectionery |
| KRM-5P | Kimchi ramen 5-pack | AU | 10.50 AUD | 10.72–10.73 AUD (+2.1–2.2%) | 11.03 AUD (above the evidence) | +3.0% 2026-08 · Food and non-alcoholic beverages |
| GCJ-500 | Gochujang 500 g | CA | 7.49 CAD | 7.60–7.71 CAD (+1.5–2.9%) | 7.86 CAD (above the evidence) | +2.2% 2026-09 · Food (coarser) |
| HBC-60 | Honey butter chips 60 g | CA | 3.79 CAD | 3.85–3.90 CAD (+1.5–2.9%) | 3.98 CAD (above the evidence) | +2.2% 2026-09 · Food (coarser) |
| KRM-5P | Kimchi ramen 5-pack | CA | 9.99 CAD | 10.14–10.28 CAD (+1.5–2.9%) | 10.49 CAD (above the evidence) | +2.2% 2026-09 · Food |
| GCJ-500 | Gochujang 500 g | DE | 4.99 EUR | 4.99–5.04 EUR (+0.0–1.0%) | 5.24 EUR (above the evidence) | +1.4% 2026-09 · Salt, condiments and sauces (ND) |
| HBC-60 | Honey butter chips 60 g | DE | 2.49 EUR | 2.51–2.60 EUR (+1.0–4.3%) | 2.61 EUR (above the evidence) | +1.4% 2026-09 · Sugar, confectionery and desserts (ND) |
| KRM-5P | Kimchi ramen 5-pack | DE | 6.99 EUR | 7.01–7.06 EUR (+0.3–1.0%) | 7.34 EUR (above the evidence) | +0.4% 2026-09 · Food and non-alcoholic beverages |

## By market
### DE — Eurostat (HICP)
German food inflation for Sugar, confectionery and desserts was 1.4% YoY in September 2026, with a 12-month average of 6.1%. The proposed +5% increase exceeds the evidence range of 1.0% to 4.3%, placing it above the evidence; note the data series switched to its successor.
<sub>source: `eurostat:prc_hicp_minr:CP0118:RCH_A` · monthly · cite Q19</sub>

### CA — Statistics Canada (CPI)
Canadian food inflation was 2.2% YoY in September 2026, down from a 12-month average of 4.1%. The proposed +5% increase falls above the evidence range of 1.5% to 2.9%, so it is above the evidence; note snacks are compared at the Food level, which is coarser than other markets.
<sub>source: `statcan:18100004:v41690974` · monthly · cite Q19</sub>

### AU — Australian Bureau of Statistics (CPI)
Australian food inflation for Snacks and confectionery was 0.6% YoY in August 2026, with a 12-month average of 4.9%. The proposed +5% increase exceeds the evidence range of 0.4% to 3.4%, so it is above the evidence.
<sub>source: `abs:CPI:1.115501.10.50.M` · monthly · cite Q19</sub>

## Fragmentation the agent found
- DE: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- CA: For Canada this agent maps only StatCan's "Food" and "All-items" CPI vectors, so "snacks" and "condiments" are compared at the Food level (coarser than the other markets).

**Watch:** Re-check DE, CA, and AU food CPI prints next month to verify if evidence ranges persist.

## Evidence
Views: `psig.v_au_snacks_115501_ex1027` (onboarded), `psig.v_de_snacks_prc_hicp_minr_cp0118_ex1027` (onboarded), `psig.v_au_all_items_10001_ex1027` (onboarded), `psig.v_ca_snacks_v41690974_live_ex1027` (onboarded), `psig.v_de_all_items_prc_hicp_minr_total_ex1027` (onboarded), `psig.v_ca_all_items_v41690973_live_ex1027` (onboarded), `psig.v_ca_condiments_v41690974_live_ex1027` (onboarded), `psig.v_au_condiments_97549_ex1027` (onboarded), `psig.v_ca_food_v41690974_live_ex1027` (onboarded), `psig.v_au_food_20001_ex1027` (onboarded), `psig.v_de_condiments_prc_hicp_minr_cp01193_ex1027` (onboarded), `psig.v_de_food_prc_hicp_minr_cp01_ex1027` (onboarded)

<details><summary>Q3 · 1 rows · 635 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_snacks_115501_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q8 · 1 rows · 483 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_snacks_prc_hicp_minr_cp0118_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q9 · 1 rows · 642 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_all_items_10001_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q14 · 1 rows · 397 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_snacks_v41690974_live_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q15 · 1 rows · 571 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q18 · 1 rows · 384 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_all_items_v41690973_live_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q19 · 84 rows · 3996 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp0118_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_all_items_10001_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_all_items_v41690973_live_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q26 · 1 rows · 402 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_condiments_v41690974_live_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q27 · 1 rows · 611 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_condiments_97549_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q29 · 1 rows · 422 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_ca_food_v41690974_live_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q34 · 1 rows · 453 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_au_food_20001_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q35 · 1 rows · 533 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_condiments_prc_hicp_minr_cp01193_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q38 · 1 rows · 517 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_de_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q39 · 126 rows · 7838 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_ex1027 p
JOIN (
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_condiments_v41690974_live_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_condiments_97549_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_food_v41690974_live_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_ca_snacks_v41690974_live_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_food_20001_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_au_snacks_115501_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_condiments_prc_hicp_minr_cp01193_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
    UNION ALL
    SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_de_snacks_prc_hicp_minr_cp0118_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN ('DE', 'CA', 'AU')
ORDER BY p.country, p.sku, s.period
```
</details>