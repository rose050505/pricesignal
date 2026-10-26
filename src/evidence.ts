import type { Request } from "./agent.ts";
import { buildFacts, buildFactsLegacyV2, marketBenchmark, seriesFacts, type Brief, type MarketFacts, type SkuLine } from "./brief.ts";
import { buildAlignment, type PeriodAlignment } from "./alignment.ts";
import { COMPARE_COLUMNS } from "./sources/index.ts";
import { SUPPORTED_COUNTRIES, type Country } from "./sources/types.ts";
import { PRICING_COLUMNS, SKU_RATE_COLUMNS } from "./sources/pricelist.ts";
import type { SqlResult } from "./zetaris.ts";

export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_METHOD_VERSION = 3;
export type PricingEvidenceMode = "sku-history" | "legacy-pricing";
export interface EvidenceQuery {
  id: string;
  sql: string;
  /** The metadata actually returned by the SQL runner, including generic c0... names. */
  columns: string[];
  /** SELECT-list names only when the runner returned generic or empty metadata. */
  effectiveColumns: string[];
  rows: unknown[][];
}
export interface EvidencePacket {
  schemaVersion: 1;
  methodVersion: 2 | 3;
  calculatedAt: string;
  startedAt?: string;
  request: Request;
  passThrough: number;
  queries: { market: EvidenceQuery; pricing?: EvidenceQuery & { mode: PricingEvidenceMode } };
  results: { facts: MarketFacts[]; alignment?: PeriodAlignment; skus: SkuLine[] };
}
export interface EvidenceVerification {
  ok: boolean;
  checks: number;
  errors: string[];
  warnings: string[];
  coverage: {
    requestedMarkets: number;
    verifiedMarkets: Country[];
    unavailableMarkets: Country[];
    unsupportedMarkets: string[];
    verifiedSkus: number;
    pricingMode: PricingEvidenceMode | "none";
    rawMarketRows: number;
    rawPricingRows: number;
  };
  limitations: string[];
}

const LIMITATIONS = [
  "Verification checks arithmetic consistency with the SQL result rows included in this file. It does not authenticate the file, its source, or the original database response.",
  "Original index-to-YoY decoding and completeness of upstream agency data are not replayed; the recorded SQL result contains decoded YoY observations.",
  "Product-series selection, broader-proxy suitability, selection metadata, memory history and the full semantics of model-written prose are not verified.",
  "Unavailable markets and absent pricing evidence remain outside the verified scope. A successful check is not a claim that every requested market or every catalog SKU was covered.",
];
const REQUEST_KEYS = ["raw", "countries", "concept", "conceptWords", "proposedChangePct", "costIncreasePct", "costRemembered", "costSharePct", "costShareBasis", "costShareRemembered", "passThrough", "invalidPassThrough", "inputIssues", "policyStatement", "unknownCountries", "defaultMarkets"];
const SERIES_KEYS = ["concept", "label", "frequency", "sourceId", "latestPeriod", "latestYoy", "avg12", "averageCount", "averageExpected", "averageLabel", "yoy6Back", "trend", "points"];
const FACT_KEYS = ["country", "agency", "category", "allItems", "monthsStale", "suggested", "verdict", "costNeed", "passThroughNeeded", "costVsMarket", "cite"];
const SKU_CALCULATED_KEYS = ["sku", "product", "country", "skuCategory", "currency", "currentPrice", "period", "yoy", "sourceId", "low", "high", "atProposed", "verdict", "cite", "rateLabel", "avg12", "rangeLow", "rangeHigh"];
const SKU_KEYS = [...SKU_CALCULATED_KEYS, "coarser", "selectionReason", "selectionSource", "selectionFit"];
const ALIGNMENT_KEYS = ["status", "concept", "requestedCountries", "period", "frequency", "monthsOld", "rows", "cite", "note", "reason"];
const ALIGNMENT_ROW_KEYS = ["country", "label", "sourceId", "yoy", "latestPeriod", "latestYoy"];
type Obj = Record<string, any>;

