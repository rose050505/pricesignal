// Every number in the brief is computed here from rows Zetaris returned.
// The model only writes prose around them, and checkNarrative() rejects prose
// that introduces numbers not present in the facts.
import type { Request, TraceEvent } from "./agent.ts";
import type { SqlResult } from "./zetaris.ts";
import { AGENCY_FOR, Country, normalizeCountry } from "./sources/index.ts";
import { priceView } from "./sources/pricelist.ts";

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
  /** cost side: pass-through × the stated cost increase, and how it compares with the market's range */
  costNeed?: number;
  /** for an "above" verdict: the pass-through share (in %) the proposal would need, given this market's inflation */
  passThroughNeeded?: number;
  costVsMarket?: "ahead of the market" | "within the market range" | "behind the market";
  cite: string;
}

export interface SkuLine {
  sku: string; product: string; country: string; skuCategory: string; currency: string; currentPrice: number;
  period: string; yoy: number; sourceId: string; low?: number; high?: number; atProposed?: number; verdict?: string; cite: string;
  /** the official series this SKU was priced on (its own category where the agency publishes it) */
  rateLabel?: string; avg12?: number; rangeLow?: number; rangeHigh?: number; coarser?: boolean;
  /** Product-scope series selection, separate from the requested market category. */
  selectionReason?: string;
  selectionSource?: "model" | "memory" | "fallback";
  selectionFit?: "specific" | "broader";
}

export interface Narrative { headline: string; markets: Record<string, string>; watch?: string }

/** Why a brief has no model-written prose. */
export type NarrativeIssue = "grounding" | "unusable" | "provider" | "budget";
const NARRATIVE_ISSUE: Record<NarrativeIssue, string> = {
  grounding: "the model's text did not match the computed numbers and verdicts",
  unusable: "the model's reply was not usable JSON",
  provider: "the model provider returned an error or timed out",
  budget: "the narrative time budget ran out",
};

export interface RunMetrics {
  /** Actual model requests, including hedges and retries. */
  modelCalls: number;
  plannerCalls: number;
  discoveries: number;
  reusedViews: number;
  numbersMs?: number;
}

export interface Brief {
  request: Request;
  metrics?: RunMetrics;
  partialStage?: "markets" | "pricing";
  facts: MarketFacts[];
  notes: string[];
  narrative?: Narrative;
  narrativeIssue?: NarrativeIssue;
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
/** A proposed change as the user would write it: "+5%", "-2%". */
export const signedPct = (x: number) => `${x > 0 ? "+" : ""}${x}%`;

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
        const basis = Math.max(main.latestYoy, main.avg12);
        if (f.verdict === "above the evidence" && basis > 0) f.passThroughNeeded = Math.round((p / basis) * 100);
      }
      if (req.costIncreasePct !== undefined) {
        // The second lens: what the exporter's own costs call for, next to what the market has moved.
        f.costNeed = r1(passThrough * req.costIncreasePct);
        f.costVsMarket = f.costNeed > hi ? "ahead of the market" : f.costNeed < lo ? "behind the market" : "within the market range";
      }
    }
    return f;
  });
}

/** Numbers one market's prose may use: that market's own facts, the request and the policy - not the whole history. */
export function marketNumbers(f: MarketFacts | undefined, req: Request, policy?: number): number[] {
  const out = new Set<number>();
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
    add(f.costNeed);
    add(f.passThroughNeeded);
    if (f.costNeed !== undefined && f.suggested) add(f.costNeed - f.suggested.high);
  }
  add(req.costIncreasePct);
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
// "12-month average", "over 6 months", "4-quarter average" describe the window, not a rate; a bare 6 or 12 is checked like any number.
const stripWindows = (t: string) => t.replace(/\b(?:6|12)[- ]?(?:months?|periods?)\b|\b4[- ]?quarters?\b/gi, " ");
const near = (a: number, b: number) => Math.abs(a - b) < 0.051;

function unknownNumbers(text: string, allowed: number[]): string[] {
  const bad: string[] = [];
  for (const m of stripWindows(stripYears(text)).matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)) {
    const x = Number(m[0]);
    if (!allowed.some((a) => near(a, x))) bad.push(m[0]);
  }
  return bad;
}

