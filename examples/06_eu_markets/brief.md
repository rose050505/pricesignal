# PriceSignal brief
> france, italy and spain food prices: can we go +3%? we pass on about 70%

**3% increase above food inflation evidence in FR, IT, and ES.**

Policy used: pass through 70% of category inflation (stated in this request) · proposed change: +3%.

| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |
|---|---|---|---|---|---|---|---|---|
| FR (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.5% | +1.5% | easing | +3.4% | 1.1–1.1% | above the evidence |
| IT (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +1.7% | +2.1% | easing | +4.2% | 1.2–1.5% | above the evidence |
| ES (Eurostat (HICP)) | Food and non-alcoholic beverages | 2026-09 | +2.7% | +2.5% | flat | +5.0% | 1.8–1.9% | above the evidence |

Every rate above comes from Zetaris query **Q19** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.

## By market
### FR — Eurostat (HICP)
French food inflation latest 1.5% YoY with 12-month average 1.5%. With 70% pass-through supporting 1.1% to 1.1%, the proposed 3% rise is above the evidence. Note: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q19</sub>

### IT — Eurostat (HICP)
Italian food inflation latest 1.7% YoY with 12-month average 2.1%. With 70% pass-through supporting 1.2% to 1.5%, the proposed 3% rise is above the evidence. Note: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q19</sub>

### ES — Eurostat (HICP)
Spanish food inflation latest 2.7% YoY with 12-month average 2.5%. With 70% pass-through supporting 1.8% to 1.9%, the proposed 3% rise is above the evidence. Note: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
<sub>source: `eurostat:prc_hicp_minr:CP01:RCH_A` · monthly · cite Q19</sub>

## Fragmentation the agent found
- FR: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- IT: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.
- ES: Eurostat prc_hicp_manr looks discontinued (no data after 2025-12 (10 months ago); last period 2025-12); switched to its successor prc_hicp_minr.

**Watch:** Re-check October 2026 food CPI prints for FR, IT, and ES to see if the evidence ranges shift.

## Evidence
Views: `psig.v_fr_food_prc_hicp_minr_cp01_ex1027` (onboarded), `psig.v_fr_all_items_prc_hicp_minr_total_ex1027` (onboarded), `psig.v_it_food_prc_hicp_minr_cp01_ex1027` (onboarded), `psig.v_it_all_items_prc_hicp_minr_total_ex1027` (onboarded), `psig.v_es_food_prc_hicp_minr_cp01_ex1027` (onboarded), `psig.v_es_all_items_prc_hicp_minr_total_ex1027` (onboarded)

<details><summary>Q3 · 1 rows · 693 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q6 · 1 rows · 633 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_fr_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q9 · 1 rows · 597 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q12 · 1 rows · 591 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_it_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q15 · 1 rows · 559 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q18 · 1 rows · 623 ms</summary>

```sql
SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.v_es_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL
```
</details>
<details><summary>Q19 · 90 rows · 3001 ms</summary>

```sql
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_fr_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_fr_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_it_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_it_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_es_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
UNION ALL
SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.v_es_all_items_prc_hicp_minr_total_ex1027 WHERE yoy_pct IS NOT NULL AND period >= '2025-07'
ORDER BY country, concept, period
```
</details>
<details><summary>Q21 · 0 rows · 1761 ms</summary>

```sql
SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.period, s.yoy_pct, s.source_id
FROM psig.v_price_list_ex1027 p
JOIN (
  SELECT country, period, yoy_pct, source_id, ROW_NUMBER() OVER (PARTITION BY country ORDER BY period DESC) AS rn
  FROM (
    SELECT country, period, yoy_pct, source_id FROM psig.v_fr_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL
    UNION ALL
    SELECT country, period, yoy_pct, source_id FROM psig.v_it_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL
    UNION ALL
    SELECT country, period, yoy_pct, source_id FROM psig.v_es_food_prc_hicp_minr_cp01_ex1027 WHERE yoy_pct IS NOT NULL
  ) u
) s ON p.country = s.country AND s.rn = 1
WHERE p.country IN ('FR', 'IT', 'ES')
ORDER BY p.country, p.sku
```
</details>