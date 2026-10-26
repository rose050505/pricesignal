// The company's own data: an internal price list (SKU, market, current shelf price).
// In production this is the exporter's ERP or pricing sheet behind an HTTP endpoint;
// the repo ships a small sample (data/price_list.json) served from GitHub.
// Zetaris reads it as a REST table, and one federated query joins it with the
// agency inflation views, so internal and external data meet in the same SQL.
import { SqlRunner, runDdl } from "../zetaris.ts";

export const PRICE_DB = "PSIG_INTERNAL";
export const PRICE_TABLE = "internal_price_list";
export const PRICE_VIEW = "v_price_list";
export const PRICING_COLUMNS = ["sku", "product", "country", "sku_category", "currency", "current_price", "period", "yoy_pct", "source_id"];
export const SKU_RATE_COLUMNS = ["sku", "product", "country", "sku_category", "currency", "current_price", "rate_concept", "category_label", "frequency", "period", "yoy_pct", "source_id"];

/** Which product categories the company sells in each market (read from the internal price list in Zetaris). */
export function skuCategoriesSql(countries: string[]): string {
  return `SELECT DISTINCT country, sku_category FROM psig.${PRICE_VIEW} WHERE country IN (${countries.map((c) => `'${c}'`).join(", ")}) ORDER BY country, sku_category`;
}

/**
 * One federated join: every SKU with the official series of ITS OWN category in its market
 * (gochujang -> condiments, chips -> snacks, ramen -> food), last ~15 periods.
 * The latest rate, 12-period average and suggested price range are then computed in code,
 * exactly like the market facts.
 */
export function skuRatesSql(views: string[], countries: string[], sincePeriod: string): string {
  const series = views
    .map((v) => `SELECT country, concept, category_label, frequency, period, yoy_pct, source_id FROM psig.${v} WHERE yoy_pct IS NOT NULL AND period >= '${sincePeriod}'`)
    .join("\n    UNION ALL\n    ");
  return `SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.concept AS rate_concept, s.category_label, s.frequency, s.period, s.yoy_pct, s.source_id
FROM psig.${PRICE_VIEW} p
JOIN (
    ${series}
) s ON p.country = s.country AND p.sku_category = s.concept
WHERE p.country IN (${countries.map((c) => `'${c}'`).join(", ")})
ORDER BY p.country, p.sku, s.period`;
}

export function priceListUrl(): string {
  return process.env.PSIG_PRICE_LIST_URL || "https://raw.githubusercontent.com/rose050505/pricesignal/main/data/price_list.json";
}

export function priceListStatements(url = priceListUrl()): string[] {
  return [
    `CREATE LIGHTNING DATABASE ${PRICE_DB} DESCRIBE BY "PriceSignal-internal-price-list"`,
    `CREATE LIGHTNING REST TABLE ${PRICE_TABLE} FROM ${PRICE_DB} REQUEST(
    endpoint "${url}",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
) BODY ()`,
    `CREATE SCHEMASTORE VIEW ${PRICE_VIEW} WITH CONTAINER psig AS
SELECT sku, product, market AS country, category AS sku_category, currency, CAST(current_price AS DOUBLE) AS current_price
FROM ${PRICE_DB.toLowerCase()}.${PRICE_TABLE}`,
  ];
}

let ready = false;
export async function ensurePriceList(z: SqlRunner): Promise<{ ok: boolean; created: boolean; error?: string }> {
  if (ready) return { ok: true, created: false };
  let created = false;
  for (const s of priceListStatements()) {
    const r = await runDdl(z, s);
    if (!r.ok) return { ok: false, created, error: r.error };
    created = created || !r.existed;
  }
  ready = true;
  return { ok: true, created };
}

/** One federated query: internal SKUs joined with the latest official rate of the requested category per market. */
export function pricingSql(categoryViews: string[], countries: string[]): string {
  const series = categoryViews
    .map((v) => `SELECT country, period, yoy_pct, source_id FROM psig.${v} WHERE yoy_pct IS NOT NULL`)
    .join("\n    UNION ALL\n    ");
  return `SELECT p.sku, p.product, p.country, p.sku_category, p.currency, p.current_price, s.period, s.yoy_pct, s.source_id
FROM psig.${PRICE_VIEW} p
JOIN (
  SELECT country, period, yoy_pct, source_id, ROW_NUMBER() OVER (PARTITION BY country ORDER BY period DESC) AS rn
  FROM (
    ${series}
  ) u
) s ON p.country = s.country AND s.rn = 1
WHERE p.country IN (${countries.map((c) => `'${c}'`).join(", ")})
ORDER BY p.country, p.sku`;
}
