// Every number in the brief is computed here from rows Zetaris returned.
// The model only writes prose around them, and checkNarrative() rejects prose
// that introduces numbers not present in the facts.
import type { Request, TraceEvent } from "./agent.ts";
import type { SqlResult } from "./zetaris.ts";
import { AGENCY_FOR, Country } from "./sources/index.ts";

export interface SeriesFacts {
  concept: string;
  label: string;
  frequency: string;
  sourceId: string;
  latestPeriod: string;
  latestYoy: number;
  avg12: number;
  yoy6Back?: number;
  trend: "rising" | "easing" | "flat";
  points: { period: string; yoy: number }[];
}

export interface MarketFacts {
  country: Country;
  agency: string;
  category?: SeriesFacts;
  allItems?: SeriesFacts;
  monthsStale?: number;
  suggested?: { low: number; high: number; basis: string };
  verdict?: "above the evidence" | "within the evidence" | "below the evidence";
  cite: string;
}

export interface SkuLine {
  sku: string; product: string; country: string; skuCategory: string; currency: string; currentPrice: number;
  period: string; yoy: number; sourceId: string; low?: number; high?: number; atProposed?: number; verdict?: string; cite: string;
  /** the official series this SKU was priced on (its own category where the agency publishes it) */
  rateLabel?: string; avg12?: number; rangeLow?: number; rangeHigh?: number; coarser?: boolean;
}

export interface Narrative { headline: string; markets: Record<string, string>; watch?: string }

export interface Brief {
  request: Request;
  facts: MarketFacts[];
  notes: string[];
  narrative?: Narrative;
  passThrough: number;
  policySource?: string;
  skus?: SkuLine[];
  pricingQuery?: SqlResult;
  /** what changed since the last brief H-MEM remembers for each market */
  sinceLast?: string[];
  compared: SqlResult;
  sqlLog: SqlResult[];
  views: { key: string; view: string; label: string; via: string; note?: string }[];
  ms: number;
  trace: TraceEvent[];
  markdown?: string;
}

const r1 = (x: number) => Math.round(x * 10 + (x >= 0 ? 1e-9 : -1e-9)) / 10;

