# PriceSignal brief
> france, italy and spain food prices: can we go +3%? we pass on about 70%

**3% rise above food inflation evidence in FR, IT, and ES.**

Policy used: pass through 70% of category inflation (stated in this request) · proposed change: +3%.

| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |
|---|---|---|---|---|---|---|---|---|
| FR (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.5% | +1.5% | easing | +3.4% | 1.1–1.1% | above the evidence |
| IT (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.7% | +2.1% | easing | +4.2% | 1.2–1.5% | above the evidence |
| ES (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +2.7% | +2.5% | flat | +5.0% | 1.8–1.9% | above the evidence |

Every rate above comes from Zetaris query **Q7** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.

## By market
### FR — Eurostat (HICP)
French food inflation is 1.5% YoY in September 2026, with a 12-month average of 1.5%; 70% pass-through supports 1.1% to 1.1%, so the proposed 3% rise is above the evidence. Note: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q7</sub>

### IT — Eurostat (HICP)
Italian food inflation is 1.7% YoY in September 2026, with a 12-month average of 2.1%; 70% pass-through supports 1.2% to 1.5%, so the proposed 3% rise is above the evidence. Note: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q7</sub>

### ES — Eurostat (HICP)
Spanish food inflation is 2.7% YoY in September 2026, with a 12-month average of 2.5%; 70% pass-through supports 1.8% to 1.9%, so the proposed 3% rise is above the evidence. Note: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q7</sub>

## Fragmentation the agent found
- FR: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- IT: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- ES: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.

**Watch:** Re-check October 2026 food CPI prints for FR, IT, and ES to verify if evidence ranges shift.

## Evidence
Views: `psig.v_fr_food_prc_hicp_minr_cp01` (onboarded), `psig.v_fr_all_items_prc_hicp_minr_total` (onboarded), `psig.v_it_food_prc_hicp_minr_cp01` (onboarded), `psig.v_it_all_items_prc_hicp_minr_total` (onboarded), `psig.v_es_food_prc_hicp_minr_cp01` (onboarded), `psig.v_es_all_items_prc_hicp_minr_total` (onboarded)

<details><summary>Q1 · 1 rows · 1260 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q2 · 1 rows · 568 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q3 · 1 rows · 546 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q4 · 1 rows · 571 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q5 · 1 rows · 556 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 588 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q7 · 90 rows · 2860 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_fr_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_fr_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_it_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_it_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_es_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_es_all_items_prc_hicp_minr_total WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q9 · 0 rows · 1624 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list p
JOIN (
  SELECT country, period, yoy_pct, source_id, ROW_NUMBER() OVER (PARTITION BY country ORDER BY period DESC) AS rn
  FROM (
    SELECT country, period, yoy_pct, source_id FROM psig.v_fr_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL
    UNION ALL
    SELECT country, period, yoy_pct, source_id FROM psig.v_it_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL
    UNION ALL
    SELECT country, period, yoy_pct, source_id FROM psig.v_es_food_prc_hicp_minr_cp01 WHERE yoy_pct IS NOT NULL
  ) u
) s ON p.country = s.country AND s.rn = 1
WHERE p.country IN ('FR', 'IT', 'ES')
ORDER BY p.country, p.sku
```
</details>