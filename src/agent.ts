// PriceSignal agent: messy pricing question -> discover fragmented sources ->
// onboard them into Zetaris -> one federated SQL -> evidence-backed brief.
// The model (Nemotron via Meterless Nightshift) chooses the next action from a
// JSON action protocol; code executes actions, enforces guardrails, and computes
// every number that reaches the user.
import { EventEmitter } from "node:events";
import { chat, ChatMessage } from "./llm.ts";
import { AgentMemory } from "./memory.ts";
import { SqlResult, SqlRunner, rowsAsObjects, resetCiteIds } from "./zetaris.ts";
import { AGENCY_FOR, COMPARE_COLUMNS, Candidate, Concept, Country, CONCEPT_WORDS, compareSql, discover, monthsBack, normalizeCountry, onboard } from "./sources/index.ts";
import { MarketFacts, Brief, SkuLine, buildFacts, renderBrief, allowedNumbers, checkNarrative, Narrative } from "./brief.ts";
import { PRICING_COLUMNS, ensurePriceList, pricingSql } from "./sources/pricelist.ts";

export interface Request {
  raw: string;
  countries: Country[];
  concept: Concept; // the user's category, normalized
  conceptWords: string[];
  proposedChangePct?: number;
  passThrough?: number; // from the request, else memory, else 1.0
  policyStatement?: string;
  unknownCountries: string[];
}

export interface TraceEvent { t: number; kind: string; title: string; detail?: unknown }

export interface AgentDeps { llm?: typeof chat; sql: SqlRunner; memory: AgentMemory; discoverFn?: typeof discover; onboardFn?: typeof onboard; maxSteps?: number }

const SYSTEM_PLANNER = `You are PriceSignal, an agent that helps an exporter's pricing manager decide price changes per market from official inflation statistics.
Markets and agencies: DE = Eurostat HICP, CA = Statistics Canada CPI, AU = Australian Bureau of Statistics CPI.
Reply with a single JSON object and nothing else:
{"thought": "<one short sentence>", "actions": [{"action": "<name>", "args": {...}}, ...]}
"actions" holds 1 to 8 actions executed in order. Batch actions that do not depend on each other's results
(for example one discover_and_onboard or use_memory_mapping per missing pair) so the task needs few turns.
Actions:
- recall_memory {"query": str}            : search long-term memory (series mappings, pricing policy) before doing work again.
- discover_series {"country": "DE|CA|AU", "concept": str} : ask the agency which series matches; reports discontinued datasets and coarser categories.
- onboard_series {"country": "DE|CA|AU", "concept": str, "candidate": int} : register the chosen candidate as a Zetaris REST table + view and verify it returns rows. Use candidate index from discover_series.
- discover_and_onboard {"country": "DE|CA|AU", "concept": str} : discover, then onboard the best candidate (falls back to the next candidate if onboarding fails).
- use_memory_mapping {"country": "DE|CA|AU", "concept": str} : reuse a remembered, already-onboarded Zetaris view instead of discovering again.
- compare {} : run ONE federated SQL across all onboarded views in Zetaris (needed before finish).
- finish {} : write the brief. Only valid after compare succeeded.
Only DE, CA and AU exist; never plan actions for other markets (they are reported to the user as not covered).
Rules: every (country, concept) pair in the task needs a view (from memory or onboarding) before compare. If onboarding fails, try the next candidate or another frequency. Never invent numbers.`;

export class PriceSignalAgent extends EventEmitter {
  private llm: typeof chat;
  private discoverFn: typeof discover;
  private onboardFn: typeof onboard;
  private maxSteps: number;
  private providerSlow = false;
  readonly trace: TraceEvent[] = [];
  readonly sqlLog: SqlResult[] = [];