function pick(value: Obj, keys: string[]): Obj {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function object(value: unknown, at: string): asserts value is Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${at}: expected an object`);
}
function shape(value: unknown, at: string, required: string[], optional: string[] = []): asserts value is Obj {
  object(value, at);
  for (const key of required) if (!(key in value)) throw new Error(`${at}.${key}: missing field`);
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) throw new Error(`${at}.${key}: unknown field`);
}
function jsonCopy<T>(value: T): T {
  const seen = new Set<object>();
  const visit = (item: unknown, at: string) => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object") throw new Error(`${at}: not a finite JSON value`);
    if (seen.has(item)) throw new Error(`${at}: cyclic data`);
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error(`${at}: expected plain JSON data`);
    seen.add(item);
    for (const [key, child] of Object.entries(item)) visit(child, `${at}.${key}`);
    seen.delete(item);
  };
  visit(value, "evidence");
  return JSON.parse(JSON.stringify(value));
}
function isoDate(value: unknown, at: string): Date {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${at}: expected a canonical UTC ISO calculation timestamp`);
  return new Date(value);
}
function finite(value: unknown, at: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${at}: expected a finite number`);
}
function text(value: unknown, at: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${at}: expected a non-empty string`);
}
function stringArray(value: unknown, at: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== "string")) throw new Error(`${at}: expected a string array`);
}
function effectiveColumns(columns: string[], expected: string[]): string[] {
  return !columns.length || columns.every((column, i) => column === `c${i}`) ? [...expected] : columns.map(column => column.toLowerCase());
}
function snapshotQuery(query: SqlResult, expected: string[]): EvidenceQuery {
  return { id: query.id, sql: query.sql, columns: [...query.columns], effectiveColumns: effectiveColumns(query.columns, expected), rows: query.rows };
}
function pricingMode(query: SqlResult): PricingEvidenceMode {
  if (query.columns.some(c => c.toLowerCase() === "rate_concept") || query.columns.length === SKU_RATE_COLUMNS.length || (!query.columns.length && (query.rows[0]?.length === SKU_RATE_COLUMNS.length || /\bAS\s+rate_concept\b/i.test(query.sql)))) return "sku-history";
  return "legacy-pricing";
}
function snapshotFact(fact: MarketFacts): MarketFacts {
  const copy = pick(fact, FACT_KEYS);
  for (const key of ["category", "allItems"]) if (copy[key]) copy[key] = { ...pick(copy[key], SERIES_KEYS), points: copy[key].points.map((p: Obj) => pick(p, ["period", "yoy"])) };
  if (copy.suggested) copy.suggested = pick(copy.suggested, ["low", "high", "basis"]);
  return copy as MarketFacts;
}
function snapshotAlignment(alignment: PeriodAlignment): PeriodAlignment {
  const copy = pick(alignment, ALIGNMENT_KEYS);
  if (copy.rows) copy.rows = copy.rows.map((r: Obj) => pick(r, ALIGNMENT_ROW_KEYS));
  return copy as PeriodAlignment;
}

/** Capture only this run's inputs, calculation outputs and the two evidence queries. */
export function exportEvidence(brief: Brief): EvidencePacket {
  const calculatedAt = (brief as Brief & { calculatedAt?: string }).calculatedAt;
  isoDate(calculatedAt, "calculatedAt");
  const queries: EvidencePacket["queries"] = { market: snapshotQuery(brief.compared, COMPARE_COLUMNS) };
  if (brief.pricingQuery) {
    const mode = pricingMode(brief.pricingQuery);
    queries.pricing = { ...snapshotQuery(brief.pricingQuery, mode === "sku-history" ? SKU_RATE_COLUMNS : PRICING_COLUMNS), mode };
  }
  const packet: EvidencePacket = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION, methodVersion: EVIDENCE_METHOD_VERSION,
    calculatedAt: calculatedAt!, ...(brief.startedAt === undefined ? {} : { startedAt: brief.startedAt }),
    request: pick(brief.request, REQUEST_KEYS) as Request, passThrough: brief.passThrough, queries,
    results: { facts: brief.facts.map(snapshotFact), ...(brief.alignment ? { alignment: snapshotAlignment(brief.alignment) } : {}), skus: (brief.skus ?? []).map(s => pick(s, SKU_KEYS) as SkuLine) },
  };
  return jsonCopy(packet);
}