function periodIndex(p: string): number {
  const m = p.match(/^(\d{4})-(\d{2})$/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  const q = p.match(/^(\d{4})-Q(\d)$/);
  if (q) return Number(q[1]) * 12 + Number(q[2]) * 3 - 1;
  return NaN;
}

export function seriesFacts(rows: Record<string, unknown>[]): SeriesFacts | undefined {
  const pts = rows
    .map((r) => ({ period: String(r.period), yoy: Number(r.yoy_pct) }))
    .filter((p) => Number.isFinite(p.yoy))
    .sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  if (!pts.length) return undefined;
  const freq = String(rows[0].frequency ?? "M");
  const last = pts.at(-1)!;
  const window = freq === "Q" ? 4 : 12;
  const recent = pts.slice(-window);
  const back = freq === "Q" ? 2 : 6;
  const prior = pts.length > back ? pts[pts.length - 1 - back] : undefined;
  const delta = prior ? last.yoy - prior.yoy : 0;
  return {
    concept: String(rows[0].concept),
    label: String(rows[0].category_label),
    frequency: freq,
    sourceId: String(rows[0].source_id),
    latestPeriod: last.period,
    latestYoy: r1(last.yoy),
    avg12: r1(recent.reduce((s, p) => s + p.yoy, 0) / recent.length),
    yoy6Back: prior ? r1(prior.yoy) : undefined,
    trend: Math.abs(delta) < 0.3 ? "flat" : delta > 0 ? "rising" : "easing",
    points: pts.map((p) => ({ period: p.period, yoy: r1(p.yoy) })),
  };
}

export function buildFacts(rows: Record<string, unknown>[], req: Request, cite: string, passThrough: number, now = new Date()): MarketFacts[] {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return req.countries.map((country) => {
    const mine = rows.filter((r) => r.country === country);
    const category = req.concept === "all_items" ? undefined : seriesFacts(mine.filter((r) => r.concept === req.concept));
    const allItems = seriesFacts(mine.filter((r) => r.concept === "all_items"));
    const main = category ?? allItems;
    const f: MarketFacts = { country, agency: AGENCY_FOR[country].name, category, allItems, cite };
    if (main) {
      f.monthsStale = nowIdx - periodIndex(main.latestPeriod);
      const lo = Math.max(0, r1(passThrough * Math.min(main.latestYoy, main.avg12)));
      const hi = Math.max(0, r1(passThrough * Math.max(main.latestYoy, main.avg12)));
      f.suggested = { low: lo, high: hi, basis: `${Math.round(passThrough * 100)}% pass-through of ${main.label} inflation (latest ${main.latestYoy}%, 12-period average ${main.avg12}%)` };
      if (req.proposedChangePct !== undefined) {
        const p = req.proposedChangePct;
        f.verdict = p > hi ? "above the evidence" : p < lo ? "below the evidence" : "within the evidence";
      }
    }
    return f;
  });
}

/** Numbers one market's prose may use: that market's own facts, the request and the policy - not the whole history. */
export function marketNumbers(f: MarketFacts | undefined, req: Request, policy?: number): number[] {
  const out = new Set<number>([6, 12]);
  const add = (x?: number) => {
    if (x === undefined || !Number.isFinite(x)) return;
    out.add(r1(x));
    out.add(r1(Math.abs(x)));
  };
  if (f) {
    for (const s of [f.category, f.allItems]) {
      if (!s) continue;
      add(s.latestYoy);
      add(s.avg12);
      add(s.yoy6Back);
      if (s.yoy6Back !== undefined) add(s.latestYoy - s.yoy6Back);
    }
    add(f.suggested?.low);
    add(f.suggested?.high);
    add(f.monthsStale);
    if (f.suggested && req.proposedChangePct !== undefined) {
      add(req.proposedChangePct - f.suggested.high);
      add(req.proposedChangePct - f.suggested.low);
    }
  }
  add(req.proposedChangePct);
  if (req.passThrough !== undefined) add(req.passThrough * 100);
  if (policy !== undefined) add(policy * 100);
  return [...out];
}

export function allowedNumbers(facts: MarketFacts[], req: Request, policy?: number): number[] {
  const out = new Set<number>([facts.length]);
  for (const f of facts) for (const x of marketNumbers(f, req, policy)) out.add(x);
  if (!facts.length) for (const x of marketNumbers(undefined, req, policy)) out.add(x);
  return [...out];
}

const stripYears = (t: string) => t.replace(/\b(19|20)\d{2}(-(Q[1-4]|\d{2}))?\b/g, " ");
const near = (a: number, b: number) => Math.abs(a - b) < 0.051;

function unknownNumbers(text: string, allowed: number[]): string[] {
  const bad: string[] = [];
  for (const m of stripYears(text).matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)) {
    const x = Number(m[0]);
    if (!allowed.some((a) => near(a, x))) bad.push(m[0]);
  }
  return bad;
}