  constructor(private deps: AgentDeps) {
    super();
    resetCiteIds();
    const base = deps.llm ?? chat;
    this.llm = (async (messages: any, opts: any = {}) => {
      const o = this.providerSlow ? { ...opts, attempts: 1, timeoutMs: Math.min(opts.timeoutMs ?? 45_000, 45_000) } : opts;
      try {
        return await base(messages, o);
      } catch (e) {
        if (/Abort|HTTP 5\d\d|fetch failed|ETIMEDOUT/i.test(String(e)) && !this.providerSlow) {
          this.providerSlow = true;
          this.log("warn", "model provider is slow right now - shorter time budget for the rest of this run (deterministic fallbacks keep the brief complete)");
        }
        throw e;
      }
    }) as typeof chat;
    this.discoverFn = deps.discoverFn ?? discover;
    this.onboardFn = deps.onboardFn ?? onboard;
    this.maxSteps = deps.maxSteps ?? 18;
    const run = deps.sql.run.bind(deps.sql);
    deps.sql.run = async (sql, opts) => {
      const res = await run(sql, opts);
      this.sqlLog.push(res);
      this.log("sql", `${res.id}: ${sql.split("\n")[0].slice(0, 90)}`, { id: res.id, sql, rows: res.rows.length, ms: res.ms });
      return res;
    };
  }

  private log(kind: string, title: string, detail?: unknown): void {
    const ev = { t: Date.now(), kind, title, detail };
    this.trace.push(ev);
    this.emit("event", ev);
  }

  // ---------- 1. understand the messy request ----------
  async parse(raw: string): Promise<Request> {
    const prompt = `Extract the pricing request as JSON with keys:
countries (array of strings as the user wrote them), concept (one of: food, all_items, snacks, condiments, or a short noun), concept_words (2-4 lowercase words an official statistics label might use),
proposed_change_pct (number or null), pass_through (0..1 or null, only if the user states how much of inflation they pass on), policy_statement (string or null).
Request: """${raw}"""
Reply with JSON only.`;
    let j: any = {};
    try {
      const r = await this.llm([{ role: "user", content: prompt }], { lane: "fast", temperature: 0, attempts: 2, timeoutMs: 60_000 });
      j = extractJson(r.text) ?? {};
      this.log("llm", `parsed request (${r.model}, ${r.ms} ms)`, j);
    } catch (e) {
      this.log("warn", `LLM parse failed, using rules: ${String(e).slice(0, 120)}`);
    }
    const rawCountries: string[] = Array.isArray(j.countries) && j.countries.length ? j.countries.map(String) : raw.split(/[\s,&/]+/);
    const countries: Country[] = [];
    const unknown: string[] = [];
    for (const c of rawCountries) {
      const n = normalizeCountry(c.replace(/[^\p{L}]/gu, ""));
      if (n && !countries.includes(n)) countries.push(n);
      else if (!n && Array.isArray(j.countries)) unknown.push(c);
    }
    if (!countries.length) countries.push("DE", "CA", "AU");
    const concept = String(j.concept ?? "food").toLowerCase().trim() || "food";
    const words = Array.isArray(j.concept_words) && j.concept_words.length ? j.concept_words.map((w: unknown) => String(w).toLowerCase()) : CONCEPT_WORDS[concept] ?? [concept];
    // "same as last time": start from the request H-MEM remembered, keep only what the user changed.
    const sameAsLast = /\b(same as (last|before|previous)|like last time|as last time|as usual|same again)\b|지난번|저번|지난 분기|같은 조건/i.test(raw);
    const last = sameAsLast ? this.deps.memory.lastRequest() : undefined;
    const explicitCountries = raw.split(/[^\p{L}]+/u).map((w) => normalizeCountry(w)).filter((c): c is Country => !!c);
    if (last) {
      if (!explicitCountries.length) countries.splice(0, countries.length, ...(last.request.countries as Country[]));
      this.log("memory", `recalled last request ${last.id}: markets ${last.request.countries.join(", ")}, category "${last.request.concept}"${last.request.proposedChangePct !== undefined ? `, +${last.request.proposedChangePct}%` : ""}`);
    }
    const explicitPct = numOrUndef(raw.match(/[+＋]?\s?(\d+(?:\.\d+)?)\s?%/)?.[1]);
    const req: Request = {
      raw,
      countries,
      concept: last ? last.request.concept : concept,
      conceptWords: last ? last.request.conceptWords : words,
      proposedChangePct: last ? (explicitPct ?? last.request.proposedChangePct) : numOrUndef(j.proposed_change_pct) ?? explicitPct,
      passThrough: numOrUndef(j.pass_through),
      policyStatement: j.policy_statement ? String(j.policy_statement) : undefined,
      unknownCountries: unknown,
    };
    this.log("request", `markets ${countries.join(", ")} | category "${concept}"${req.proposedChangePct !== undefined ? ` | proposed +${req.proposedChangePct}%` : ""}${unknown.length ? ` | not covered: ${unknown.join(", ")}` : ""}`, req);
    return req;
  }