function validateRequest(value: unknown): Request {
  shape(value, "request", ["raw", "countries", "concept", "conceptWords", "unknownCountries"], REQUEST_KEYS);
  if (typeof value.raw !== "string") throw new Error("request.raw: expected a string");
  text(value.concept, "request.concept");
  for (const key of ["countries", "conceptWords", "unknownCountries", "inputIssues"]) if (value[key] !== undefined) stringArray(value[key], `request.${key}`);
  for (const [i, country] of value.unknownCountries.entries()) text(country, `request.unknownCountries[${i}]`);
  if (new Set(value.countries).size !== value.countries.length || value.countries.some((c: Country) => !SUPPORTED_COUNTRIES.includes(c))) throw new Error("request.countries: expected distinct supported country codes");
  for (const key of ["proposedChangePct", "costIncreasePct", "costSharePct", "passThrough"]) if (value[key] !== undefined) finite(value[key], `request.${key}`);
  for (const key of ["proposedChangePct", "costIncreasePct"]) if (value[key] !== undefined && value[key] < -100) throw new Error(`request.${key}: decrease below -100% is invalid`);
  if (value.costSharePct !== undefined && (value.costSharePct < 0 || value.costSharePct > 100)) throw new Error("request.costSharePct: outside 0..100");
  if (value.costShareBasis !== undefined && !["before_change", "after_change"].includes(value.costShareBasis)) throw new Error("request.costShareBasis: expected before_change or after_change");
  if (value.passThrough !== undefined && (value.passThrough < 0 || value.passThrough > 1)) throw new Error("request.passThrough: outside 0..1");
  for (const key of ["costRemembered", "costShareRemembered", "invalidPassThrough", "defaultMarkets"]) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`request.${key}: expected a boolean`);
  if (value.policyStatement !== undefined && typeof value.policyStatement !== "string") throw new Error("request.policyStatement: expected a string");
  return value as Request;
}
function readQuery(value: unknown, expected: string[], at: string, allowEmpty = false, mode?: PricingEvidenceMode): Record<string, unknown>[] {
  shape(value, at, ["id", "sql", "columns", "effectiveColumns", "rows"], mode ? ["mode"] : []);
  text(value.id, `${at}.id`);
  if (typeof value.sql !== "string" || (!/^\s*SELECT\b/i.test(value.sql) && !(allowEmpty && value.id === "-" && value.sql === ""))) throw new Error(`${at}.sql: expected an evidence SELECT query`);
  stringArray(value.columns, `${at}.columns`); stringArray(value.effectiveColumns, `${at}.effectiveColumns`);
  if (value.columns.length && value.columns.length !== expected.length) throw new Error(`${at}.columns: wrong width`);
  const effective = effectiveColumns(value.columns, expected);
  if (JSON.stringify(effective) !== JSON.stringify(value.effectiveColumns) || JSON.stringify([...effective].sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${at}: invalid effective column mapping`);
  if (!Array.isArray(value.rows)) throw new Error(`${at}.rows: expected raw row arrays`);
  if (!value.sql && value.rows.length) throw new Error(`${at}: rows without a query`);
  return value.rows.map((row: unknown, i: number) => {
    if (!Array.isArray(row) || row.length !== expected.length || row.some(cell => cell !== null && !["number", "string", "boolean"].includes(typeof cell))) throw new Error(`${at}.rows[${i}]: invalid row width or non-scalar cell`);
    return Object.fromEntries(effective.map((column, j) => [column, row[j]]));
  });
}
function numericCell(value: unknown, at: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if ((typeof value !== "number" && (typeof value !== "string" || !value.trim())) || !Number.isFinite(Number(value))) throw new Error(`${at}: invalid numeric observation`);
  return Number(value);
}
function period(value: unknown, frequency: unknown, now: Date, at: string): void {
  const match = typeof value === "string" ? value.match(frequency === "Q" ? /^(\d{4})-Q([1-4])$/ : /^(\d{4})-(0[1-9]|1[0-2])$/) : null;
  if (!match || (frequency !== "M" && frequency !== "Q")) throw new Error(`${at}: invalid observation period or frequency`);
  const month = Number(match[1]) * 12 + Number(match[2]) * (frequency === "Q" ? 3 : 1) - 1;
  if (month > now.getUTCFullYear() * 12 + now.getUTCMonth()) throw new Error(`${at}: observation is after calculatedAt`);
}
function validateRows(rows: Record<string, unknown>[], req: Request, now: Date, mode: "market" | PricingEvidenceMode): void {
  const metadata = new Map<string, string>(), observations = new Map<string, number>();
  for (const [i, row] of rows.entries()) {
    const at = `${mode}.rows[${i}]`;
    const keys = mode === "market" ? ["country", "concept", "category_label", "frequency", "period", "source_id"] : ["sku", "product", "country", "sku_category", "currency", "period", "source_id", ...(mode === "sku-history" ? ["rate_concept", "category_label", "frequency"] : [])];
    for (const key of keys) text(row[key], `${at}.${key}`);
    if (!req.countries.includes(row.country as Country)) throw new Error(`${at}: country outside the request`);
    const frequency = mode === "legacy-pricing" ? String(row.period).includes("-Q") ? "Q" : "M" : row.frequency;
    period(row.period, frequency, now, at);
    const rate = numericCell(row.yoy_pct, at, mode !== "legacy-pricing");
    if (mode === "market" && row.concept !== req.concept && row.concept !== "all_items") throw new Error(`${at}: unrelated market concept`);
    if (mode !== "market") {
      if (numericCell(row.current_price, `${at}.current_price`)! < 0) throw new Error(`${at}: negative current price`);
      if (mode === "sku-history" && row.rate_concept !== row.sku_category) throw new Error(`${at}: SKU category does not match the joined rate concept`);
    }
    const key = JSON.stringify(mode === "market" ? [row.country, row.concept] : [row.country, row.sku]);
    const fields = mode === "market" ? ["category_label", "frequency", "source_id"] : ["product", "sku_category", "currency", "current_price", "source_id", ...(mode === "sku-history" ? ["rate_concept", "category_label", "frequency"] : ["period", "yoy_pct"])];
    const signature = JSON.stringify(fields.map(field => field === "current_price" ? Number(row[field]) : row[field]));
    if (metadata.has(key) && (metadata.get(key) !== signature || mode === "legacy-pricing")) throw new Error(`${at}: conflicting or duplicate series/SKU metadata`);
    metadata.set(key, signature);
    const observation = `${key}|${row.period}`;
    if (rate !== null) {
      if (observations.has(observation) && observations.get(observation) !== rate) throw new Error(`${at}: conflicting duplicate observation`);
      observations.set(observation, rate);
    }
  }
}
function replaySkus(rows: Record<string, unknown>[], mode: PricingEvidenceMode, req: Request, facts: MarketFacts[], cite: string): SkuLine[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = `${row.country}|${row.sku}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const result: SkuLine[] = [];
  for (const list of groups.values()) {
    const row = list[0], price = Number(row.current_price), p = req.proposedChangePct;
    const at = (pct?: number) => pct === undefined ? undefined : Math.round(price * (1 + pct / 100) * 100) / 100;
    const common = { sku: String(row.sku), product: String(row.product), country: String(row.country), skuCategory: String(row.sku_category), currency: String(row.currency), currentPrice: price, cite };
    if (mode === "sku-history") {
      const sf = seriesFacts(list.map(r => ({ ...r, concept: r.rate_concept })));
      if (!sf) continue;
      const { low, high } = marketBenchmark(sf);
      result.push({ ...common, period: sf.latestPeriod, yoy: sf.latestYoy, sourceId: sf.sourceId, avg12: sf.avg12, rangeLow: low, rangeHigh: high, low: at(low), high: at(high), atProposed: at(p), verdict: p === undefined ? undefined : `${p > high ? "above" : p < low ? "below" : "within"} the market benchmark`, rateLabel: sf.label });
    } else {
      const f = facts.find(f => f.country === row.country);
      result.push({ ...common, period: String(row.period), yoy: Number(row.yoy_pct), sourceId: String(row.source_id), low: at(f?.suggested?.low), high: at(f?.suggested?.high), atProposed: at(p), verdict: f?.verdict });
    }
  }
  if (mode === "sku-history") result.sort((a, b) => a.country.localeCompare(b.country) || a.sku.localeCompare(b.sku));
  return result;
}

/** Replay recorded arithmetic only. No configuration, memory, SQL or model calls occur. */
export function verifyEvidence(value: unknown): EvidenceVerification {
  const report: EvidenceVerification = { ok: false, checks: 0, errors: [], warnings: [], coverage: { requestedMarkets: 0, verifiedMarkets: [], unavailableMarkets: [], unsupportedMarkets: [], verifiedSkus: 0, pricingMode: "none", rawMarketRows: 0, rawPricingRows: 0 }, limitations: [...LIMITATIONS] };
  const compare = (actual: unknown, expected: unknown, at: string) => {
    const walk = (a: any, e: any, path: string) => {
      report.checks++;
      if (e === undefined && a === undefined) return;
      if (Array.isArray(e)) {
        if (!Array.isArray(a) || a.length !== e.length) { report.errors.push(`${path}: array length or shape differs`); return; }
        e.forEach((child, i) => walk(a[i], child, `${path}[${i}]`)); return;
      }
      if (e !== null && typeof e === "object") {
        if (!a || typeof a !== "object" || Array.isArray(a)) { report.errors.push(`${path}: expected an object`); return; }
        for (const key of new Set([...Object.keys(a), ...Object.keys(e)])) walk(a[key], e[key], `${path}.${key}`);
        return;
      }
      if (a !== e) report.errors.push(`${path}: recorded ${JSON.stringify(a)} differs from replayed ${JSON.stringify(e)}`);
    };
    walk(actual, expected, at);
  };
  try {
    const packet = jsonCopy(value);
    shape(packet, "evidence", ["schemaVersion", "methodVersion", "calculatedAt", "request", "passThrough", "queries", "results"], ["startedAt"]);
    if (packet.schemaVersion !== EVIDENCE_SCHEMA_VERSION) throw new Error("Unsupported evidence schemaVersion");
    if (packet.methodVersion !== 2 && packet.methodVersion !== EVIDENCE_METHOD_VERSION) throw new Error("Unsupported evidence methodVersion");
    if (packet.methodVersion === 2) report.warnings.push("Legacy method 2 is replayed as recorded: it could use all-items as a fallback benchmark when the requested category was unavailable. Method 3 keeps that series as context only.");
    const now = isoDate(packet.calculatedAt, "calculatedAt");
    if (packet.startedAt !== undefined && isoDate(packet.startedAt, "startedAt").getTime() > now.getTime()) throw new Error("calculatedAt precedes startedAt");
    const req = validateRequest(packet.request);
    finite(packet.passThrough, "passThrough");
    if (packet.passThrough < 0 || packet.passThrough > 1) throw new Error("passThrough: outside 0..1");
    if (req.passThrough !== undefined && req.passThrough !== packet.passThrough) throw new Error("request.passThrough differs from the applied passThrough policy");
    shape(packet.queries, "queries", ["market"], ["pricing"]);
    shape(packet.results, "results", ["facts", "skus"], ["alignment"]);
    if (!Array.isArray(packet.results.facts) || !Array.isArray(packet.results.skus)) throw new Error("results: facts and skus must be arrays");
    const rows = readQuery(packet.queries.market, COMPARE_COLUMNS, "queries.market", !req.countries.length);
    validateRows(rows, req, now, "market");
    report.coverage.requestedMarkets = req.countries.length + req.unknownCountries.length;
    report.coverage.unsupportedMarkets = [...req.unknownCountries];
    if (req.unknownCountries.length) report.warnings.push(`Unsupported requested markets are outside verification coverage: ${req.unknownCountries.join(", ")}.`);
    report.coverage.rawMarketRows = rows.length;
    const facts = (packet.methodVersion === 2 ? buildFactsLegacyV2 : buildFacts)(rows, req, packet.queries.market.id, packet.passThrough, now);
    compare(packet.results.facts, facts, "results.facts");
    if (req.countries.length || packet.results.alignment !== undefined) compare(packet.results.alignment, buildAlignment(rows, req, facts, packet.queries.market.id, now), "results.alignment");
    const verifiedMarkets = facts.filter(f => (f.category ?? f.allItems)?.concept === req.concept).map(f => f.country);
    report.coverage.unavailableMarkets = req.countries.filter(c => !verifiedMarkets.includes(c));
    if (!verifiedMarkets.length) report.warnings.push("No requested-market observations are available for verification.");
    else if (report.coverage.unavailableMarkets.length) report.warnings.push(`Requested category unavailable for: ${report.coverage.unavailableMarkets.join(", ")}.`);
    let replayedSkus: SkuLine[] = [];
    if (packet.queries.pricing !== undefined) {
      const mode = packet.queries.pricing.mode;
      if (mode !== "sku-history" && mode !== "legacy-pricing") throw new Error("queries.pricing.mode: unsupported pricing method");
      const pricingRows = readQuery(packet.queries.pricing, mode === "sku-history" ? SKU_RATE_COLUMNS : PRICING_COLUMNS, "queries.pricing", false, mode);
      if (packet.queries.pricing.id === packet.queries.market.id) throw new Error("Market and pricing queries must have distinct evidence ids");
      validateRows(pricingRows, req, now, mode);
      report.coverage.pricingMode = mode; report.coverage.rawPricingRows = pricingRows.length;
      replayedSkus = replaySkus(pricingRows, mode, req, facts, packet.queries.pricing.id);
    } else report.warnings.push("No raw SKU pricing query was recorded; no SKU arithmetic is verified.");
    const calculatedSkus = packet.results.skus.map((sku: unknown, i: number) => {
      shape(sku, `results.skus[${i}]`, ["sku", "product", "country", "skuCategory", "currency", "currentPrice", "period", "yoy", "sourceId", "cite"], SKU_KEYS);
      if (sku.coarser !== undefined && typeof sku.coarser !== "boolean") throw new Error(`results.skus[${i}].coarser: expected a boolean`);
      if (sku.selectionSource !== undefined && !["model", "memory", "fallback"].includes(sku.selectionSource)) throw new Error(`results.skus[${i}].selectionSource: unknown label`);
      if (sku.selectionFit !== undefined && !["specific", "broader"].includes(sku.selectionFit)) throw new Error(`results.skus[${i}].selectionFit: unknown label`);
      if (sku.selectionReason !== undefined && typeof sku.selectionReason !== "string") throw new Error(`results.skus[${i}].selectionReason: expected text`);
      return pick(sku, SKU_CALCULATED_KEYS);
    });
    compare(calculatedSkus, replayedSkus, "results.skus");
    if (!replayedSkus.length && packet.queries.pricing) report.warnings.push("The pricing query contains no usable SKU observations; no SKU arithmetic is verified.");
    report.ok = report.errors.length === 0;
    if (report.ok) { report.coverage.verifiedMarkets = verifiedMarkets; report.coverage.verifiedSkus = replayedSkus.length; }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }
  return report;
}