/** A stated "X% to Y%" range must be the computed suggested range (or a latest/average pair describing the data). */
function rangeErrors(text: string, f: MarketFacts): string[] {
  const bad: string[] = [];
  const data: number[] = [];
  for (const s of [f.category, f.allItems]) if (s) data.push(s.latestYoy, s.avg12, ...(s.yoy6Back !== undefined ? [s.yoy6Back] : []));
  const isData = (x: number) => data.some((d) => near(Math.abs(d), x));
  for (const m of stripYears(text).matchAll(/(\d+(?:\.\d+)?)\s*%?\s*(?:to|–|—|-|and)\s*(\d+(?:\.\d+)?)\s*%/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const isRange = !!f.suggested && near(Math.min(a, b), f.suggested.low) && near(Math.max(a, b), f.suggested.high);
    if (!isRange && !(isData(a) && isData(b))) bad.push(`${m[1]}–${m[2]}%`);
  }
  return bad;
}

/**
 * Numbers in the prose that are not facts (years and period labels are ignored).
 * With facts, each market's paragraph is checked against that market's own numbers and its stated range;
 * without facts (unit tests), the flat allowed list is used.
 */
export function checkNarrative(n: Narrative, allowed: number[], facts?: MarketFacts[], req?: Request, policy?: number, extra: number[] = []): string[] {
  const bad: string[] = [];
  if (facts && req) {
    for (const [code, text] of Object.entries(n.markets ?? {})) {
      const f = facts.find((x) => x.country === code.toUpperCase());
      bad.push(...unknownNumbers(String(text), f ? [...marketNumbers(f, req, policy), ...extra] : allowed));
      if (f) bad.push(...rangeErrors(String(text), f));
    }
    const general = [n.headline, n.watch ?? ""].join(" ");
    bad.push(...unknownNumbers(general, allowed));
    if (facts.length === 1) bad.push(...rangeErrors(general, facts[0]));
  } else {
    bad.push(...unknownNumbers([n.headline, ...Object.values(n.markets ?? {}), n.watch ?? ""].join(" "), allowed));
  }
  return [...new Set(bad)];
}

/** What the narrative model sees: the facts without the monthly history, so it cannot pick a stray number. */
export function factsForNarrative(facts: MarketFacts[]): unknown[] {
  const slim = (s?: SeriesFacts) => (s ? { label: s.label, frequency: s.frequency, latestPeriod: s.latestPeriod, latestYoy: s.latestYoy, avg12: s.avg12, yoy6Back: s.yoy6Back, trend: s.trend } : undefined);
  return facts.map((f) => ({ country: f.country, agency: f.agency, category: slim(f.category), allItems: slim(f.allItems), monthsStale: f.monthsStale, suggested_range_pct: f.suggested ? { low: f.suggested.low, high: f.suggested.high } : undefined, verdict: f.verdict }));
}

/** One line per market for the same caveat about different categories ("condiments" and "snacks" at the Food level). */
export function mergeNotes(notes: string[]): string[] {
  const out: string[] = [];
  const groups = new Map<string, string[]>();
  for (const n of [...new Set(notes)]) {
    const m = n.match(/^(.*?so )"([^"]+)"( is compared at .*)$/);
    if (!m) { out.push(n); continue; }
    const k = m[1] + "\u0000" + m[3];
    if (!groups.has(k)) { groups.set(k, []); out.push(k); }
    groups.get(k)!.push(m[2]);
  }
  return out.map((n) => {
    const g = groups.get(n);
    if (!g) return n;
    const [a, b] = n.split("\u0000");
    const names = g.map((x) => `"${x}"`);
    return `${a}${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}${names.length > 1 ? b.replace(" is compared", " are compared") : b}`;
  });
}

const fmt = (x?: number, suffix = "%") => (x === undefined ? "n/a" : `${x > 0 ? "+" : ""}${x.toFixed(1)}${suffix}`);

/** Headline built from the computed verdicts, used when the model's prose is unavailable. */
export function fallbackHeadline(b: Brief): string | undefined {
  const p = b.request.proposedChangePct;
  const withVerdict = b.facts.filter((f) => f.verdict);
  if (p !== undefined && withVerdict.length) {
    const groups = new Map<string, string[]>();
    for (const f of withVerdict) groups.set(f.verdict!, [...(groups.get(f.verdict!) ?? []), f.country]);
    return `+${p}% is ${[...groups.entries()].map(([v, cs]) => `${v} in ${cs.length > 1 ? `${cs.slice(0, -1).join(", ")} and ${cs.at(-1)}` : cs[0]}`).join("; ")}.`;
  }
  const parts = b.facts.map((f) => (f.category ?? f.allItems) && `${f.country} ${fmt((f.category ?? f.allItems)!.latestYoy)}`).filter(Boolean);
  return parts.length ? `Latest year-on-year rates: ${parts.join(", ")}.` : undefined;
}