  // ---------- 2. act until every market has a governed view ----------
  async run(raw: string): Promise<Brief> {
    const t0 = Date.now();
    const req = await this.parse(raw);
    const memory = this.deps.memory;
    if (req.passThrough !== undefined) {
      const id = memory.rememberPolicy(req.passThrough, req.policyStatement ?? `pass through ${Math.round(req.passThrough * 100)}%`);
      this.log("memory", `stored pricing policy ${id}`);
    }
    const concepts: Concept[] = req.concept === "all_items" ? ["all_items"] : [req.concept, "all_items"];
    const pairs = req.countries.flatMap((country) => concepts.map((concept) => ({ country, concept })));
    const views = new Map<string, { view: string; label: string; via: "memory" | "onboarded"; note?: string; memoryId?: string }>();
    const candidates = new Map<string, Candidate[]>();
    const notes: string[] = [];
    for (const u of req.unknownCountries) notes.push(`${u}: not covered yet - PriceSignal currently reads Eurostat (DE), Statistics Canada (CA) and ABS (AU).`);
    const key = (c: string, k: string) => `${c}:${k}`;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PLANNER },
      { role: "user", content: `Task: ${JSON.stringify({ request: raw, needed: pairs, concept_words: req.conceptWords })}` },
    ];
    let compared: SqlResult | undefined;
    let comparedViews = -1; // views.size when the last federated query ran
    let badReplies = 0;
    let autopilot = false;

    for (let step = 0; step < this.maxSteps; step++) {
      const missing = pairs.filter((p) => !views.has(key(p.country, p.concept)));
      let batch: { action: string; args: any }[] = [];
      if (!autopilot) {
        try {
          const r = await this.llm(messages, { lane: "fast", temperature: 0.1, maxTokens: 6000, attempts: 2, timeoutMs: 75_000 });
          const j = extractJson(r.text);
          batch = Array.isArray(j?.actions) ? j.actions.filter((a: any) => a?.action).slice(0, 8) : j?.action ? [j] : [];
          if (!batch.length) throw new Error(`no action in: ${r.text.slice(0, 120)}`);
          messages.push({ role: "assistant", content: JSON.stringify({ thought: j.thought, actions: batch }) });
          this.log("plan", `${batch.map((b) => `${b.action} ${JSON.stringify(b.args ?? {})}`).join(" · ")}  [${r.model}]`, { thought: j.thought, model: r.model, ms: r.ms });
        } catch (e) {
          badReplies++;
          this.log("warn", `planner reply unusable (${badReplies}): ${String(e).slice(0, 120)}`);
          messages.push({ role: "user", content: 'That was not the action JSON. Do not answer the pricing question yourself. Reply with ONLY {"thought": "...", "actions": [{"action": "...", "args": {...}}]}.' });
          if (badReplies >= 2) {
            autopilot = true;
            this.log("warn", "switching to deterministic autopilot for the remaining steps");
          }
          continue;
        }
      }
      if (autopilot) {
        const a = nextAutopilot(missing, candidates, views, compared, memory, key);
        batch = a ? [a] : [];
      }
      if (!batch.length) break;

      const observations: unknown[] = [];
      let finished = false;
      for (const action of batch) {
        const obs = await this.execute(action, req, { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c) => { compared = c; comparedViews = views.size; } });
        observations.push({ action: action.action, args: action.args, result: obs });
        if (action.action === "finish" && compared) finished = true;
      }
      if (!autopilot) messages.push({ role: "user", content: `Observations: ${JSON.stringify(observations).slice(0, 3500)}\nStill missing: ${JSON.stringify(pairs.filter((p) => !views.has(key(p.country, p.concept))))}\nNext: reply with the action JSON only.` });
      if (!finished && compared && comparedViews === views.size && pairs.every((p) => views.has(key(p.country, p.concept)))) {
        // Everything needed is onboarded and compared: finishing needs no extra model call.
        this.log("plan", "all markets compared - finishing without another planner turn");
        finished = true;
      }
      if (finished) break;
    }

    if (!compared) {
      // Guardrail: never leave without the federated query if any view exists.
      if (views.size) await this.execute({ action: "compare", args: {} }, req, { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c) => (compared = c) });
    }
    if (!compared) throw new Error("No market could be onboarded; see trace.");

    // ---------- 3. facts are computed by code, narrative by the model ----------
    const remembered = req.passThrough === undefined ? memory.latestPolicy() : undefined;
    const policy = req.passThrough ?? remembered?.policy ?? 1.0;
    const policySource = req.passThrough !== undefined ? "stated in this request" : remembered ? `remembered from an earlier request (${remembered.id})` : "default: full pass-through (no policy given)";
    if (remembered) this.log("memory", `using remembered pricing policy ${remembered.id}: ${Math.round(policy * 100)}%`);
    const facts: MarketFacts[] = buildFacts(rowsAsObjects(compared, COMPARE_COLUMNS), req, compared.id, policy);
    for (const p of pairs) if (!views.has(key(p.country, p.concept))) notes.push(`${p.country} ${p.concept}: no usable official series was found.`);
    const pricing = await this.priceList(req, views, facts);
    const narrative = await this.narrate(req, facts, notes, policy);
    memory.rememberRequest(req);
    const brief: Brief = { request: req, facts, notes, narrative, passThrough: policy, policySource, skus: pricing?.skus, pricingQuery: pricing?.query, compared, sqlLog: this.sqlLog, views: [...views.entries()].map(([k, v]) => ({ key: k, ...v })), ms: Date.now() - t0, trace: this.trace };
    brief.markdown = renderBrief(brief);
    this.log("done", `brief ready in ${Math.round(brief.ms / 1000)} s (${this.sqlLog.length} SQL statements, ${[...views.values()].filter((v) => v.via === "memory").length} views reused from memory)`);
    return brief;
  }

  private async execute(action: { action: string; args: any }, req: Request, s: { views: Map<string, any>; candidates: Map<string, Candidate[]>; notes: string[]; key: (a: string, b: string) => string; pairs: { country: Country; concept: Concept }[]; getCompared: () => SqlResult | undefined; setCompared: (c: SqlResult) => void }): Promise<unknown> {
    const a = action.args ?? {};
    const memory = this.deps.memory;
    const country = normalizeCountry(String(a.country ?? "")) ?? undefined;
    const concept: Concept = String(a.concept ?? req.concept);
    try {
      switch (action.action) {
        case "recall_memory": {
          const { items } = memory.recall(String(a.query ?? `${req.countries.join(" ")} ${req.concept} series mapping pricing policy`));
          this.log("memory", `recalled ${items.length} memories`, items.map((i) => i.content));
          return items.slice(0, 8).map((i) => ({ id: i.id, content: i.content }));
        }
        case "use_memory_mapping": {
          if (!country) return { error: "country must be DE, CA or AU" };
          const hit = memory.findMapping(country, concept);
          if (!hit?.mapping) return { error: `no remembered mapping for ${country} ${concept}; discover it` };
          const probe = await this.deps.sql.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${hit.mapping.view} WHERE yoy_pct IS NOT NULL`);
          const n = Number(probe.rows[0]?.[0] ?? 0);
          if (!n) return { error: `remembered view psig.${hit.mapping.view} returned no rows; onboard again` };
          const latest = String(probe.rows[0]?.[1] ?? "");
          const age = monthsBetween(latest, monthsBack(0));
          if (age > (hit.mapping.frequency === "Q" ? 6 : 3)) {
            this.log("memory", `remembered view psig.${hit.mapping.view} stops at ${latest} (${age} months old) - not reusing it`);
            return { error: `remembered view psig.${hit.mapping.view} is stale (latest ${latest}); discover_and_onboard again` };
          }
          s.views.set(s.key(country, concept), { view: hit.mapping.view, label: hit.mapping.label, via: "memory", note: hit.mapping.note, memoryId: hit.id });
          const remembered = `${country}: ${hit.mapping.note} (remembered from an earlier run)`;
          if (hit.mapping.note && !s.notes.includes(remembered)) s.notes.push(remembered);
          memory.feedback(hit.id, "helpful");
          this.log("memory", `reused ${hit.id}: ${country} ${concept} -> psig.${hit.mapping.view} (${n} rows, latest ${probe.rows[0]?.[1]})`);
          return { ok: true, view: hit.mapping.view, rows: n, latest: probe.rows[0]?.[1] };
        }
        case "discover_series": {
          if (!country) return { error: "country must be DE, CA or AU" };
          const words = concept === req.concept ? req.conceptWords : undefined;
          const d = await this.discoverFn(country, concept, words);
          s.candidates.set(s.key(country, concept), d.candidates);
          for (const n of d.notes) if (!s.notes.includes(`${country}: ${n}`)) s.notes.push(`${country}: ${n}`);
          (s.candidates as any).set(s.key(country, concept) + ":notes", d.notes);
          this.log("discover", `${AGENCY_FOR[country].name}: ${d.candidates.length} candidate(s) for "${concept}"`, d);
          return { candidates: d.candidates.map((c, i) => ({ i, dataset: c.dataset, code: c.code, label: c.label, frequency: c.frequency, lastPeriod: c.lastPeriod })), notes: d.notes };
        }
        case "discover_and_onboard": {
          if (!country) return { error: "country must be DE, CA or AU" };
          const found: any = await this.execute({ action: "discover_series", args: { country, concept } }, req, s);
          const n = s.candidates.get(s.key(country, concept))?.length ?? 0;
          if (!n) return { discovered: found, error: "no candidate series" };
          let last: any;
          for (let i = 0; i < Math.min(n, 3); i++) {
            last = await this.execute({ action: "onboard_series", args: { country, concept, candidate: i } }, req, s);
            if (last?.ok) break;
          }
          return { notes: found?.notes, onboard: last };
        }
        case "onboard_series": {
          if (!country) return { error: "country must be DE, CA or AU" };
          const list = s.candidates.get(s.key(country, concept));
          if (!list?.length) return { error: "run discover_series for this pair first" };
          const c = list[Math.max(0, Math.min(list.length - 1, Number(a.candidate ?? 0)))];
          const r = await this.onboardFn(this.deps.sql, c, concept);
          this.log("onboard", `${r.ok ? "onboarded" : "FAILED"} ${c.agency} ${c.code} -> psig.${r.view}${r.ok ? ` (${r.rows} rows, latest ${r.latest})` : `: ${r.error}`}`, { candidate: c, result: { ...r, sql: r.sql } });
          if (r.ok) {
            const own: string[] = (s.candidates as any).get(s.key(country, concept) + ":notes") ?? [];
            const note = own.join(" ") || undefined;
            s.views.set(s.key(country, concept), { view: r.view, label: c.label, via: "onboarded", note });
            const id = memory.rememberMapping({ country, concept, agency: c.agency, dataset: c.dataset, code: c.code, label: c.label, view: r.view, frequency: c.frequency, note });
            this.log("memory", `stored mapping ${id}`);
          }
          return { ok: r.ok, view: r.view, rows: r.rows, latest: r.latest, error: r.error };
        }
        case "compare": {
          for (const p of s.pairs) {
            if (s.views.has(s.key(p.country, p.concept)) || !memory.findMapping(p.country, p.concept)?.mapping) continue;
            this.log("plan", `guardrail: ${p.country} ${p.concept} is in memory but was not requested - reusing it before compare`);
            await this.execute({ action: "use_memory_mapping", args: { country: p.country, concept: p.concept } }, req, s);
          }
          const vs = [...s.views.values()].map((v) => v.view);
          if (!vs.length) return { error: "no views yet" };
          const res = await this.deps.sql.run(compareSql(vs, monthsBack(15)));
          s.setCompared(res);
          this.log("compare", `federated query ${res.id} over ${vs.length} views -> ${res.rows.length} rows`);
          const latest = latestByKey(rowsAsObjects(res, COMPARE_COLUMNS));
          return { id: res.id, rows: res.rows.length, latest };
        }
        case "finish":
          return s.getCompared() ? { ok: true } : { error: "run compare first" };
        default:
          return { error: `unknown action ${action.action}` };
      }
    } catch (e) {
      this.log("error", `${action.action} failed: ${String(e).slice(0, 200)}`);
      return { error: String(e).slice(0, 300) };
    }
  }

  /** Join the company's internal price list (a Zetaris REST table) with the compared category series. */
  private async priceList(req: Request, views: Map<string, { view: string }>, facts: MarketFacts[]): Promise<{ skus: SkuLine[]; query: SqlResult } | undefined> {
    const cat = req.concept === "all_items" ? "all_items" : req.concept;
    const catViews = req.countries.map((c) => views.get(`${c}:${cat}`)?.view ?? views.get(`${c}:all_items`)?.view).filter((v): v is string => !!v);
    if (!catViews.length) return undefined;
    try {
      const ready = await ensurePriceList(this.deps.sql);
      if (!ready.ok) {
        this.log("warn", `internal price list not available in Zetaris: ${String(ready.error).slice(0, 140)}`);
        return undefined;
      }
      if (ready.created) this.log("onboard", "registered the internal price list as Zetaris REST table psig_internal.internal_price_list + view psig.v_price_list");
      const res = await this.deps.sql.run(pricingSql([...new Set(catViews)], req.countries));
      const rows = rowsAsObjects(res, PRICING_COLUMNS);
      const skus: SkuLine[] = rows.map((r) => {
        const f = facts.find((x) => x.country === r.country);
        const price = Number(r.current_price);
        const at = (pct?: number) => (pct === undefined ? undefined : Math.round(price * (1 + pct / 100) * 100) / 100);
        return {
          sku: String(r.sku), product: String(r.product), country: String(r.country), skuCategory: String(r.sku_category), currency: String(r.currency),
          currentPrice: price, period: String(r.period), yoy: Number(r.yoy_pct), sourceId: String(r.source_id),
          low: at(f?.suggested?.low), high: at(f?.suggested?.high), atProposed: at(req.proposedChangePct), verdict: f?.verdict, cite: res.id,
        };
      });
      this.log("pricing", `federated query ${res.id} joined the internal price list with official ${cat} inflation -> ${skus.length} SKUs priced`);
      return { skus, query: res };
    } catch (e) {
      this.log("warn", `price list join failed: ${String(e).slice(0, 160)}`);
      return undefined;
    }
  }

  private async narrate(req: Request, facts: MarketFacts[], notes: string[], policy: number): Promise<Narrative | undefined> {
    const allowed = allowedNumbers(facts, req, policy);
    const payload = { request: req.raw, proposed_change_pct: req.proposedChangePct ?? null, pass_through_pct: Math.round(policy * 100), facts, caveats: [...new Set(notes)] };
    const ask: ChatMessage[] = [
      { role: "system", content: "You write short, plain-English pricing briefs for an exporter's pricing manager. Use ONLY numbers that appear in the facts JSON (same rounding). No new numbers, no forecasts. Each market's verdict field is final: say it as given (above, within or below the evidence) and keep the headline consistent with every market's verdict. Mention only the caveats listed in the facts JSON (for example markets that are not covered); do not add claims about methodology or data sources that are not in it." },
      { role: "user", content: `Facts: ${JSON.stringify(payload)}\nReply with JSON only: {"headline": str (<= 25 words), "markets": {"<country code>": str (2-3 sentences: what the data says and what it means for the proposed change)}, "watch": str (one sentence on what to re-check next month)}` },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await this.llm(ask, { lane: (process.env.PSIG_NARRATIVE_LANE as "fast" | "deep") || "fast", temperature: 0.2, maxTokens: 8000, attempts: 1, timeoutMs: 75_000 });
        const n = extractJson(r.text) as Narrative | null;
        if (!n?.headline) throw new Error("no headline");
        const bad = checkNarrative(n, allowed);
        this.log("llm", `narrative (${r.model}, ${r.ms} ms)${bad.length ? ` - ungrounded numbers ${bad.join(", ")}` : " - all numbers grounded"}`);
        if (!bad.length) return n;
        ask.push({ role: "assistant", content: r.text }, { role: "user", content: `These numbers are not in the facts: ${bad.join(", ")}. Rewrite using only fact numbers. JSON only.` });
      } catch (e) {
        this.log("warn", `narrative attempt failed: ${String(e).slice(0, 120)}`);
        if (/Abort|HTTP 5\d\d|fetch failed/i.test(String(e))) break;
      }
    }
    return undefined; // renderBrief falls back to a deterministic summary
  }
}

// ---------- helpers ----------
function monthsBetween(from: string, to: string): number {
  const idx = (p: string) => {
    const m = p.match(/^(\d{4})-(\d{2})$/);
    if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
    const q = p.match(/^(\d{4})-Q(\d)$/);
    return q ? Number(q[1]) * 12 + Number(q[2]) * 3 - 1 : NaN;
  };
  const d = idx(to) - idx(from);
  return Number.isFinite(d) ? d : 0;
}

export function extractJson(text: string): any | null {
  const t = text.replace(/```(?:json)?/g, "").trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function latestByKey(rows: Record<string, unknown>[]): Record<string, { period: unknown; yoy_pct: unknown }> {
  const out: Record<string, { period: unknown; yoy_pct: unknown }> = {};
  for (const r of rows) {
    const k = `${r.country}:${r.concept}`;
    if (!out[k] || String(r.period) > String(out[k].period)) out[k] = { period: r.period, yoy_pct: r.yoy_pct };
  }
  return out;
}

function nextAutopilot(missing: { country: Country; concept: Concept }[], candidates: Map<string, Candidate[]>, views: Map<string, unknown>, compared: SqlResult | undefined, memory: AgentMemory, key: (a: string, b: string) => string): { action: string; args: any } | null {
  for (const p of missing) {
    if (memory.findMapping(p.country, p.concept) && !candidates.has(key(p.country, p.concept) + ":memtried")) {
      candidates.set(key(p.country, p.concept) + ":memtried", []);
      return { action: "use_memory_mapping", args: p };
    }
    const list = candidates.get(key(p.country, p.concept));
    if (!list) return { action: "discover_series", args: p };
    const tried = candidates.get(key(p.country, p.concept) + ":tried") ?? [];
    if (tried.length < list.length) {
      tried.push(list[tried.length]);
      candidates.set(key(p.country, p.concept) + ":tried", tried);
      return { action: "onboard_series", args: { ...p, candidate: tried.length - 1 } };
    }
  }
  if (!compared && views.size) return { action: "compare", args: {} };
  if (compared) return { action: "finish", args: {} };
  return null;
}
