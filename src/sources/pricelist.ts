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