export function renderBrief(b: Brief): string {
  const L: string[] = [];
  const req = b.request;
  L.push(`# PriceSignal brief`);
  L.push(`> ${req.raw.replace(/\n/g, " ")}`);
  L.push("");
  const headline = b.narrative?.headline ?? fallbackHeadline(b);
  if (headline) L.push(`**${headline}**`, "");
  L.push(`Policy used: pass through ${Math.round(b.passThrough * 100)}% of category inflation${b.policySource ? ` (${b.policySource})` : ""}${req.proposedChangePct !== undefined ? ` · proposed change: +${req.proposedChangePct}%` : ""}.`, "");
  L.push(`| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const f of b.facts) {
    const s = f.category ?? f.allItems;
    L.push(
      `| ${f.country} (${f.agency}) | ${s?.label ?? "not found"} | ${s?.latestPeriod ?? "-"}${f.monthsStale !== undefined && f.monthsStale > 2 ? ` ⚠ ${f.monthsStale} mo old` : ""} | ${fmt(s?.latestYoy)} | ${fmt(s?.avg12)} | ${s?.trend ?? "-"} | ${fmt(f.allItems?.latestYoy)} | ${f.suggested ? `${f.suggested.low.toFixed(1)}–${f.suggested.high.toFixed(1)}%` : "-"} | ${f.verdict ?? "-"} |`,
    );
  }
  L.push("", `Every rate above comes from Zetaris query **${b.compared.id}** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.`, "");
  if (b.skus?.length) {
    const money = (x: number | undefined, c: string) => (x === undefined ? "-" : `${x.toFixed(2)} ${c}`);
    L.push(`## Your price list`);
    const perSku = b.skus.some((s) => s.rateLabel);
    L.push(perSku
      ? `Internal SKUs (Zetaris view \`psig.v_price_list\`) joined in query **${b.pricingQuery?.id}** with the official series of each product's own category in its market (sauces, snacks, food); each SKU's range uses that series, computed in code.`
      : `Internal SKUs (Zetaris view \`psig.v_price_list\`) joined with the latest official category rate in query **${b.pricingQuery?.id}**.`, "");
    L.push(`| SKU | Product | Market | Current price | Suggested new price | At +${req.proposedChangePct ?? "-"}% | Rate used |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const s of b.skus) L.push(`| ${s.sku} | ${s.product} | ${s.country} | ${money(s.currentPrice, s.currency)} | ${s.low !== undefined ? `${s.low.toFixed(2)}–${money(s.high, s.currency)}` : "-"} | ${money(s.atProposed, s.currency)}${s.verdict ? ` (${s.verdict})` : ""} | ${fmt(s.yoy)} ${s.period}${s.rateLabel ? ` · ${s.rateLabel}${s.coarser ? " (coarser)" : ""}` : ""} |`);
    L.push("");
  }
  L.push(`## By market`);
  for (const f of b.facts) {
    const s = f.category ?? f.allItems;
    const prose = b.narrative?.markets?.[f.country];
    L.push(`### ${f.country} — ${f.agency}`);
    L.push(prose ?? (s ? `${s.label}: ${fmt(s.latestYoy)} year on year in ${s.latestPeriod} (${s.trend}; 12-period average ${fmt(s.avg12)}). Suggested range ${f.suggested?.low.toFixed(1)}–${f.suggested?.high.toFixed(1)}%.` : "No usable series."));
    if (s) L.push(`<sub>source: \`${s.sourceId}\` · ${s.frequency === "Q" ? "quarterly" : "monthly"} · cite ${f.cite}</sub>`);
    L.push("");
  }
  if (b.sinceLast?.length) {
    L.push(`## Since your last brief (remembered in H-MEM)`);
    for (const c of b.sinceLast) L.push(`- ${c}`);
    L.push("");
  }
  if (b.notes.length) {
    L.push(`## Fragmentation the agent found`);
    for (const n of mergeNotes(b.notes)) L.push(`- ${n}`);
    L.push("");
  }
  if (b.narrative?.watch) L.push(`**Watch:** ${b.narrative.watch}`, "");
  L.push(`## Evidence`);
  L.push(`Views: ${b.views.map((v) => `\`psig.${v.view}\` (${v.via})`).join(", ")}`, "");
  for (const q of b.sqlLog.filter((q) => q.id === b.compared.id || q.id === b.pricingQuery?.id || /^SELECT COUNT/.test(q.sql))) {
    L.push(`<details><summary>${q.id} · ${q.rows.length} rows · ${q.ms} ms</summary>\n\n\`\`\`sql\n${q.sql}\n\`\`\`\n</details>`);
  }
  if (!b.narrative) L.push("", `_Narrative omitted: the model's text did not pass the number-grounding check, so only computed facts are shown._`);
  return L.join("\n");
}