/**
 * A stated "X% to Y%" range must be the computed suggested range. A latest/average pair may describe the data
 * ("eased from 4.1% to 2.2%"), but not where the sentence presents it as what is supported ("supports 1.4% to 6.1%").
 */
function rangeErrors(text: string, f: MarketFacts): string[] {
  const bad: string[] = [];
  const data: number[] = [];
  for (const s of [f.category, f.allItems]) if (s) data.push(s.latestYoy, s.avg12, ...(s.yoy6Back !== undefined ? [s.yoy6Back] : []));
  const isData = (x: number) => data.some((d) => near(Math.abs(d), x));
  const t = stripYears(text);
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*%?\s*(?:to|–|—|-|and)\s*(\d+(?:\.\d+)?)\s*%/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const isRange = !!f.suggested && near(Math.min(a, b), f.suggested.low) && near(Math.max(a, b), f.suggested.high);
    const sentence = t.slice(Math.max(0, m.index! - 60), m.index).split(/[.;!?]\s/).pop() ?? "";
    const presentedAsRange = /support|suggest|justif|range|room|evidence|band/i.test(sentence);
    if (!isRange && (presentedAsRange || !(isData(a) && isData(b)))) bad.push(`${m[1]}–${m[2]}%`);
  }
  return bad;
}

/** "within / above / below the evidence (range)" in the prose must be the verdict the code computed. */
function verdictErrors(text: string, verdict?: MarketFacts["verdict"]): string[] {
  if (!verdict) return [];
  const bad: string[] = [];
  // Sentences about the cost need compare costs with the range, not the proposal: they are not verdict claims.
  const aboutProposal = text.split(/(?<=[.!?;])\s+/).filter((t) => !/cost|원가/i.test(t)).join(" ");
  for (const m of aboutProposal.matchAll(/\b(within|inside|above|exceeds?|exceeding|below|under|outside)\s+(?:the\s+)?(?:suggested\s+|computed\s+)?(?:evidence|range)\b/gi)) {
    const w = m[1].toLowerCase();
    const ok = w === "outside" ? verdict !== "within the evidence" : verdict === (/within|inside/.test(w) ? "within the evidence" : /below|under/.test(w) ? "below the evidence" : "above the evidence");
    if (!ok) bad.push(`"${m[0]}" (computed: ${verdict})`);
  }
  return bad;
}

/**
 * Verdict words in the headline ("within evidence in CA, below in AU"), market by market: each market named
 * after a verdict word (or before the first one) must have that verdict; "within or above" allows either.
 * With no market named, the word must be a verdict some market has (all of them, when they agree).
 */
function headlineVerdictErrors(headline: string, facts: MarketFacts[]): string[] {
  const vf = facts.filter((f) => f.verdict);
  if (!vf.length) return [];
  const text = headline.split(/(?<=[.!?;])\s+/).filter((t) => !/cost|원가/i.test(t)).join(" ");
  const toVerdict = (w: string) => (/within|inside/i.test(w) ? "within the evidence" : /below/i.test(w) ? "below the evidence" : "above the evidence");
  const claims: { at: number; end: number; words: string[]; verdicts: Set<string> }[] = [];
  for (const m of text.matchAll(/\b(within|inside|above|exceeds?|exceeding|below)\b/gi)) {
    const prev = claims.at(-1);
    if (prev && /^\s*(or|\/)\s*$/i.test(text.slice(prev.end, m.index))) {
      prev.verdicts.add(toVerdict(m[1]));
      prev.words.push(m[1]);
      prev.end = m.index! + m[0].length;
    } else claims.push({ at: m.index!, end: m.index! + m[0].length, words: [m[1]], verdicts: new Set([toVerdict(m[1])]) });
  }
  if (!claims.length) return [];
  const mentions = [...text.matchAll(/\p{L}+/gu)]
    .map((m) => ({ at: m.index!, country: normalizeCountry(m[0], false) }))
    .filter((x) => x.country && vf.some((f) => f.country === x.country));
  const bad: string[] = [];
  if (!mentions.length) {
    const present = new Set<string>(vf.map((f) => f.verdict!));
    for (const c of claims) if (![...c.verdicts].some((v) => present.has(v))) bad.push(`headline "${c.words.join(" or ")}" (computed: ${[...present].join(", ")})`);
    return bad;
  }
  for (const m of mentions) {
    const owner = [...claims].reverse().find((c) => c.at < m.at) ?? claims[0];
    const f = vf.find((x) => x.country === m.country)!;
    if (!owner.verdicts.has(f.verdict!)) bad.push(`headline "${owner.words.join(" or ")}" for ${m.country} (computed: ${f.verdict})`);
  }
  return [...new Set(bad)];
}

/** The market a prose key refers to ("DE", "de", "Germany"). */
export function marketKey(code: string): string {
  return normalizeCountry(code) ?? code.toUpperCase();
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
      if (typeof text !== "string") {
        bad.push(`${code}: not text`);
        continue;
      }
      const f = facts.find((x) => x.country === marketKey(code));
      bad.push(...unknownNumbers(text, f ? [...marketNumbers(f, req, policy), ...extra] : allowed));
      if (f) bad.push(...rangeErrors(text, f), ...verdictErrors(text, f.verdict));
    }
    if (typeof n.headline !== "string" || (n.watch !== undefined && typeof n.watch !== "string")) bad.push("headline or watch: not text");
    const general = [n.headline, n.watch ?? ""].join(" ");
    bad.push(...unknownNumbers(general, allowed));
    if (facts.length === 1) bad.push(...rangeErrors(general, facts[0]));
    bad.push(...headlineVerdictErrors(String(n.headline ?? ""), facts));
  } else {
    bad.push(...unknownNumbers([n.headline, ...Object.values(n.markets ?? {}), n.watch ?? ""].join(" "), allowed));
  }
  return [...new Set(bad)];
}

/** What the narrative model sees: the facts without the monthly history, so it cannot pick a stray number. */
export function factsForNarrative(facts: MarketFacts[]): unknown[] {
  const slim = (s?: SeriesFacts) => (s ? { label: s.label, frequency: s.frequency, latestPeriod: s.latestPeriod, latestYoy: s.latestYoy, avg12: s.avg12, yoy6Back: s.yoy6Back, trend: s.trend } : undefined);
  return facts.map((f) => ({ country: f.country, agency: f.agency, category: slim(f.category), allItems: slim(f.allItems), monthsStale: f.monthsStale, suggested_range_pct: f.suggested ? { low: f.suggested.low, high: f.suggested.high } : undefined, verdict: f.verdict, ...(f.passThroughNeeded !== undefined ? { pass_through_needed_pct: f.passThroughNeeded } : {}), ...(f.costNeed !== undefined ? { cost_need_pct: f.costNeed, cost_vs_market: f.costVsMarket } : {}) }));
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
    return `${signedPct(p)} is ${[...groups.entries()].map(([v, cs]) => `${v} in ${cs.length > 1 ? `${cs.slice(0, -1).join(", ")} and ${cs.at(-1)}` : cs[0]}`).join("; ")}.`;
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
  if (!b.facts.length) {
    L.push(`**None of the markets in this question is covered yet.**`, "", `## Fragmentation the agent found`, ...mergeNotes(b.notes).map((n) => `- ${n}`));
    return L.join("\n");
  }
  const headline = b.narrative?.headline ?? fallbackHeadline(b);
  if (headline) L.push(`**${headline}**`, "");
  L.push(`Policy used: pass through ${Math.round(b.passThrough * 100)}% of category inflation${b.policySource ? ` (${b.policySource})` : ""}${req.proposedChangePct !== undefined ? ` · proposed change: ${signedPct(req.proposedChangePct)}` : ""}.`, "");
  if (req.costIncreasePct !== undefined) L.push(`Your costs: ${signedPct(req.costIncreasePct)} (${req.costRemembered ? "remembered from your last request" : "stated in this request"}); at ${Math.round(b.passThrough * 100)}% pass-through that is a ${signedPct(r1(b.passThrough * req.costIncreasePct))} price rise.`, "");
  L.push(`| Market | Official category | Latest period | YoY | 12-period avg | Trend | All-items YoY | Suggested range | Proposed change |`);
  L.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const f of b.facts) {
    const s = f.category ?? f.allItems;
    L.push(
      `| ${f.country} (${f.agency}) | ${s?.label ?? "not found"} | ${s?.latestPeriod ?? "-"}${f.monthsStale !== undefined && f.monthsStale > 2 ? ` ⚠ ${f.monthsStale} mo old` : ""} | ${fmt(s?.latestYoy)} | ${fmt(s?.avg12)} | ${s?.trend ?? "-"} | ${fmt(f.allItems?.latestYoy)} | ${f.suggested ? `${f.suggested.low.toFixed(1)}–${f.suggested.high.toFixed(1)}%` : "-"} | ${f.verdict ?? "-"}${f.passThroughNeeded !== undefined ? ` (needs ${f.passThroughNeeded}% pass-through)` : ""} |`,
    );
  }
  L.push("", `Every rate above comes from Zetaris query **${b.compared.id}** (one federated SQL over the onboarded sources); suggested ranges and verdicts are computed in code from those rates and the pass-through policy.`, "");
  if (b.skus?.length) {
    const money = (x: number | undefined, c: string) => (x === undefined ? "-" : `${x.toFixed(2)} ${c}`);
    L.push(`## Your price list`);
    const perSku = b.skus.some((s) => s.rateLabel);
    L.push(perSku
      ? `Internal SKUs (Zetaris view \`psig.${priceView()}\`) joined in query **${b.pricingQuery?.id}** with official category series for the products in each market; broader proxies are marked and each SKU's range uses its selected series, computed in code.`
      : `Internal SKUs (Zetaris view \`psig.${priceView()}\`) joined with the latest official category rate in query **${b.pricingQuery?.id}**.`, "");
    L.push(`| SKU | Product | Market | Current price | Suggested new price | At ${req.proposedChangePct !== undefined ? signedPct(req.proposedChangePct) : "-"} | Rate used |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const s of b.skus) L.push(`| ${s.sku} | ${s.product} | ${s.country} | ${money(s.currentPrice, s.currency)} | ${s.low !== undefined ? `${s.low.toFixed(2)}–${money(s.high, s.currency)}${s.rangeLow !== undefined ? ` (${s.rangeLow > 0 ? "+" : ""}${s.rangeLow.toFixed(1)}–${s.rangeHigh!.toFixed(1)}%)` : ""}` : "-"} | ${money(s.atProposed, s.currency)}${s.verdict ? ` (${s.verdict})` : ""} | ${fmt(s.yoy)} ${s.period}${s.rateLabel ? ` · ${s.rateLabel}${s.selectionSource ? ` (${s.selectionFit === "broader" ? "broader proxy" : "product match"}; ${{ model: "model-selected", memory: "remembered match", fallback: "unconfirmed match" }[s.selectionSource]})` : s.coarser ? " (coarser)" : ""}` : ""} |`);
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
  const costed = b.facts.filter((f) => f.costVsMarket && f.suggested);
  if (costed.length) {
    L.push(`## Costs vs. the market`);
    L.push(`Two lenses on the same decision: what your costs call for (computed above) and how far consumer prices for the category have moved in each market (the suggested range).`, "");
    for (const f of costed) {
      const s = (f.category ?? f.allItems)!;
      const range = `${f.suggested!.low.toFixed(1)}–${f.suggested!.high.toFixed(1)}%`;
      const need = signedPct(f.costNeed!);
      L.push(`- ${f.country}: ${f.costVsMarket === "ahead of the market" ? `your cost-based rise of ${need} runs ahead of the market (${s.label}: ${range}); passing it on in full would price you above local inflation.` : f.costVsMarket === "behind the market" ? `your cost-based rise of ${need} is below what the market supports (${range}); prices have moved more than your costs.` : `your cost-based rise of ${need} sits within what the market supports (${range}).`}`);
    }
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
  if (!b.narrative) L.push("", `_Narrative omitted: ${b.narrativeIssue ? NARRATIVE_ISSUE[b.narrativeIssue] : "the model's text was not available"}, so only computed facts are shown._`);
  return L.join("\n");
}
