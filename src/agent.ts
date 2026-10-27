// PriceSignal agent: messy pricing question -> discover fragmented sources ->
// onboard them into Zetaris -> one federated SQL -> evidence-backed brief.
// The model (Nemotron via Meterless Nightshift) reads the request and proposes
// JSON actions; code validates and completes them, enforces guardrails, and
// computes every number that reaches the user.
import { EventEmitter } from "node:events";
import { chat, ChatMessage, ChatResult, thinkingOff } from "./llm.ts";
import { AgentMemory, type SeriesMapping } from "./memory.ts";
import { SqlResult, SqlRunner, rowsAsObjects, isIncompleteResultError } from "./zetaris.ts";
import { AGENCY_FOR, COMPARE_COLUMNS, Candidate, Concept, Country, COUNTRY_ALIASES, CONCEPT_WORDS, compareSql, marketSemanticView, semanticCompareSql, discover, monthsBack, normalizeCountry, onboard, skuSearchWords, isBroadFoodLabel, ensureCached, rawTableRef, sourceAnswers, humanError, durableNotes } from "./sources/index.ts";
import { MarketFacts, Brief, RunMetrics, SkuLine, buildFacts, renderBrief, signedPct, marketKey, allowedNumbers, checkNarrative, salvageNarrative, factsForNarrative, headlineFacts, BENCHMARK_BASIS, costShareBasisDescription, seriesFacts, marketBenchmark, Narrative, NarrativeIssue } from "./brief.ts";
import { buildAlignment } from "./alignment.ts";
import { PRICE_DB, PRICING_COLUMNS, SKU_RATE_COLUMNS, ensurePriceList, priceTable, priceView, pricingSql, skuCategoriesSql, skuRatesSql } from "./sources/pricelist.ts";
import { BROADER_COVERAGE_REASON, SELECTION_VERSION, skuScope, selectionMessages, validateSelectionsPerGroup, fallbackSelection, type SelectionGroup, type SelectionDecision } from "./selection.ts";
import { sourceDecoderVersion, hasFreshPeriod, isUsableObservationCount } from "./sources/validation.ts";

export interface Request {
  raw: string;
  countries: Country[];
  concept: Concept; // the user's category, normalized
  conceptWords: string[];
  proposedChangePct?: number;
  /** how much the exporter's own costs rose, if the user said so ("our costs rose 8%") */
  costIncreasePct?: number;
  costRemembered?: boolean;
  /** Stated unit cost / unchanged selling price, 0..100%; costShareBasis identifies its timing. */
  costSharePct?: number;
  /** Whether the stated unit cost is measured before or after the stated cost change. */
  costShareBasis?: "before_change" | "after_change";
  costShareRemembered?: boolean;
  passThrough?: number; // share of the monetary cost increase to recover, from the request, memory, or 1.0
  invalidPassThrough?: boolean;
  inputIssues?: string[];
  policyStatement?: string;
  unknownCountries: string[];
  /** no market was named, so the default markets are used (the brief says so) */
  defaultMarkets?: boolean;
}

export interface TraceEvent { t: number; kind: string; title: string; detail?: unknown }

export interface AgentDeps { llm?: typeof chat; sql: SqlRunner; memory: AgentMemory; discoverFn?: typeof discover; onboardFn?: typeof onboard; maxSteps?: number; hedgeMs?: number; planBudgetMs?: number; compareRetryMs?: number }

/** A federated query that fails this many times ends the run with its error instead of retrying every step. */
const MAX_COMPARE_FAILURES = 3;
/** Price-list queries return about 15 rows per SKU and market; Zetaris honours this limit (checked live with 12,000 rows). */
const PRICE_LIST_ROW_LIMIT = 20_000;

const SYSTEM_PLANNER = `You are PriceSignal, an agent that helps an exporter's pricing manager decide price changes per market from official inflation statistics.
Markets and agencies: EU members (DE, FR, IT, ES, NL, BE, AT, IE, PT, FI, SE, DK, PL, CZ) = Eurostat HICP, CA = Statistics Canada CPI, AU = Australian Bureau of Statistics CPI.
Reply with a single JSON object and nothing else:
{"thought": "<one short sentence>", "actions": [{"action": "<name>", "args": {...}}, ...]}
"actions" holds 1 to 8 actions executed in order. Batch actions that do not depend on each other's results
(for example one discover_and_onboard or use_memory_mapping per missing pair) so the task needs few turns.
Prefer discover_and_onboard; use discover_series and onboard_series only to choose a candidate other than the best one.
Actions:
- recall_memory {"query": str}            : search long-term memory (series mappings, pricing policy) before doing work again.
- discover_series {"country": "<market code>", "concept": str} : ask the agency which series matches; reports discontinued datasets and coarser categories.
- onboard_series {"country": "<market code>", "concept": str, "candidate": int} : register the chosen candidate as a Zetaris REST table + view and verify it returns rows. Use candidate index from discover_series.
- discover_and_onboard {"country": "<market code>", "concept": str} : discover, then onboard the best candidate (falls back to the next candidate if onboarding fails).
- use_memory_mapping {"country": "<market code>", "concept": str} : reuse a remembered, already-onboarded Zetaris view instead of discovering again.
- compare {} : run ONE federated SQL across all onboarded views in Zetaris (needed before finish).
- finish {} : write the brief. Only valid after compare succeeded.
Only the market codes above exist; never plan actions for other markets (they are reported to the user as not covered).
Rules: every (country, concept) pair in the task needs a view (from memory or onboarding) before compare. If onboarding fails, try the next candidate or another frequency. Never invent numbers.`;

export class PriceSignalAgent extends EventEmitter {
  private llm: typeof chat;
  private discoverFn: typeof discover;
  private onboardFn: typeof onboard;
  private maxSteps: number;
  private compareRetryMs: number;
  /** The last parse fell back to the rules (no usable model reply). */
  private requestReadByRules = false;
  private providerSlow = false;
  private hedgeMs: number;
  /** Total planner reply time after which the remaining series are completed without the planner. */
  private planBudgetMs: number;
  /** the Zetaris runner as this agent uses it: allowlist, trace, and this run's own statement numbers (Q1, Q2, ...) */
  private sql: SqlRunner;
  private cite = 0;
  private metrics: RunMetrics = { modelCalls: 0, plannerCalls: 0, discoveries: 0, reusedViews: 0 };
  private cached = new Set<string>(); // raw REST tables served from the Zetaris cache in this run
  private semantic?: { name: string; sql: string; members: string[] }; // the semantic view the comparison read
  readonly trace: TraceEvent[] = [];
  readonly sqlLog: SqlResult[] = [];

  constructor(private deps: AgentDeps) {
    super();
    const base = deps.llm ?? chat;
    this.llm = (async (messages: any, opts: any = {}) => {
      this.metrics.modelCalls++;
      if (messages[0]?.content === SYSTEM_PLANNER) this.metrics.plannerCalls++;
      const o = this.providerSlow ? { ...opts, attempts: 1, timeoutMs: Math.min(opts.timeoutMs ?? 45_000, 45_000) } : opts;
      try {
        return await base(messages, o);
      } catch (e) {
        // A hedged request we cancelled ourselves says nothing about the provider.
        if (/Abort|HTTP 5\d\d|fetch failed|ETIMEDOUT/i.test(String(e)) && !this.providerSlow && !opts.signal?.aborted) {
          this.providerSlow = true;
          this.log("warn", "model provider is slow right now - shorter time budget for the rest of this run (deterministic fallbacks keep the brief complete)");
        }
        throw e;
      }
    }) as typeof chat;
    this.discoverFn = deps.discoverFn ?? discover;
    this.onboardFn = deps.onboardFn ?? onboard;
    this.maxSteps = deps.maxSteps ?? 18;
    this.compareRetryMs = deps.compareRetryMs ?? 2000;
    this.hedgeMs = deps.hedgeMs ?? (process.env.PSIG_HEDGE_MS === "off" ? Infinity : Number(process.env.PSIG_HEDGE_MS || 10_000));
    this.planBudgetMs = deps.planBudgetMs ?? Number(process.env.PSIG_PLAN_BUDGET_MS || 25_000);
    const run = deps.sql.run.bind(deps.sql);
    this.sql = { run: async (sql, opts) => {
      // One statement per call, and only SELECT, onboarding DDL or caching a source table (quoted text may contain anything).
      const bare = sqlOutsideQuotes(sql);
      if (!/^\s*(SELECT\b|CREATE\s+(LIGHTNING\s+(DATABASE|REST\s+TABLE)|SCHEMASTORE\s+(CONTAINER|VIEW)|OR\s+REPLACE\s+SCHEMASTORE\s+VIEW)\b|(?:UN)?CACHE\s+(?:LAZY\s+)?TABLE\b)/i.test(sql) || bare === undefined || /;\s*\S/.test(bare)) {
        this.log("error", `blocked statement (only SELECT, onboarding DDL and CACHE/UNCACHE TABLE are allowed): ${sql.split("\n")[0].slice(0, 80)}`);
        throw new Error("statement blocked by the SQL allowlist");
      }
      let res: SqlResult;
      try {
        res = { ...(await run(sql, opts)), id: `Q${++this.cite}` };
      } catch (e) {
        // Onboarding DDL is idempotent; an object Zetaris already has is shown, not hidden.
        if (/^\s*CREATE\b/i.test(sql) && /already exists|AlreadyExists|duplicate/i.test(String(e))) this.log("sql", `already in Zetaris (not created again): ${sql.split("\n")[0].slice(0, 90)}`, { sql, existed: true });
        throw e;
      }
      this.sqlLog.push(res);
      this.log("sql", `${res.id}: ${sql.split("\n")[0].slice(0, 90)}`, { id: res.id, sql, rows: res.rows.length, ms: res.ms });
      return res;
    } };
  }

  /**
   * Hedged model call. Nemotron's latency through Nightshift swings from about 1 s to 40+ s between
   * consecutive calls, so if no reply has come after hedgeMs (or the first request fails early), the same
   * request is sent once more and the first reply wins. Fast calls never send the second request.
   */
  // The second request goes without the thinking switch: through Nightshift, switched requests went to its NVIDIA lane
  // only, and when that lane failed ("All candidate providers failed", 27 Oct 18:39) nothing else could answer.
  private hedged(what: string, call: (signal: AbortSignal, opts: { thinking?: boolean }) => Promise<ChatResult>): Promise<ChatResult> {
    if (!Number.isFinite(this.hedgeMs)) return call(new AbortController().signal, {});
    const otherLane = thinkingOff();
    return new Promise<ChatResult>((resolve, reject) => {
      let launched = 0;
      let failed = 0;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const inFlight: AbortController[] = [];
      const hedge = (why: string) => {
        if (done || launched > 1) return;
        clearTimeout(timer);
        this.log("warn", `${what}: ${why} - sent the same request again${otherLane ? " without the thinking switch (another Nightshift lane can answer)" : ""}; the first reply wins`);
        launch();
      };
      const launch = () => {
        const n = ++launched;
        const ctl = new AbortController();
        inFlight.push(ctl);
        call(ctl.signal, n === 2 && otherLane ? { thinking: true } : {}).then(
          (r) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            // The other request is cancelled; its error is expected and not a sign of a slow provider.
            for (const c of inFlight) if (c !== ctl) c.abort(new Error("cancelled: the other request answered first"));
            if (n === 2) this.log("llm", `${what}: the second request answered first (${r.ms} ms)`);
            resolve(r);
          },
          (e) => {
            if (done) return;
            if (++failed === 2) {
              done = true;
              reject(e);
            } else if (launched === 1) hedge(`the first request failed (${String(e).slice(0, 80)})`);
          },
        );
      };
      launch();
      timer = setTimeout(() => hedge(`no reply after ${Math.round(this.hedgeMs / 1000)} s`), this.hedgeMs);
    });
  }

  private log(kind: string, title: string, detail?: unknown): void {
    const ev = { t: Date.now(), kind, title, detail };
    this.trace.push(ev);
    this.emit("event", ev);
  }

  /** Cache a remembered series' raw REST table before probing it; on a table Zetaris already caches this calls no agency. */
  private async cacheRemembered(m: SeriesMapping): Promise<void> {
    const c = { agency: m.agency, country: m.country, dataset: m.dataset, code: m.code, label: m.label, frequency: m.frequency, measure: "index", status: "active", sourceUrl: m.sourceUrl ?? "" } as unknown as Candidate;
    const ref = m.rawTable ?? rawTableRef(c, m.concept as Concept);
    const r = await ensureCached(this.sql, ref, m.sourceUrl ? { reachable: () => sourceAnswers(m.sourceUrl!, m.agency) } : {});
    if (r.ok) this.cached.add(ref);
    if (r.action === "kept-stale") this.log("warn", `${m.country} ${m.concept}: the agency did not answer, so its Zetaris cache from ${new Date(r.cachedAt!).toISOString().slice(0, 16)} UTC is used`);
  }

  // ---------- 1. understand the messy request ----------
  async parse(raw: string): Promise<Request> {
    const prompt = `Extract the pricing request as JSON with keys:
countries (array of strings as the user wrote them), concept (one of: food, all_items, snacks, condiments, or a short noun), concept_words (2-4 lowercase words an official statistics label might use),
proposed_change_pct (signed number or null, preserve price reductions), cost_increase_pct (signed number or null, only if the user states how much their own costs changed), cost_share_pct (0..100 or null, only if the user states unit cost / selling price as a percentage; the cost can be before or after the stated change and the selling-price denominator must stay unchanged), pass_through (0..1 or null, the share of the monetary cost increase to recover in selling prices), policy_statement (string or null).
These percentages have different denominators: never infer cost_share_pct from a cost increase, pass-through policy, or proposed change. Tax, VAT, margin, observed inflation and past price changes are not a new proposed price change. Preserve decimal fractions and explicit signs. Countries must be named in the request; never replace a named market with another. For "same as last time", return null for values the user did not change. Do not invent a cost share or its before/after timing. The concept is the category whose inflation or prices the user asks to compare; product names introducing their business do not override an explicit comparison category.
Request: """${forModel(raw)}"""
Reply with JSON only.`;
    let j: any = {};
    this.requestReadByRules = true;
    try {
      // With thinking off the reply is ~50-90 tokens in 1-3 s; a small limit and a short timeout turn a stuck reply
      // into a fast fallback to the rules (27 Oct: requests with "can we go +3%" failed after 25-29 s at 2,048 tokens).
      const r = await this.hedged("request parsing", (signal, o) => this.llm([{ role: "user", content: prompt }], { lane: "fast", temperature: 0, attempts: 1, ...(thinkingOff() ? { maxTokens: 600, timeoutMs: 15_000 } : { timeoutMs: 60_000 }), signal, ...o }));
      const parsed = extractJson(r.text);
      if (parsed) this.requestReadByRules = false;
      j = parsed ?? {};
      if (parsed) this.log("llm", `parsed request (${r.model}, ${r.ms} ms${via(r)})`, j);
      else this.log("warn", `request parsing: the model reply had no usable JSON - the request was read by rules (${r.model}, ${r.ms} ms)`, { reply: r.text.slice(0, 2000) });
    } catch (e) {
      this.log("warn", `LLM parse failed, using rules: ${String(e).slice(0, 120)}`);
    }
    const named: string[] = Array.isArray(j.countries) ? j.countries.map(String) : [];
    const explicitMarkets = requestMarkets(raw, named);
    const countries = explicitMarkets.countries;
    const unknown = explicitMarkets.unknown;
    const intent = explicitMarketConcept(raw);
    const concept = intent.concept ?? (cleanConcept(j.concept) || "food");
    const modelWords: string[] = Array.isArray(j.concept_words) ? j.concept_words.filter((w: unknown): w is string => typeof w === "string" && !!w.trim()).map((w: string) => w.toLowerCase()) : [];
    const words = intent.concept ? CONCEPT_WORDS[concept] : modelWords.length ? modelWords : CONCEPT_WORDS[concept] ?? [concept];
    // "same as last time": start from the request H-MEM remembered, keep only what the user changed.
    const sameAsLast = sameAsLastRequest(raw);
    const last = sameAsLast ? this.deps.memory.lastRequest() : undefined;
    if (last) {
      const changed = requestMarkets(raw, [...named, ...(last.request.unknownCountries ?? [])]);
      const changedMarkets = changed.countries.length || changed.unknown.length;
      countries.splice(0, countries.length, ...(changedMarkets ? changed.countries : last.request.countries as Country[]));
      unknown.splice(0, unknown.length, ...(changedMarkets ? changed.unknown : last.request.unknownCountries ?? []));
      this.log("memory", `recalled last request ${last.id}: markets ${last.request.countries.join(", ")}${last.request.unknownCountries?.length ? `; not covered: ${last.request.unknownCountries.join(", ")}` : ""}, category "${last.request.concept}"${last.request.proposedChangePct !== undefined ? `, ${signedPct(last.request.proposedChangePct)}` : ""}`);
    }
    // Nothing named and nothing remembered: the demo markets, said in the brief. Only unsupported markets named: none.
    const defaultMarkets = !countries.length && !unknown.length;
    if (defaultMarkets) countries.push("DE", "CA", "AU");
    const percentages = requestPercentages(raw, j);
    if (percentages.proposalWords && percentages.proposedChangePct !== undefined) this.log("llm", `proposal read by Nemotron from words: "${percentages.proposalWords}" -> ${percentages.proposedChangePct > 0 ? "+" : ""}${percentages.proposedChangePct}%`);
    const { passThrough, costIncreasePct: costPct, costSharePct, proposedChangePct: explicitPct } = percentages;
    const share = percentages.invalidCostShare ? undefined : costSharePct ?? last?.request.costSharePct;
    const basis = requestCostShareBasis(raw, share, costSharePct !== undefined, percentages.costContext, last?.request.costShareBasis);
    const req: Request = {
      raw,
      countries,
      concept: intent.concept ?? last?.request.concept ?? concept,
      conceptWords: intent.concept ? words : last?.request.conceptWords ?? words,
      proposedChangePct: percentages.invalidProposal ? undefined : explicitPct ?? last?.request.proposedChangePct,
      passThrough,
      costIncreasePct: percentages.invalidCostChange ? undefined : costPct ?? last?.request.costIncreasePct,
      costRemembered: !percentages.invalidCostChange && costPct === undefined && last?.request.costIncreasePct !== undefined ? true : undefined,
      costSharePct: share,
      costShareBasis: basis.value,
      costShareRemembered: !percentages.invalidCostShare && costSharePct === undefined && last?.request.costSharePct !== undefined ? true : undefined,
      invalidPassThrough: percentages.invalidPassThrough || undefined,
      inputIssues: [...percentages.issues, ...intent.issues, ...basis.issues].length ? [...percentages.issues, ...intent.issues, ...basis.issues] : undefined,
      policyStatement: j.policy_statement ? String(j.policy_statement) : undefined,
      unknownCountries: unknown,
      defaultMarkets: defaultMarkets || undefined,
    };
    this.log("request", `markets ${countries.join(", ")} | category "${req.concept}"${req.proposedChangePct !== undefined ? ` | proposed ${signedPct(req.proposedChangePct)}` : ""}${req.costIncreasePct !== undefined ? ` | costs ${signedPct(req.costIncreasePct)}` : ""}${unknown.length ? ` | not covered: ${unknown.join(", ")}` : ""}`, req);
    return req;
  }

  // ---------- 2. act until every market has a governed view ----------
  async run(raw: string): Promise<Brief> {
    const t0 = Date.now();
    const startedAt = new Date(t0).toISOString();
    const req = await this.parse(raw);
    const memory = this.deps.memory;
    if (req.passThrough !== undefined) {
      const prev = memory.latestPolicy();
      if (prev?.policy !== undefined && Math.abs(prev.policy - req.passThrough) > 1e-9) {
        this.log("memory", `policy changed: ${Math.round(prev.policy * 100)}% (${prev.id}) -> ${Math.round(req.passThrough * 100)}%; the old preference is superseded, not deleted`);
      }
      if (prev?.policy !== undefined && Math.abs(prev.policy - req.passThrough) <= 1e-9) {
        this.log("memory", `policy unchanged at ${Math.round(req.passThrough * 100)}% (${prev.id})`);
      } else {
        const id = memory.rememberPolicy(req.passThrough, req.policyStatement ?? `pass through ${Math.round(req.passThrough * 100)}%`);
        this.log("memory", `stored pricing policy ${id}`);
      }
    }
    const concepts: Concept[] = req.concept === "all_items" ? ["all_items"] : [req.concept, "all_items"];
    const pairs = req.countries.flatMap((country) => concepts.map((concept) => ({ country, concept })));
    const views = new Map<string, { view: string; label: string; via: "memory" | "onboarded"; note?: string; memoryId?: string }>();
    const candidates = new Map<string, Candidate[]>();
    const notes: string[] = [...(req.inputIssues ?? [])];
    for (const u of req.unknownCountries) notes.push(`${u}: not covered yet - PriceSignal currently reads Eurostat (EU markets), Statistics Canada (CA) and ABS (AU).`);
    if (req.defaultMarkets) notes.push(this.requestReadByRules
      ? `No supported market was recognised in the question (the model could not read it, so only exact market names were matched); the brief covers the default markets ${req.countries.join(", ")}.`
      : `No market was named in the question, so the brief covers the default markets ${req.countries.join(", ")}.`);
    if (!req.countries.length) {
      // Only markets PriceSignal does not cover were named: say so instead of answering for markets nobody asked about.
      memory.rememberRequest(req);
      const brief: Brief = { request: req, startedAt, calculatedAt: new Date().toISOString(), facts: [], notes, passThrough: req.passThrough ?? memory.latestPolicy()?.policy ?? 1, compared: { id: "-", sql: "", columns: COMPARE_COLUMNS, rows: [], ms: 0 }, sqlLog: this.sqlLog, views: [], ms: Date.now() - t0, trace: this.trace };
      brief.markdown = renderBrief(brief);
      this.log("done", `none of the markets in the question is covered (${req.unknownCountries.join(", ")}) - nothing to compare`);
      return brief;
    }
    const key = (c: string, k: string) => `${c}:${k}`;

    const rememberedPairs = pairs.filter((p) => memory.findMapping(p.country, p.concept)?.mapping);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PLANNER },
      { role: "user", content: `Task: ${JSON.stringify({ request: forModel(raw), needed: pairs, concept_words: req.conceptWords, in_memory: rememberedPairs })}` },
    ];
    let compared: SqlResult | undefined;
    let comparedViews = -1; // views.size when the last federated query ran
    let badReplies = 0;
    let stalledTurns = 0; // planner turns in a row that changed nothing
    let compareFailures = 0;
    let compareError = "";
    let autopilot = rememberedPairs.length === pairs.length;
    let plannerMs = 0; // time spent waiting for planner replies in this run
    if (autopilot) this.log("plan", "all needed series have remembered mappings - skipping the planner; verifying the live Zetaris views");

    // A pair is settled when it has a view, or when its agency was asked and has no usable series (":gaveup").
    const unsettled = () => pairs.filter((p) => !views.has(key(p.country, p.concept)) && !candidates.has(key(p.country, p.concept) + ":gaveup"));
    const progress = () => `${views.size}|${unsettled().length}|${candidates.size}|${compared ? comparedViews : -1}`;
    for (let step = 0; step < this.maxSteps; step++) {
      const missing = unsettled();
      let batch: { action: string; args: any }[] = [];
      if (step === 0 && autopilot) batch = pairs.map((p) => ({ action: "use_memory_mapping", args: p }));
      if (!missing.length && !views.size) break;
      if (!missing.length && (!compared || comparedViews !== views.size)) {
        // Every needed series is ready: the federated comparison is the only sensible next step, no model turn needed.
        this.log("plan", "all needed series are ready - running the federated comparison");
        batch = [{ action: "compare", args: {} }];
      } else if (!autopilot) {
        try {
          const asked = Date.now();
          const r = await this.hedged("planner", (signal, o) => this.llm(messages, { lane: "fast", temperature: 0.1, maxTokens: thinkingOff() ? 1500 : 6000, attempts: 1, timeoutMs: 75_000, signal, ...o }));
          plannerMs += Date.now() - asked;
          const j = extractJson(r.text);
          batch = Array.isArray(j?.actions) ? j.actions.filter((a: any) => a?.action).slice(0, 8) : j?.action ? [j] : [];
          if (!batch.length) throw new Error(`no action in: ${r.text.slice(0, 120)}`);
          messages.push({ role: "assistant", content: JSON.stringify({ thought: j.thought, actions: batch }) });
          this.log("plan", `${batch.map((b) => `${b.action} ${JSON.stringify(b.args ?? {})}`).join(" · ")}  [${r.model}${via(r)}]`, { thought: j.thought, model: r.model, ms: r.ms });
        } catch (e) {
          badReplies++;
          this.log("warn", `planner reply had no action JSON (${badReplies}) - asked again`, { reply: String(e).slice(0, 300) });
          messages.push({ role: "user", content: 'That was not the action JSON. Do not answer the pricing question yourself. Reply with ONLY {"thought": "...", "actions": [{"action": "...", "args": {...}}]}.' });
          if (badReplies >= 2) {
            autopilot = true;
            this.log("warn", "switching to deterministic autopilot for the remaining steps");
          }
          continue;
        }
      }
      if (autopilot && !batch.length) {
        const a = nextAutopilot(missing, candidates, views, compared, memory, key);
        batch = a ? [a] : [];
      }
      if (!batch.length) break;

      const observations: unknown[] = [];
      let finished = false;
      const sctx = { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c: SqlResult) => { compared = c; comparedViews = views.size; } };
      const plannerTurn = !autopilot;
      const before = progress();
      const results = await this.executeBatch(batch, req, sctx);
      for (let i = 0; i < batch.length; i++) {
        const error = (results[i] as { error?: string } | undefined)?.error;
        if (batch[i].action === "compare" && error && error !== "no views yet") {
          compareFailures++;
          compareError = error;
        }
      }
      if (compareFailures >= MAX_COMPARE_FAILURES && !compared) break;
      if (compareFailures && !compared && batch.some((b) => b.action === "compare")) await new Promise((r) => setTimeout(r, this.compareRetryMs * compareFailures));
      if (plannerTurn && !autopilot && plannerMs > this.planBudgetMs && unsettled().length) {
        // A slow provider that still makes progress could otherwise take minutes: the remaining pairs need no judgement.
        autopilot = true;
        this.log("warn", `planner replies took ${Math.round(plannerMs / 1000)} s in total - completing the remaining series deterministically`);
      }
      if (plannerTurn) {
        stalledTurns = progress() === before ? stalledTurns + 1 : 0;
        if (stalledTurns >= 2) {
          // Valid JSON that repeats itself would otherwise use every step: finish the remaining pairs deterministically.
          autopilot = true;
          this.log("warn", "planner made no progress for 2 turns - switching to deterministic autopilot for the remaining steps");
        }
      }
      // Pairs the agent has not even tried to discover yet (a pair that was tried and has no series may legitimately stay missing).
      const untried = pairs.filter((p) => !views.has(key(p.country, p.concept)) && !candidates.has(key(p.country, p.concept)));
      for (let i = 0; i < batch.length; i++) {
        observations.push({ action: batch[i].action, args: batch[i].args, result: results[i] });
        // A finish is accepted only over a comparison of every onboarded series, with nothing left untried.
        if (batch[i].action === "finish" && compared && comparedViews === views.size && !untried.length) finished = true;
      }
      if (!autopilot && batch.some((b) => b.action === "finish") && untried.length) {
        // The planner wants to stop while series are still missing: complete them deterministically instead of asking again.
        this.log("plan", `planner tried to finish with ${untried.map((p) => `${p.country} ${p.concept}`).join(", ")} still missing - completing them without another planner turn`);
        autopilot = true;
      }
      if (!autopilot) messages.push({ role: "user", content: `Observations: ${JSON.stringify(observations).slice(0, 3500)}\nStill missing: ${JSON.stringify(unsettled())}\nNext: reply with the action JSON only.` });
      if (!finished && compared && comparedViews === views.size && !unsettled().length) {
        // Everything needed is onboarded and compared: finishing needs no extra model call.
        this.log("plan", "all markets compared - finishing without another planner turn");
        finished = true;
      }
      if (finished) break;
    }

    if (!compared && views.size && compareFailures < MAX_COMPARE_FAILURES) {
      // Guardrail: never leave without the federated query if any view exists.
      const r = (await this.execute({ action: "compare", args: {} }, req, { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c) => (compared = c) })) as { error?: string } | undefined;
      if (r?.error) {
        compareFailures++;
        compareError = r.error;
      }
    }
    if (!compared && views.size) throw new Error(`The federated comparison over ${views.size} onboarded views failed ${compareFailures} time${compareFailures === 1 ? "" : "s"}: ${compareError.replace(/^Error: /, "")}`);
    if (!compared) throw new Error("No market could be onboarded; see trace.");

    // ---------- 3. facts are computed by code, narrative by the model ----------
    const remembered = req.passThrough === undefined && !req.invalidPassThrough ? memory.latestPolicy() : undefined;
    const policy = req.passThrough ?? remembered?.policy ?? 1.0;
    const policySource = req.invalidPassThrough ? "invalid input; cost-recovery target omitted" : req.passThrough !== undefined ? "stated in this request" : remembered ? `remembered from an earlier request (${remembered.id})` : "default: recover the full monetary cost increase (no policy given)";
    if (remembered) this.log("memory", `using remembered pricing policy ${remembered.id}: ${Math.round(policy * 100)}%`);
    const calculatedAt = new Date().toISOString();
    const calculationTime = new Date(calculatedAt);
    const facts: MarketFacts[] = buildFacts(rowsAsObjects(compared, COMPARE_COLUMNS), req, compared.id, policy, calculationTime);
    const alignment = buildAlignment(rowsAsObjects(compared, COMPARE_COLUMNS), req, facts, compared.id, calculationTime);
    for (const p of pairs) {
      const k = key(p.country, p.concept);
      // An agency that did not answer already has its own note.
      if (views.has(k) || candidates.has(k + ":noanswer")) continue;
      notes.push(candidates.has(k) ? `${p.country} ${p.concept}: no usable official series was found.` : `${p.country} ${p.concept}: not checked in this run.`);
    }
    const ctx = { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c: SqlResult) => (compared = c) };
    const ensureView = async (country: Country, concept: Concept) => {
      if (!views.has(key(country, concept)) && memory.findMapping(country, concept)?.mapping) await this.execute({ action: "use_memory_mapping", args: { country, concept } }, req, ctx);
      if (!views.has(key(country, concept))) await this.execute({ action: "discover_and_onboard", args: { country, concept } }, req, ctx);
      return views.get(key(country, concept));
    };
    const snapshotMetrics = (): RunMetrics => ({ ...this.metrics, reusedViews: [...views.values()].filter((v) => v.via === "memory").length, cachedTables: this.cached.size });
    // Market facts are useful immediately; do not hide them behind slower SKU discovery and pricing.
    this.metrics.numbersMs = Date.now() - t0;
    const marketPartial: Brief = { request: req, startedAt, calculatedAt, facts, alignment, notes: [...notes], passThrough: policy, policySource, compared, semanticView: this.semantic, sqlLog: [...this.sqlLog], views: [...views.entries()].map(([k, v]) => ({ key: k, ...v })), ms: this.metrics.numbersMs, trace: [...this.trace], metrics: snapshotMetrics(), partialStage: "markets" };
    this.log("progress", `market numbers ready in ${(this.metrics.numbersMs / 1000).toFixed(1)} s - pricing SKUs and writing the summary`);
    this.emit("partial", marketPartial);
    // The narrative only needs the market facts, so the model writes it while Zetaris prices the SKUs.
    const narrativeP = this.narrate(req, facts, [...notes], policy);
    const pricing = await this.priceList(req, views, facts, policy, ensureView, notes);
    const sinceLast = this.compareWithLastBrief(facts, req, policy);
    // Everything in the brief except the prose is ready: let the UI show it while the model finishes writing.
    const partial: Brief = { request: req, startedAt, calculatedAt, facts, alignment, notes, passThrough: policy, policySource, skus: pricing?.skus, pricingQuery: pricing?.query, sinceLast, compared, semanticView: this.semantic, sqlLog: [...this.sqlLog], views: [...views.entries()].map(([k, v]) => ({ key: k, ...v })), ms: Date.now() - t0, trace: [...this.trace], metrics: snapshotMetrics(), partialStage: "pricing" };
    this.emit("partial", partial);
    const { narrative, issue: narrativeIssue } = await narrativeP;
    memory.rememberRequest(req);
    const brief: Brief = { request: req, startedAt, calculatedAt, facts, alignment, notes, narrative, narrativeIssue, passThrough: policy, policySource, skus: pricing?.skus, pricingQuery: pricing?.query, sinceLast, compared, semanticView: this.semantic, sqlLog: this.sqlLog, views: [...views.entries()].map(([k, v]) => ({ key: k, ...v })), ms: Date.now() - t0, trace: this.trace, metrics: snapshotMetrics() };
    brief.markdown = renderBrief(brief);
    this.log("done", `brief ready in ${Math.round(brief.ms / 1000)} s (${this.sqlLog.length} SQL statements, ${[...views.values()].filter((v) => v.via === "memory").length} views reused from memory; ${this.metrics.modelCalls} model calls, ${this.metrics.plannerCalls} planner calls, ${this.metrics.discoveries} discoveries)`);
    return brief;
  }

  /**
   * Series actions (memory reuse, discovery, onboarding) for different agencies run in parallel;
   * actions for the same agency, and everything else (compare, finish), keep the planner's order.
   */
  private async executeBatch(batch: { action: string; args: any }[], req: Request, s: ExecCtx): Promise<unknown[]> {
    const results: unknown[] = new Array(batch.length);
    const seriesActions = new Set(["use_memory_mapping", "discover_series", "discover_and_onboard", "onboard_series"]);
    const series = batch.map((a, i) => ({ a, i })).filter(({ a }) => seriesActions.has(a.action) && normalizeCountry(String(a.args?.country ?? "")));
    if (series.length > 1) {
      await byAgency(series.map((x) => ({ ...x, country: normalizeCountry(String(x.a.args.country))! })), async (x) => {
        results[x.i] = await this.execute(x.a, req, s);
      });
    } else for (const x of series) results[x.i] = await this.execute(x.a, req, s);
    for (let i = 0; i < batch.length; i++) if (results[i] === undefined) results[i] = await this.execute(batch[i], req, s);
    return results;
  }

  private async execute(action: { action: string; args: any }, req: Request, s: ExecCtx): Promise<unknown> {
    const a = action.args ?? {};
    const memory = this.deps.memory;
    const country = normalizeCountry(String(a.country ?? "")) ?? undefined;
    const concept: Concept = cleanConcept(a.concept) || req.concept;
    try {
      switch (action.action) {
        case "recall_memory": {
          const { items } = memory.recall(String(a.query ?? `${req.countries.join(" ")} ${req.concept} series mapping pricing policy`));
          this.log("memory", `recalled ${items.length} memories`, items.map((i) => i.content));
          return items.slice(0, 8).map((i) => ({ id: i.id, content: i.content }));
        }
        case "use_memory_mapping": {
          if (!country) return { error: "country must be one of the supported market codes" };
          s.candidates.set(s.key(country, concept) + ":memtried", []);
          const hit = memory.findMapping(country, concept);
          if (!hit?.mapping) {
            // Nothing in H-MEM for this pair: discover it now instead of spending another planner turn on the error.
            this.log("memory", `nothing remembered for ${country} ${concept} - discovering it`);
            return { not_in_memory: true, discovered: await this.execute({ action: "discover_and_onboard", args: { country, concept } }, req, s) };
          }
          if (memory.hmem.store.get(hit.id)?.tags.includes("review")) {
            const note = `${country} ${concept}: the remembered mapping is marked for review; it must be rediscovered and verified before reuse.`;
            if (!s.notes.includes(note)) s.notes.push(note);
            this.log("memory", `mapping ${hit.id} is marked for review - not reusing it`);
            return { error: "remembered mapping requires review; discover and verify an official series again" };
          }
          const decoderVersion = sourceDecoderVersion(AGENCY_FOR[country].agency);
          if ((hit.mapping.decoderVersion ?? 1) !== decoderVersion) {
            const note = `${country} ${concept}: the series decoder changed; the old mapping must be rediscovered and verified before reuse.`;
            if (!s.notes.includes(note)) s.notes.push(note);
            this.log("memory", `mapping ${hit.id} uses decoder ${hit.mapping.decoderVersion ?? 1}; decoder ${decoderVersion} requires fresh onboarding`);
            return { error: "remembered decoder version is obsolete; discover and verify the current decoder" };
          }
          if (!marketCategoryUsable(concept, hit.mapping)) {
            const note = `${country}: remembered ${hit.mapping.label} is not usable for the requested ${concept} comparison; checking official alternatives.`;
            if (!s.notes.includes(note)) s.notes.push(note);
            memory.feedback(hit.id, "not_helpful");
            this.log("memory", `rejected ${hit.id}: ${hit.mapping.label} does not cover the requested ${concept} category`);
            return { error: "remembered category failed the market coverage guard; discover again" };
          }
          await this.cacheRemembered(hit.mapping);
          const probe = await this.sql.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${hit.mapping.view} WHERE yoy_pct IS NOT NULL`);
          const count = probe.rows[0]?.[0];
          const latest = probe.rows[0]?.[1];
          if (!isUsableObservationCount(count) || !hasFreshPeriod(latest, hit.mapping.frequency)) {
            this.log("memory", `remembered view psig.${hit.mapping.view} has invalid, empty, future or stale observations (latest ${String(latest ?? "unknown")}) - not reusing it`);
            return { error: `remembered view psig.${hit.mapping.view} has no usable fresh dated rows; discover_and_onboard again` };
          }
          const n = Number(count);
          const kept = durableNotes(hit.mapping.note);
          s.views.set(s.key(country, concept), { view: hit.mapping.view, label: hit.mapping.label, via: "memory", note: kept, memoryId: hit.id });
          const remembered = `${country}: ${kept} (remembered from an earlier run)`;
          if (kept && !s.notes.includes(remembered)) s.notes.push(remembered);
          memory.feedback(hit.id, "helpful");
          this.log("memory", `reused ${hit.id}: ${country} ${concept} -> psig.${hit.mapping.view} (${n} rows, latest ${probe.rows[0]?.[1]})`);
          return { ok: true, view: hit.mapping.view, rows: n, latest: probe.rows[0]?.[1] };
        }
        case "discover_series": {
          if (!country) return { error: "country must be one of the supported market codes" };
          const words = concept === req.concept ? req.conceptWords : undefined;
          let d: Awaited<ReturnType<typeof discover>>;
          try {
            this.metrics.discoveries++;
            d = await this.discoverFn(country, concept, words);
          } catch (e) {
            // An agency that does not answer counts as tried: report it once instead of asking it again every step.
            s.candidates.set(s.key(country, concept), []);
            s.candidates.set(s.key(country, concept) + ":gaveup", []);
            s.candidates.set(s.key(country, concept) + ":noanswer", []);
            const note = `${country}: ${AGENCY_FOR[country].name} did not answer for "${concept}" (${humanError(e)}).`;
            if (!s.notes.includes(note)) s.notes.push(note);
            this.log("warn", `${AGENCY_FOR[country].name} did not answer for ${country} ${concept}: ${String(e).slice(0, 120)}`);
            return { error: "agency did not answer", candidates: [] };
          }
          const rejected = d.candidates.filter(c => !marketCategoryUsable(concept, c));
          d = { ...d, candidates: d.candidates.filter(c => marketCategoryUsable(concept, c)).map(c => concept !== "food" && concept !== "all_items" && isOfficialBroadFood(c) ? { ...c, isBroadFallback: true } : c), notes: [...d.notes] };
          if (rejected.length) d.notes.push(`Excluded ${rejected.map(c => c.label).join("; ")} from ${concept}: a sweet-only or unverified broad category cannot stand in for this market comparison.`);
          // One deterministic Food lookup is enough when the narrow shortlist has no usable candidate.
          if (concept === "snacks" && !d.candidates.length) {
            try {
              this.metrics.discoveries++;
              const broad = await this.discoverFn(country, "food", CONCEPT_WORDS.food);
              d.candidates.push(...broad.candidates.filter(isOfficialBroadFood).map(c => ({ ...c, isBroadFallback: true })));
              d.notes.push(...broad.notes);
            } catch (e) {
              d.notes.push(`The official Food alternative could not be checked (${String(e).replace(/^Error: /, "").slice(0, 80)}).`);
            }
            if (!d.candidates.length) d.notes.push(`No usable snack category or verified official Food alternative was found; this market category is omitted.`);
          }
          s.candidates.set(s.key(country, concept), d.candidates);
          if (!d.candidates.length) s.candidates.set(s.key(country, concept) + ":gaveup", []);
          for (const n of d.notes) if (!s.notes.includes(`${country}: ${n}`)) s.notes.push(`${country}: ${n}`);
          (s.candidates as any).set(s.key(country, concept) + ":notes", d.notes);
          this.log("discover", `${AGENCY_FOR[country].name}: ${d.candidates.length} candidate(s) for "${concept}"`, d);
          return { candidates: d.candidates.map((c, i) => ({ i, dataset: c.dataset, code: c.code, label: c.label, frequency: c.frequency, lastPeriod: c.lastPeriod })), notes: d.notes };
        }
        case "discover_and_onboard": {
          if (!country) return { error: "country must be one of the supported market codes" };
          if (memory.findMapping(country, concept)?.mapping) {
            // Guardrail: H-MEM already knows this pair - reuse it (freshness is checked) before calling the agency again.
            const reused: any = await this.execute({ action: "use_memory_mapping", args: { country, concept } }, req, s);
            if (reused?.ok) {
              this.log("plan", `guardrail: ${country} ${concept} was already in H-MEM - reused it instead of discovering again`);
              return { reused_from_memory: reused };
            }
          }
          const k = s.key(country, concept);
          if (s.candidates.has(k + ":gaveup")) return { error: "already tried: this agency has no usable series for this pair" };
          const found: any = await this.execute({ action: "discover_series", args: { country, concept } }, req, s);
          const n = s.candidates.get(k)?.length ?? 0;
          if (!n) {
            s.candidates.set(k + ":gaveup", []);
            return { discovered: found, error: "no candidate series" };
          }
          let last: any;
          for (let i = 0; i < Math.min(n, 3); i++) {
            last = await this.execute({ action: "onboard_series", args: { country, concept, candidate: i } }, req, s);
            if (last?.ok) break;
          }
          if (!last?.ok) s.candidates.set(k + ":gaveup", []);
          return { notes: found?.notes, onboard: last };
        }
        case "onboard_series": {
          if (!country) return { error: "country must be one of the supported market codes" };
          const list = s.candidates.get(s.key(country, concept));
          if (!list?.length) {
            // Planned before its discovery (seen live on 27 Oct: one wasted planner turn per pair): discover it now.
            this.log("plan", `${country} ${concept}: onboarding was planned before discovery - discovering and onboarding it now`);
            return { discovered_first: true, result: await this.execute({ action: "discover_and_onboard", args: { country, concept } }, req, s) };
          }
          const c = list[Math.max(0, Math.min(list.length - 1, Number(a.candidate ?? 0)))];
          if (!c || !marketCategoryUsable(concept, c)) {
            this.log("warn", `refused ${c?.label ?? "invalid candidate"} for ${country} ${concept}: market coverage guard failed`);
            return { error: "candidate failed the market coverage guard; use a suitable category or verified Food alternative" };
          }
          let r = await this.onboardFn(this.sql, c, concept);
          if (r.ok && (!isUsableObservationCount(r.rows) || !hasFreshPeriod(r.latest, c.frequency))) {
            r = { ...r, ok: false, error: `view has no usable fresh dated rows (latest ${String(r.latest ?? "unknown")})` };
          }
          if (r.cached && r.rawTable) this.cached.add(r.rawTable);
          const how = onboardingSummary(r);
          this.log("onboard", `${r.ok ? "onboarded" : "FAILED"} ${c.agency} ${c.code} -> psig.${r.view}${r.ok ? ` (${how}: ${r.rows} rows, latest ${r.latest})` : `: ${humanError(r.error)}`}`, { candidate: c, result: { ...r, sql: r.sql } });
          if (r.ok) {
            const own: string[] = [...((s.candidates as any).get(s.key(country, concept) + ":notes") ?? [])];
            if (c.isBroadFallback || concept !== "food" && concept !== "all_items" && isOfficialBroadFood(c)) {
              const broader = `${c.label} is used as a broader category proxy (coarser) for ${concept}.`;
              own.push(broader);
              s.notes.push(`${country}: ${broader}`);
            }
            const note = own.join(" ") || undefined;
            s.views.set(s.key(country, concept), { view: r.view, label: c.label, via: "onboarded", note });
            const id = memory.rememberMapping({ country, concept, agency: c.agency, dataset: c.dataset, code: c.code, label: c.label, view: r.view, frequency: c.frequency, decoderVersion: sourceDecoderVersion(c.agency), note: durableNotes(note), rawTable: r.rawTable, sourceUrl: c.sourceUrl });
            this.log("memory", `stored mapping ${id}`);
          }
          return { ok: r.ok, view: r.view, rows: r.rows, latest: r.latest, error: r.error };
        }
        case "compare": {
          for (const p of s.pairs) {
            if (s.views.has(s.key(p.country, p.concept)) || !memory.findMapping(p.country, p.concept)?.mapping) continue;
            this.log("plan", `guardrail: the planner skipped ${p.country} ${p.concept}, which is remembered - reusing the remembered view before comparing`);
            await this.execute({ action: "use_memory_mapping", args: { country: p.country, concept: p.concept } }, req, s);
          }
          const vs = [...s.views.values()].map((v) => v.view);
          if (!vs.length) return { error: "no views yet" };
          // One business-facing Zetaris view over this run's agency views (the semantic layer); if it cannot be
          // created, the same comparison runs as a direct UNION ALL over the agency views.
          const sem = marketSemanticView(vs);
          let viaSemantic = false;
          try {
            await this.sql.run(sem.sql);
            this.semantic = sem;
            viaSemantic = true;
          } catch (e) {
            this.semantic = undefined;
            this.log("warn", `semantic view psig.${sem.name} could not be created (${String(e).slice(0, 120)}) - querying the agency views directly`);
          }
          let res: SqlResult | undefined;
          if (viaSemantic) {
            try {
              res = await this.sql.run(semanticCompareSql(sem.name, monthsBack(15)));
            } catch (e) {
              // Only a problem with the view itself is worked around here; an agency that does not answer would
              // fail the direct query too, and the bounded compare retries handle it.
              if (!/AnalysisException|Table or view not found|cannot resolve|ParseException/i.test(String(e))) throw e;
              this.semantic = undefined;
              viaSemantic = false;
              this.log("warn", `semantic view psig.${sem.name} was created but could not be read (${String(e).replace(/^Error: /, "").slice(0, 120)}) - querying the agency views directly`);
            }
          }
          res ??= await this.sql.run(compareSql(vs, monthsBack(15)));
          s.setCompared(res);
          this.log("compare", `federated query ${res.id} ${viaSemantic ? `on the semantic view psig.${sem.name} (${vs.length} agency views)` : `over ${vs.length} views`} -> ${res.rows.length} rows`);
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

  /**
   * Join the company's internal price list (a Zetaris REST table) with official inflation.
   * Narrow SKU categories use product-aware series choices or explicitly marked Food proxies.
   * Only legacy rows without product hints retain the requested-category fallback.
   */
  private async priceList(
    req: Request,
    views: Map<string, { view: string; label: string; via: "memory" | "onboarded"; note?: string; memoryId?: string }>,
    facts: MarketFacts[],
    policy: number,
    ensureView: (country: Country, concept: Concept) => Promise<{ view: string; label?: string; note?: string } | undefined>,
    notes: string[],
  ): Promise<{ skus: SkuLine[]; query: SqlResult } | undefined> {
    try {
      const ready = await ensurePriceList(this.sql);
      if (!ready.ok) {
        this.log("warn", `internal price list not available in Zetaris: ${String(ready.error).slice(0, 140)}`);
        return undefined;
      }
      if (ready.created) this.log("onboard", `registered the internal price list as Zetaris REST table ${PRICE_DB.toLowerCase()}.${priceTable()} + view psig.${priceView()}`);
      if (ready.cached && ready.rawTable) this.cached.add(ready.rawTable);
    } catch (e) {
      this.log("warn", `price list registration failed: ${String(e).slice(0, 160)}`);
      return undefined;
    }
    let allowLegacyFallback = false;
    try {
      const catRes = await this.sql.run(skuCategoriesSql(req.countries), { limit: PRICE_LIST_ROW_LIMIT });
      const grouped = new Map<string, { country: Country; concept: string; products: string[] }>();
      for (const row of catRes.rows) {
        const country = normalizeCountry(String(row[0]));
        const concept = cleanConcept(row[1]);
        const product = String(row[2] ?? "").trim();
        if (!country || !req.countries.includes(country) || !concept) continue;
        const key = `${country}:${concept}`;
        if (!grouped.has(key)) grouped.set(key, { country, concept, products: [] });
        if (product && !grouped.get(key)!.products.includes(product)) grouped.get(key)!.products.push(product);
      }
      const cats = [...grouped.values()];
      if (!cats.length) {
        notes.push(catRes.rows.length ? "No usable SKU category information was returned; SKU prices are omitted." : `Your price list has no products in ${req.countries.join(", ")}; SKU prices are omitted.`);
        return undefined;
      }
      allowLegacyFallback = cats.every(c => c.products.length === 0);
      this.log("pricing", `the price list sells ${[...new Set(cats.map((c) => c.concept))].join(", ")} in ${[...new Set(cats.map((c) => c.country))].join(", ")} - checking official category coverage for its products`);
      const skuViews = new Map<string, SkuView>();
      const narrow = cats.filter(c => c.products.length && /^(snacks|condiments)$/.test(c.concept));
      await this.selectSkuViews(narrow, skuViews, views, notes);
      await byAgency(cats.filter(c => !narrow.includes(c)), async (c) => {
        const v = await ensureView(c.country, c.concept);
        if (v) skuViews.set(`${c.country}:${c.concept}`, v);
        else this.log("warn", `no official ${c.concept} series for ${c.country}; those SKUs are left out`);
      });
      if (!skuViews.size) {
        if (allowLegacyFallback) return await this.priceListFlat(req, views, facts);
        notes.push("No verified official category series is available for the listed products; SKU prices are omitted.");
        return undefined;
      }
      const res = await this.sql.run(skuRatesSql([...new Set([...skuViews.values()].map((v) => v.view))], req.countries, monthsBack(15)), { limit: PRICE_LIST_ROW_LIMIT });
      const rows = rowsAsObjects(res, SKU_RATE_COLUMNS);
      const bySku = new Map<string, Record<string, unknown>[]>();
      for (const r of rows) {
        const k = `${r.country}|${r.sku}`;
        if (!bySku.has(k)) bySku.set(k, []);
        bySku.get(k)!.push(r);
      }
      const skus: SkuLine[] = [];
      for (const list of bySku.values()) {
        const r0 = list[0];
        const sf = seriesFacts(list.map((r) => ({ ...r, concept: r.rate_concept })));
        if (!sf) continue;
        const price = Number(r0.current_price);
        const at = (pct?: number) => (pct === undefined ? undefined : Math.round(price * (1 + pct / 100) * 100) / 100);
        const { low: lo, high: hi } = marketBenchmark(sf);
        const p = req.proposedChangePct;
        const selectedView = skuViews.get(`${r0.country}:${String(r0.sku_category).toLowerCase()}`);
        const note = selectedView?.note ?? "";
        skus.push({
          sku: String(r0.sku), product: String(r0.product), country: String(r0.country), skuCategory: String(r0.sku_category), currency: String(r0.currency),
          currentPrice: price, period: sf.latestPeriod, yoy: sf.latestYoy, sourceId: sf.sourceId, avg12: sf.avg12, rangeLow: lo, rangeHigh: hi,
          low: at(lo), high: at(hi), atProposed: at(p),
          verdict: p === undefined ? undefined : p > hi ? "above the market benchmark" : p < lo ? "below the market benchmark" : "within the market benchmark",
          cite: res.id, rateLabel: sf.label, coarser: /coarser|Food level/i.test(note),
          selectionReason: selectedView?.selectionReason, selectionSource: selectedView?.selectionSource, selectionFit: selectedView?.selectionFit,
        });
      }
      skus.sort((a, b) => a.country.localeCompare(b.country) || a.sku.localeCompare(b.sku));
      this.log("pricing", `federated query ${res.id} joined ${skus.length} SKUs with official category series (${skus.filter(s => s.coarser).length} broader proxies) -> ${skus.length} SKUs priced`);
      return { skus, query: res };
    } catch (e) {
      if (isIncompleteResultError(e)) {
        this.log("warn", `SKU pricing omitted because the query result is incomplete: ${String(e).slice(0, 140)}`);
        notes.push("SKU prices are omitted because the query result was incomplete or reached its row limit; market figures are still shown.");
        return undefined;
      }
      if (!allowLegacyFallback) {
        this.log("warn", `SKU category lookup or pricing unavailable (${String(e).slice(0, 140)}); keeping the market brief without substituting an unverified category`);
        notes.push("SKU pricing is unavailable because category lookup or pricing failed; market figures are still shown, but SKU prices are omitted.");
        return undefined;
      }
      this.log("warn", `per-category pricing failed (${String(e).slice(0, 140)}); pricing on the requested category instead`);
      return await this.priceListFlat(req, views, facts);
    }
  }

  /** Product-aware choices are separate from market concepts; one bounded model call serves every missing SKU scope. */
  private async selectSkuViews(
    categories: { country: Country; concept: string; products: string[] }[],
    skuViews: Map<string, SkuView>,
    views: Map<string, { view: string; label: string; via: "memory" | "onboarded"; note?: string; memoryId?: string }>,
    notes: string[],
  ): Promise<void> {
    if (!categories.length) return;
    const memory = this.deps.memory;
    const groups: SelectionGroup[] = [];
    const discoveries = new Map<string, string[]>();
    await byAgency(categories, async (category) => {
      const { country, concept, products } = category;
      const id = `${country}:${concept}`;
      const scope = skuScope(products);
      const hit = memory.findMapping(country, concept, scope);
      const mapping = hit?.mapping;
      const decoderCurrent = mapping && (mapping.decoderVersion ?? 1) === sourceDecoderVersion(AGENCY_FOR[country].agency);
      if (hit && mapping && !decoderCurrent) this.log("memory", `product-checked SKU mapping ${hit.id} uses an obsolete decoder - selecting and verifying again`);
      if (hit && decoderCurrent && mapping?.selectionVersion === SELECTION_VERSION && (mapping.selection?.by === "model" || mapping.selection?.onlyCandidate) && !memory.hmem.store.get(hit.id)?.tags.includes("review")) {
        try {
          await this.cacheRemembered(mapping);
          const probe = await this.sql.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${mapping.view} WHERE yoy_pct IS NOT NULL`);
          const latest = probe.rows[0]?.[1];
          if (isUsableObservationCount(probe.rows[0]?.[0]) && hasFreshPeriod(latest, mapping.frequency)) {
            const selected: SkuView = { view: mapping.view, note: durableNotes(mapping.note), selectionReason: mapping.selection.fit === "broader" ? BROADER_COVERAGE_REASON : mapping.selection.reason, selectionSource: "memory", selectionFit: mapping.selection.fit };
            skuViews.set(id, selected);
            views.set(`${id}:${scope}`, { view: mapping.view, label: mapping.label, via: "memory", note: durableNotes(mapping.note), memoryId: hit.id });
            if (durableNotes(mapping.note)) notes.push(`${country} ${concept}: ${durableNotes(mapping.note)} (remembered SKU selection)`);
            memory.feedback(hit.id, "helpful");
            this.log("memory", `reused product-checked SKU mapping ${hit.id}: ${id} -> psig.${mapping.view}`, { products, selection: mapping.selection });
            return;
          }
          this.log("memory", `product-checked SKU mapping ${hit.id} has no fresh rows - selecting again`);
        } catch {
          this.log("memory", `product-checked SKU mapping ${hit.id} is unavailable - selecting again`);
        }
      }
      let candidates: Candidate[] = [];
      const foundNotes: string[] = [];
      try {
        this.metrics.discoveries++;
        const found = await this.discoverFn(country, concept, skuSearchWords(concept, products));
        candidates = found.candidates.filter(c => !c.isBroadFallback || isOfficialBroadFood(c));
        foundNotes.push(...found.notes);
      } catch (e) {
        this.log("warn", `SKU candidate discovery failed for ${id}: ${String(e).slice(0, 120)}`);
      }
      if (!candidates.some(c => c.isBroadFallback)) {
        try {
          this.metrics.discoveries++;
          const broad = await this.discoverFn(country, "food");
          candidates.push(...broad.candidates.filter(isOfficialBroadFood).map(c => ({ ...c, isBroadFallback: true })));
          foundNotes.push(...broad.notes);
        } catch (e) {
          this.log("warn", `Food fallback discovery failed for ${id}: ${String(e).slice(0, 120)}`);
        }
      }
      if (!candidates.length) {
        notes.push(`${country} ${concept}: no usable official series was found for these products; their SKU prices are omitted.`);
        return;
      }
      groups.push({ id, country, concept, products: [...products].sort(), candidates });
      discoveries.set(id, foundNotes);
      this.log("discover", `${AGENCY_FOR[country].name}: ${candidates.length} SKU candidate(s) for ${concept}`, { country, concept, products, candidates });
    });
    if (!groups.length) return;
    groups.sort((a, b) => a.id.localeCompare(b.id));
    let decisions = new Map<string, SelectionDecision>();
    // A group whose only candidate is the official Food alternative has nothing to judge: it is used as the marked
    // broader proxy and not presented as the model's choice. A single narrow candidate still needs the coverage check.
    const onlyFood = (g: SelectionGroup) => g.candidates.length === 1 && !!g.candidates[0].isBroadFallback;
    const choices = groups.filter((g) => !onlyFood(g));
    if (choices.length < groups.length) this.log("plan", `${groups.length - choices.length} product group(s) have only the official Food series as a candidate - no model choice needed: ${groups.filter(onlyFood).map((g) => g.id).join(", ")}`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (choices.length) try {
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("SKU selection time budget expired")); }, 20_000);
      });
      const reply = await Promise.race([
        this.llm(selectionMessages(choices), { lane: "fast", temperature: 0, maxTokens: thinkingOff() ? 1200 : 2500, attempts: 1, timeoutMs: 20_000, signal: controller.signal }),
        expired,
      ]);
      const checked = validateSelectionsPerGroup(extractJson(reply.text), choices, reply.model);
      decisions = checked.decisions;
      this.log("llm", `SKU category selection (${reply.model}, ${reply.ms} ms${via(reply)}) - accepted ${decisions.size} of ${choices.length} product groups in one request`, checked.rejected.length ? { rejected: checked.rejected, reply: reply.text.slice(0, 2000) } : undefined);
      // Only the groups whose choice failed the code checks fall back; the model's valid choices stand.
      for (const r of checked.rejected) this.log("warn", `Nemotron's category choice for ${r.id} was not used (${r.reason}) - using the marked Food fallback`);
    } catch (e) {
      this.log("warn", `SKU category selection unavailable or invalid - using marked Food fallbacks where available (${String(e).slice(0, 140)})`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await byAgency(groups, async (group) => {
      const only = onlyFood(group) ? fallbackSelection(group) : undefined;
      let decision = decisions.get(group.id) ?? (only ? { ...only, reason: "The official Food series was the only candidate; no product-specific official series was found.", onlyCandidate: true } : fallbackSelection(group));
      if (!decision) {
        notes.push(`${group.country} ${group.concept}: no verified category or official Food fallback is available; these SKU prices are omitted.`);
        return;
      }
      const register = async (choice: SelectionDecision) => {
        const candidate = group.candidates[choice.candidate];
        try {
          const result = await this.onboardFn(this.sql, candidate, group.concept);
          if (result.cached && result.rawTable) this.cached.add(result.rawTable);
          this.log("onboard", `${result.ok ? "onboarded" : "FAILED"} SKU ${candidate.agency} ${candidate.code} -> psig.${result.view}${result.ok ? ` (${onboardingSummary(result)}: ${result.rows} rows, latest ${result.latest})` : `: ${humanError(result.error)}`}`, { candidate, selection: choice, result });
          if (!result.ok) return undefined;
          if (!isUsableObservationCount(result.rows) || !hasFreshPeriod(result.latest, candidate.frequency)) {
            this.log("warn", `selected SKU view psig.${result.view} has no fresh dated rows (latest ${result.latest ?? "unknown"}); it cannot be used for pricing`);
            return undefined;
          }
          return { candidate, result };
        } catch (e) {
          this.log("warn", `selected SKU series could not be onboarded: ${String(e).slice(0, 140)}`);
          return undefined;
        }
      };
      let registered = await register(decision);
      if (!registered) {
        const broad = fallbackSelection(group);
        if (broad && broad.candidate !== decision.candidate) {
          decision = broad;
          registered = await register(broad);
        }
      }
      if (!registered) {
        notes.push(`${group.country} ${group.concept}: the selected series and Food fallback are unavailable; these SKU prices are omitted.`);
        return;
      }
      const { candidate, result } = registered;
      const scope = skuScope(group.products);
      const ownNotes = discoveries.get(group.id) ?? [];
      if (decision.fit === "broader") ownNotes.push(`${candidate.label} is used as a broader category proxy (coarser) for these products${decision.onlyCandidate ? "; no product-specific official series was found" : decision.by === "fallback" ? "; a product-specific selection was unavailable or unusable" : ""}.`);
      const note = [...new Set(ownNotes)].join(" ") || undefined;
      if (note) notes.push(`${group.country} ${group.concept}: ${note}`);
      skuViews.set(group.id, { view: result.view, note, selectionReason: decision.reason, selectionSource: decision.by, selectionFit: decision.fit });
      let memoryId: string | undefined;
      if (decision.by === "model" || decision.onlyCandidate) {
        memoryId = memory.rememberMapping({ country: group.country, concept: group.concept, agency: candidate.agency, dataset: candidate.dataset, code: candidate.code, label: candidate.label, view: result.view, rawTable: result.rawTable, sourceUrl: candidate.sourceUrl, frequency: candidate.frequency, decoderVersion: sourceDecoderVersion(candidate.agency), note: durableNotes(note), scope, selectionVersion: SELECTION_VERSION, selection: decision });
        this.log("memory", `stored product-checked SKU mapping ${memoryId}`, { scope, products: group.products, selection: decision });
      }
      views.set(`${group.id}:${scope}`, { view: result.view, label: candidate.label, via: "onboarded", note, memoryId });
    });
  }

  /** Fallback: every SKU priced on the requested category's latest rate. */
  private async priceListFlat(req: Request, views: Map<string, { view: string }>, facts: MarketFacts[]): Promise<{ skus: SkuLine[]; query: SqlResult } | undefined> {
    const cat = req.concept === "all_items" ? "all_items" : req.concept;
    const catViews = req.countries.map((c) => views.get(`${c}:${cat}`)?.view ?? views.get(`${c}:all_items`)?.view).filter((v): v is string => !!v);
    if (!catViews.length) return undefined;
    try {
      const res = await this.sql.run(pricingSql([...new Set(catViews)], req.countries), { limit: PRICE_LIST_ROW_LIMIT });
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

  /**
   * H-MEM keeps each market's last outcome (period, rate, range, verdict). Compare this brief with it,
   * say what changed (a new official release, a different proposal, a different verdict), then store the new outcome.
   */
  private compareWithLastBrief(facts: MarketFacts[], req: Request, policy: number): string[] {
    const memory = this.deps.memory;
    const out: string[] = [];
    const pct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
    for (const f of facts) {
      const s = f.category ?? f.allItems;
      if (!s || !f.suggested) continue;
      const prev = memory.lastOutcome(f.country, s.concept);
      const decoderVersion = sourceDecoderVersion(AGENCY_FOR[f.country].agency);
      let retainNewerOutcome = false;
      if (prev) {
        const o = prev.outcome;
        const when = o.at.slice(0, 10);
        const parts: string[] = [];
        let comparable = o.methodVersion === 3 && !!o.sourceId && o.sourceId === s.sourceId && (o.decoderVersion ?? 1) === decoderVersion;
        if (o.methodVersion !== 3) parts.push("methodology changed: earlier outcomes may use a policy-scaled range or an all-items fallback; current requested-category benchmarks are not directly comparable");
        else if (!o.sourceId) parts.push("the earlier source identity was not recorded; the outcomes are not directly comparable");
        else if (o.sourceId !== s.sourceId) parts.push(`official source changed (${o.sourceId} -> ${s.sourceId}); the outcomes are not directly comparable`);
        else if ((o.decoderVersion ?? 1) !== decoderVersion) parts.push(`series decoder calculation changed (version ${o.decoderVersion ?? 1} -> ${decoderVersion}); the outcomes are not directly comparable, and this change is not evidence of an official data revision`);
        else {
          const order = comparePeriods(o.period, s.latestPeriod);
          const ranges = `market benchmark ${o.low.toFixed(1)}–${o.high.toFixed(1)}% -> ${f.suggested.low.toFixed(1)}–${f.suggested.high.toFixed(1)}%`;
          if (order === undefined) {
            parts.push("the observation periods cannot be compared; no release progression is inferred");
            comparable = false;
          }
          else if (order < 0) {
            parts.push(`the returned observation is older (${s.latestPeriod}) than the remembered ${o.period}; the newer comparison baseline is retained`);
            retainNewerOutcome = true;
          } else if (order > 0) parts.push(`new official release: ${o.period} ${pct(o.yoy)} -> ${s.latestPeriod} ${pct(s.latestYoy)}; ${ranges}`);
          else if (o.yoy !== s.latestYoy || o.low !== f.suggested.low || o.high !== f.suggested.high) parts.push(`official data or history revised for ${s.latestPeriod}: ${pct(o.yoy)} -> ${pct(s.latestYoy)}; ${ranges}`);
          else parts.push(`no new official release (still ${s.latestPeriod}, ${pct(s.latestYoy)}); market benchmark unchanged`);
        }
        if (!req.invalidPassThrough && o.policy !== undefined && Math.abs(o.policy - policy) > 1e-9) parts.push(`cost-recovery policy ${Math.round(o.policy * 100)}% -> ${Math.round(policy * 100)}%`);
        if (comparable && !retainNewerOutcome && o.proposed !== undefined && req.proposedChangePct !== undefined && o.verdict && f.verdict) {
          if (o.proposed !== req.proposedChangePct) parts.push(`last time ${signedPct(o.proposed)} was ${o.verdict}; now ${signedPct(req.proposedChangePct)} is ${f.verdict}`);
          else if (o.verdict !== f.verdict) parts.push(`verdict on ${signedPct(req.proposedChangePct)} changed: ${o.verdict} -> ${f.verdict}`);
          else parts.push(`verdict on ${signedPct(req.proposedChangePct)} unchanged (${f.verdict})`);
        }
        out.push(`${f.country} ${s.label} (last brief ${when}, ${prev.id}): ${parts.join("; ")}.`);
      }
      if (!retainNewerOutcome) memory.rememberOutcome({ country: f.country, concept: s.concept, period: s.latestPeriod, yoy: s.latestYoy, low: f.suggested.low, high: f.suggested.high, policy: req.invalidPassThrough ? undefined : policy, proposed: req.proposedChangePct, verdict: f.verdict, sourceId: s.sourceId, methodVersion: 3, decoderVersion, at: new Date().toISOString() });
    }
    if (out.length) this.log("memory", `compared with ${out.length} remembered brief outcome(s): ${out.map((x) => x.split(" (")[0]).join(", ")}`, out);
    return out;
  }

  private async narrate(req: Request, facts: MarketFacts[], notes: string[], policy: number): Promise<{ narrative?: Narrative; issue?: NarrativeIssue }> {
    // Caveats are written by code (e.g. "no data after 2025-12 (10 months ago)"), so their numbers may be repeated.
    const noteNumbers = [...new Set(notes)].join(" ").replace(/\b(19|20)\d{2}(-(Q[1-4]|\d{2}))?\b/g, " ").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const allowed = [...allowedNumbers(facts, req, policy), ...noteNumbers];
    const unique = [...new Set(notes)];
    // Notes about other product categories ("CA snacks: ...") describe the SKU price table, not the market benchmark.
    const skuNote = (n: string) => { const m = n.match(/^[A-Z]{2} ([a-z_]+):/); return !!m && m[1] !== req.concept && m[1] !== "all_items"; };
    const costScenario = facts.some((f) => f.costNeed !== undefined) ? "computed" : req.costIncreasePct !== undefined ? "unavailable" : "none";
    const payload = { request: forModel(req.raw), proposed_change_pct: req.proposedChangePct ?? null, cost_increase_pct: req.costIncreasePct ?? null, cost_share_pct: req.costSharePct ?? null, cost_scenario: costScenario, cost_share_basis: costScenario === "none" ? null : costShareBasisDescription(req), cost_pass_through_pct: req.invalidPassThrough ? null : Math.round(policy * 100), benchmark_basis: BENCHMARK_BASIS, headline_facts: headlineFacts(facts, req) ?? null, facts: factsForNarrative(facts, req, policy), caveats: unique.filter((n) => !skuNote(n)), sku_price_notes: unique.filter(skuNote) };
    const ask: ChatMessage[] = [
      { role: "system", content: "You write short, plain-English pricing briefs for an exporter's pricing manager. Use ONLY numbers that appear in the facts JSON, written with the same rounding. Copy benchmark_range_pct low and high exactly; never compute a range yourself. This is a historical year-on-year consumer-price benchmark, not a recommended price, willingness-to-pay estimate, or forecast. Each market's verdict field is final: say it as given (above, within or below the market benchmark), keeping every market and the headline consistent. Average coverage states how many monthly or quarterly observations were available; do not call partial coverage a complete annual average or insufficient history a flat trend. cost_need_pct, when provided, is a conditional cost-recovery scenario computed from the stated before/after-change cost basis, unchanged selling price, cost change and monetary cost pass-through. State the cost basis exactly as supplied and preserve any timing assumption. The cost policy does not scale the market benchmark; it applies only to the separate cost-recovery scenario. If no cost scenario was computed, do not say the policy was applied to the proposed change or the market benchmark. It does not assume or preserve a profit margin. If the cost scenario is unavailable, use the supplied missing-input reason and do not invent a price target from the cost change. Use cost_vs_market exactly when comparing that scenario with the historical benchmark. Never write internal JSON keys in the prose; name the cost recovery target and its explicit percentage as the subject of a cost comparison, separately from the proposed price change. No new numbers, no predictions about customers accepting a price. Mention the caveats supplied in the facts JSON and do not invent other source or methodology claims. If cost_scenario is \"none\", the request states no cost change: do not mention any cost need, cost-recovery target or cost comparison. sku_price_notes describe only the SKU price table for particular products; they never mean that a market's benchmark data is missing. When a proposed change is given, the headline states its verdict against the market benchmark. headline_facts states the proposal's verdict and the inflation trend in each market: the headline must agree with it market by market. Describe inflation only by its trend or its rates; above, within and below describe the proposed change. The headline answers both questions: how food inflation is moving in each market and the proposal's verdict. When verdicts differ, name the markets for each verdict; say a trend holds in every market only when every market has that trend. Mention a quarter (Q1 to Q4) only if the request names one." },
      { role: "user", content: `Facts: ${JSON.stringify(payload)}\nReply with JSON only, in this order: {"markets": {"<country code>": str (2 sentences: what the data says and what it means for the proposed change)}, "watch": str (one sentence, <= 20 words, on what to re-check next month), "headline": str (<= 20 words, written last: it must agree with headline_facts and with your market sentences)}\nCopy each benchmark_range_pct exactly. Never multiply a benchmark, rate or average by cost_pass_through_pct: the pass-through applies only to cost_need_pct.` },
    ];
    // One time budget for the prose, retries included: the numbers never wait more than this for the words.
    const deadline = Date.now() + Number(process.env.PSIG_NARRATIVE_BUDGET_MS || 55_000);
    let issue: NarrativeIssue | undefined; // why the last attempt failed, so the brief states the real reason
    const drafts: Narrative[] = []; // drafts that failed the fact check, for sentence-level salvage
    // Room for the reply (and Nemotron's hidden reasoning when it is on); raised once if a reply is cut off.
    let maxTokens = thinkingOff() ? 1500 : 8000;
    const raisedTokens = thinkingOff() ? 4000 : 16_000;
    let cutOffBest: Narrative | undefined; // the best checked part of a cut-off reply, used if no full reply passes
    let lastReply: { reply: string; finishReason?: string } | undefined; // the raw reply of an unusable attempt, kept in the trace
    const withMarketKeys = (n: Narrative): Narrative => ({ ...n, markets: Object.fromEntries(Object.entries(n.markets ?? {}).map(([k, v]) => [marketKey(k), v])) });
    let headlineFor: Narrative | undefined; // a draft whose only error is its headline, awaiting a new headline
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 8_000) {
        this.log("warn", "narrative time budget used up - the brief uses the computed summary");
        issue ??= "budget";
        break;
      }
      try {
        const r = await this.hedged("narrative", (signal, o) => this.llm(ask, { lane: (process.env.PSIG_NARRATIVE_LANE as "fast" | "deep") || "fast", temperature: 0.2, maxTokens, attempts: 1, timeoutMs: Math.max(1_000, deadline - Date.now()), signal, ...o }));
        let n = extractJson(r.text) as Narrative | null;
        // A headline-only rewrite is merged with the paragraphs that already passed the check.
        // Only its headline is used, even if the reply repeats (or empties) the paragraphs.
        if (headlineFor && n?.headline) n = { ...headlineFor, headline: n.headline };
        if (!n?.headline) {
          // A reply cut off mid-JSON keeps its finished fields; they go through the same fact check below.
          const kept = completedFields(r.text) as Narrative | null;
          if (kept?.headline) {
            n = { ...kept, markets: kept.markets ?? {}, cutOff: true };
            if (r.finishReason === "length") maxTokens = raisedTokens;
            this.log("warn", `narrative reply was cut off - keeping its complete fields (${Object.keys(n.markets).length} market paragraph(s)) for the fact check`, { reply: r.text.slice(0, 4000) });
          }
        }
        if (!n?.headline && r.finishReason === "length") {
          maxTokens = raisedTokens;
          throw new Error(`reply cut off at the token limit (finish_reason=length; ${JSON.stringify(r.usage ?? {}).slice(0, 120)}) - the next attempt allows ${maxTokens} tokens: ${r.text.replace(/\s+/g, " ").slice(0, 100)}`);
        }
        if (!n?.headline) { lastReply = { reply: r.text.slice(0, 4000), finishReason: r.finishReason }; throw new Error(`no headline in reply: ${r.text.replace(/\s+/g, " ").slice(0, 160)}`); }
        const bad = checkNarrative(n, allowed, facts, req, policy, noteNumbers);
        this.log("llm", `narrative (${r.model}, ${r.ms} ms${via(r)})${bad.length ? ` - does not match the facts: ${bad.join(", ")}` : " - numbers and verdicts match the facts"}`, bad.length ? { model: r.model, ms: r.ms, draft: n, problems: bad } : undefined);
        n.model = r.model;
        if (!bad.length) {
          // A cut-off reply missing market paragraphs is kept in reserve while the budget allows one more full reply.
          const covered = facts.filter((f) => f.category ?? f.allItems).length;
          if (!n.cutOff || Object.keys(n.markets).length >= covered) return { narrative: withMarketKeys(n) };
          if (!cutOffBest || Object.keys(n.markets).length > Object.keys(cutOffBest.markets).length) cutOffBest = n;
          issue = "unusable";
          continue;
        }
        drafts.push(n);
        issue = "grounding";
        // Only the headline is wrong: ask for a new headline alone, so the checked paragraphs cannot pick up new errors.
        const kept = headlineFor ? undefined : salvageNarrative(n, allowed, facts, req, policy, noteNumbers);
        if (!n.cutOff && kept?.removed?.length && kept.removed.every((x) => x.field === "headline") && Object.keys(kept.markets).length === Object.keys(n.markets ?? {}).length && (kept.watch ?? "") === (n.watch ?? "")) {
          headlineFor = n;
          ask.push({ role: "assistant", content: r.text }, { role: "user", content: `Only the headline is wrong: ${bad.join(", ")}. Reply with JSON only: {"headline": str (<= 20 words)}. Use this form, following headline_facts market by market: \"<how inflation is moving, by market>; <the proposed change> is <verdict> in <markets>\" (name the markets for each trend and each verdict).` });
          continue;
        }
        ask.push({ role: "assistant", content: r.text }, { role: "user", content: `These numbers, ranges or verdicts do not match the facts for that market: ${bad.join(", ")}. Rewrite using only that market's numbers; the benchmark range must be exactly benchmark_range_pct low to high, and each market's verdict must be exactly its verdict field. JSON only.` });
      } catch (e) {
        this.log("warn", `narrative attempt failed: ${String(e).slice(0, 120)}`, lastReply);
        lastReply = undefined;
        issue = /no headline in reply|cut off at the token limit/.test(String(e)) ? "unusable" : "provider";
        // Failures through Nightshift come and go from one request to the next, so the next attempt runs while the budget lasts.
      }
    }
    // Keep what passed: the draft whose salvage keeps the most market paragraphs, then removes the fewest sentences.
    const salvaged = drafts
      .map((d) => salvageNarrative(d, allowed, facts, req, policy, noteNumbers))
      .filter((x): x is Narrative => !!x)
      .sort((a, b) => Object.keys(b.markets).length - Object.keys(a.markets).length || a.removed!.length - b.removed!.length)[0];
    if (cutOffBest && (!salvaged || Object.keys(cutOffBest.markets).length >= Object.keys(salvaged.markets).length)) {
      this.log("llm", `narrative kept: the reply was cut off; its complete part (headline${Object.keys(cutOffBest.markets).length ? ` and ${Object.keys(cutOffBest.markets).length} market paragraph(s)` : ""}) matches the facts`);
      return { narrative: withMarketKeys(cutOffBest) };
    }
    if (salvaged) {
      const k = salvaged.removed!.length;
      this.log("llm", `narrative kept: the fact check removed ${k} sentence${k === 1 ? "" : "s"} that contradicted the computed facts${salvaged.headlineByCode ? " (headline computed in code)" : ""}`, { removed: salvaged.removed });
      return { narrative: withMarketKeys(salvaged) };
    }
    return { issue }; // renderBrief falls back to a deterministic summary
  }
}

// ---------- helpers ----------
type ExecCtx = { views: Map<string, any>; candidates: Map<string, Candidate[]>; notes: string[]; key: (a: string, b: string) => string; pairs: { country: Country; concept: Concept }[]; getCompared: () => SqlResult | undefined; setCompared: (c: SqlResult) => void };
type SkuView = { view: string; note?: string; selectionReason?: string; selectionSource?: "model" | "memory" | "fallback"; selectionFit?: "specific" | "broader" };

function onboardingSummary(result: { existed: boolean; createdObjects?: number; existingObjects?: number; cached?: boolean; reloaded?: boolean }): string {
  if (result.createdObjects !== undefined && result.existingObjects !== undefined) return `created ${result.createdObjects} SQL object${result.createdObjects === 1 ? "" : "s"}; ${result.existingObjects} already existed; ${result.reloaded ? "an old cached error page was dropped and the source read again; " : ""}${result.cached ? "source cached in Zetaris; " : ""}verified`;
  return result.existed ? "Zetaris already had it - reused and verified" : "created REST table + view";
}

/** A label match alone must not turn a narrow catalog hit into an official Food proxy. */
function isOfficialBroadFood(candidate: { agency: string; code: string; label: string }): boolean {
  const code = new Map([["eurostat", "CP01"], ["abs", "20001"], ["statcan", "v41690974"]]).get(candidate.agency);
  return candidate.code === code && isBroadFoodLabel(candidate.label);
}

/** Reject a known catalogue ambiguity, without claiming that every remaining label is a product match. */
function marketCategoryUsable(concept: Concept, candidate: { agency: string; code: string; label: string; isBroadFallback?: boolean }): boolean {
  if (candidate.isBroadFallback && !isOfficialBroadFood(candidate)) return false;
  if (concept !== "snacks") return true;
  if (isBroadFoodLabel(candidate.label)) return isOfficialBroadFood(candidate);
  return !/\b(?:sugar|confectionery|desserts?|chocolate|jams?|honey|cand(?:y|ies)|sweets?)\b/i.test(candidate.label)
    || /\b(?:snacks?|chips?|crisps?|savoury|savory|potato)\b/i.test(candidate.label);
}

/** Run fn for every item: items of different agencies in parallel, items of the same agency one after another. */
async function byAgency<T extends { country: Country }>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const g = AGENCY_FOR[it.country]?.name ?? it.country;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(it);
  }
  await Promise.all([...groups.values()].map(async (list) => {
    for (const it of list) await fn(it);
  }));
}
/**
 * The first JSON object in a model reply. Reasoning before a closing </think> is skipped, stray braces in
 * prose are passed over, and a trailing comma (a common slip) is tolerated.
 */
export function extractJson(text: string): any | null {
  const closed = text.lastIndexOf("</think>");
  const t = (closed >= 0 ? text.slice(closed + "</think>".length) : text).replace(/```(?:json)?/g, "").trim();
  for (let start = t.indexOf("{"); start >= 0; start = t.indexOf("{", start + 1)) {
    const end = objectEnd(t, start);
    if (end < 0) continue;
    const body = t.slice(start, end + 1);
    for (const candidate of [body, withoutTrailingCommas(body), escapedControls(withoutTrailingCommas(body))]) {
      try {
        const j = JSON.parse(candidate);
        if (j && typeof j === "object" && !Array.isArray(j)) return j;
      } catch {
        // try the lenient form, then the next brace
      }
    }
  }
  return null;
}

/**
 * The complete fields of a JSON object reply that was cut off: everything up to the last finished value, closed.
 * Returns the object only when it has a string headline; an unfinished value is dropped, never completed.
 */
export function completedFields(text: string): any | null {
  const closed = text.lastIndexOf("</think>");
  const t = (closed >= 0 ? text.slice(closed + "</think>".length) : text).replace(/```(?:json)?/g, "").trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  const cuts: { at: number; depth: number }[] = [];
  let depth = 0, inStr = false, esc = false, value = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') { inStr = false; if (value) cuts.push({ at: i + 1, depth }); value = false; }
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === ":") value = true;
    else if (ch === ",") value = false;
    else if (ch === "{") { depth++; value = false; }
    else if (ch === "}") {
      if (--depth === 0) {
        const whole = extractJson(t.slice(start, i + 1));
        if (whole) return whole;
        break; // closed but malformed (e.g. an unescaped quote): keep the fields finished before the break
      }
      cuts.push({ at: i + 1, depth });
    }
  }
  for (const c of cuts.reverse()) {
    // A real end of value is followed by "," or "}" (or the end of a cut-off reply); a stray quote inside a
    // sentence is not, so "Australian "food" CPI" never becomes the paragraph "Australian ".
    const next = t.slice(c.at).trimStart()[0];
    if (next !== undefined && next !== "," && next !== "}") continue;
    try {
      const j = JSON.parse(escapedControls(t.slice(start, c.at)) + "}".repeat(c.depth));
      if (j && typeof j.headline === "string") return j;
    } catch {
      // an earlier cut may still close cleanly
    }
  }
  return null;
}

/** Raw line breaks and tabs inside JSON strings, escaped (JSON forbids them; models sometimes write them). */
function escapedControls(json: string): string {
  let out = "", inStr = false, esc = false;
  for (const ch of json) {
    if (inStr && !esc && (ch === "\n" || ch === "\r" || ch === "\t")) { out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t"; continue; }
    out += ch;
    if (esc) esc = false;
    else if (inStr && ch === "\\") esc = true;
    else if (ch === '"') inStr = !inStr;
  }
  return out;
}

/** Index of the brace closing the object that opens at `start`, ignoring braces inside strings; -1 if none. */
function objectEnd(t: string, start: number): number {
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
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Drop commas directly before a closing brace or bracket, outside strings. */
function withoutTrailingCommas(t: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    if (ch === "," && /^\s*[}\]]/.test(t.slice(i + 1))) continue;
    out += ch;
  }
  return out;
}

/**
 * The statement with quoted text blanked, read left to right so a quote inside a comment or another quote
 * cannot shift what counts as quoted. Comments are refused (undefined): generated SQL never has them.
 */
function sqlOutsideQuotes(sql: string): string | undefined {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] === "\\") j++;
        else if (sql[j] === ch) {
          if (sql[j + 1] === ch) j++;
          else break;
        }
      }
      if (j >= sql.length) return undefined; // unterminated quote
      out += ch + ch;
      i = j;
    } else if ((ch === "-" && sql[i + 1] === "-") || (ch === "/" && sql[i + 1] === "*")) return undefined;
    else out += ch;
  }
  return out;
}

/** Which runtime answered a model call, shown next to the model name in the trace. */
function via(r: ChatResult): string {
  return r.provider === "meterless" ? " via Meterless Nightshift" : ` via ${r.provider}`;
}

/** A concept name from the model ends up in view names and SQL string literals: keep it to plain words. */
function cleanConcept(v: unknown): string {
  return typeof v !== "string" ? "" : v.toLowerCase().replace(/['"`\\;]/g, "").trim();
}

/**
 * The request as sent to the model. Through Nightshift on 27 Oct, questions with "go +3%" / "go -2%" came back as
 * empty replies from both Nemotron lanes, while "move +3%" answered in 1-3 s. The rules, the brief and the memory
 * keep the words as written.
 */
export function forModel(raw: string): string {
  return raw.replace(/\bgo(?=\s+(?:(?:up|down|to|by)\s+)?[+\-−]?\s?\d)/gi, (m) => (m[0] === "G" ? "Move" : "move"));
}

function sameAsLastRequest(raw: string): boolean {
  return /\b(same as (last|before|previous)|like last time|as last time|as usual|same again)\b|지난번|저번|지난 분기|같은 조건/i.test(raw);
}

/** Literal aliases outrank model country guesses. Models may resolve a named typo, not invent a market. */
function requestMarkets(raw: string, modelNames: string[]): { countries: Country[]; unknown: string[] } {
  const hits: { country: Country; at: number }[] = [];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [alias, country] of Object.entries(COUNTRY_ALIASES)) {
    const suffix = /[가-힣]/.test(alias) ? "(?=$|[^\\p{L}]|(?:에서|에서는|에는|으로|와|과|은|는|을|를|에|의|만|이랑|랑|하고|이나|나|및|도|까지)(?=$|[^\\p{L}]))" : "(?![\\p{L}])";
    for (const match of raw.matchAll(new RegExp(`(?<![\\p{L}])${escape(alias)}${suffix}`, "giu"))) hits.push({ country, at: match.index! });
  }
  for (const match of raw.matchAll(/\b[A-Z]{2}\b/g)) {
    const country = normalizeCountry(match[0], false);
    if (country) hits.push({ country, at: match.index! });
  }
  const countries = [...new Set(hits.sort((a, b) => a.at - b.at).map(h => h.country))];
  const unknown: string[] = [];
  const phrase = (value: string) => value.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).join(" ");
  const rawPhrase = ` ${phrase(raw)} `;
  // Ground a canonical model name in a nearby one-edit spelling only in a market position.
  // Ordinary freight prose ("inland", "pain") must not become Finland or Spain.
  for (const name of modelNames) {
    const country = normalizeCountry(name);
    if (!country || countries.includes(country)) continue;
    for (const match of raw.matchAll(/[\p{L}]{4,}/gu)) {
      if (/^(?:inland|pain)$/i.test(match[0]) || normalizeCountry(match[0], true) !== country) continue;
      const before = raw.slice(Math.max(0, match.index! - 24), match.index!);
      const after = raw.slice(match.index! + match[0].length);
      if (/^\s*(?:food|snacks?|condiments?|prices?|inflation|CPI|HICP|markets?)\b|^\s*(?:식품|간식|물가|가격)/i.test(after)
        || /\b(?:in|for|and|market)\s*$/i.test(before) || /[,&/]\s*$/.test(before)
        // A list that opens the request: "germny and austrlia food".
        || /^\s*(?:and|or|&|,|\/)/i.test(after)) { countries.push(country); break; }
    }
  }
  for (const name of modelNames) {
    if (!phrase(name) || !rawPhrase.includes(` ${phrase(name)} `)) continue;
    if (/^[A-Z]{2}$/.test(name) && !normalizeCountry(name.toLowerCase(), false) && !raw.split(/[^\p{L}]+/u).includes(name)) continue;
    const country = normalizeCountry(name);
    if (country) { if (!countries.includes(country)) countries.push(country); }
    else if (!unknown.some(value => phrase(value) === phrase(name))) unknown.push(name);
  }
  // These names only preserve explicit unsupported requests; they add no data-source coverage.
  const unsupported = [
    ["Japan", "japan", "일본"], ["United States", "united states", "USA", "US", "미국"],
    ["United Kingdom", "united kingdom", "UK", "britain", "영국"], ["China", "china", "중국"],
    ["South Korea", "south korea", "korea", "한국", "대한민국"], ["Brazil", "brazil", "브라질"],
  ];
  for (const names of unsupported) {
    const mentioned = names.slice(1).find(name => {
      const flags = /^[A-Z]{2,3}$/.test(name) ? "u" : "iu";
      const suffix = /[가-힣]/.test(name) ? "(?=$|[^\\p{L}]|(?:에서|와|과|은|는|을|를|에|의|만)(?=$|[^\\p{L}]))" : "(?![\\p{L}])";
      return new RegExp(`(?<![\\p{L}])${escape(name)}${suffix}`, flags).test(raw);
    });
    if (!mentioned || unknown.some(value => names.some(name => phrase(name) === phrase(value)))) continue;
    const modelName = modelNames.find(value => names.some(name => phrase(name) === phrase(value)));
    const literal = raw.match(new RegExp(escape(mentioned), /^[A-Z]{2,3}$/.test(mentioned) ? "u" : "iu"))?.[0];
    unknown.push(modelName ?? literal ?? names[0]);
  }
  return { countries, unknown };
}

function requestCostShareBasis(raw: string, share: number | undefined, newShare: boolean, costContext: string | undefined, remembered?: Request["costShareBasis"]): { value?: Request["costShareBasis"]; issues: string[] } {
  if (share === undefined) return { issues: [] };
  const before = /\b(?:before|prior to)\s*(?:(?:the|this|cost)\s+)*(?:change|increase|rise|decrease|reduction)\b|\bpre[- ]change\b|(?:변동|변화|상승|인상|인하|증가|감소)\s*전/i.test(raw);
  const after = /\b(?:after|following)\s*(?:(?:the|this|cost)\s+)*(?:change|increase|rise|decrease|reduction)\b|\bpost[- ]change\b|(?:변동|변화|상승|인상|인하|증가|감소)\s*후/i.test(raw);
  if (before !== after) return { value: before ? "before_change" : "after_change", issues: [] };
  const futureCost = /\b(?:will|expected|forecast|next|going to)\b|예정|전망|오를|내릴/i.test(costContext ?? "");
  const pastCost = /\b(?:rose|risen|increased|fell|fallen|decreased|grew|have|has)\b|올랐|상승했|증가했|내렸|감소했/i.test(costContext ?? "");
  const currentShare = /\b(?:current|now|today)\b[^%.!?;\n]{0,35}\b(?:unit\s+)?costs?\b|\bunit costs?\s+(?:are|is)\b|현재[^%.!?;\n]{0,25}(?:원가|비용)/i.test(raw);
  if (!before && !after && futureCost && (currentShare || !newShare)) return { value: "before_change", issues: !newShare ? ["The new future cost change uses the remembered cost share before that new change; the previous change's timing is not reused."] : [] };
  if (!before && !after && currentShare && pastCost) return { value: "after_change", issues: [] };
  if (!newShare && !before && !after && remembered) return { value: remembered, issues: [] };
  return { issues: [before && after ? "Conflicting cost-share timing was supplied; assuming the share is before the cost change until clarified." : "Cost-share timing is not specified; assuming the share is before the cost change. State before or after the change to make the basis explicit."] };
}

/** A direct inflation/price subject outranks a product introduction; memory fills only absent categories. */
function explicitMarketConcept(raw: string): { concept?: string; issues: string[] } {
  const aliases: [string, RegExp][] = [
    ["all_items", /\b(?:all[-_ ]items|all groups|overall|headline)\b|전체|총지수/gi],
    ["food", /\b(?:food|grocer(?:y|ies))\b|식품|식료품/gi],
    ["snacks", /\bsnacks?\b|간식|과자/gi],
    ["condiments", /\b(?:condiments?|sauces?)\b|조미료|양념|소스/gi],
  ];
  const hits: { concept: string; index: number; direct: boolean }[] = [];
  for (const [concept, pattern] of aliases) for (const match of raw.matchAll(pattern)) {
    const before = raw.slice(Math.max(0, match.index! - 24), match.index);
    const after = raw.slice(match.index! + match[0].length);
    // An explicit exclusion is not a second requested category.
    if (/\b(?:not|except|excluding)\s*$/i.test(before) || /^\s*(?:말고|아닌|제외)/.test(after)) continue;
    const direct = /^\s*(?:consumer\s+)?(?:price(?:s| inflation)?|inflation|CPI|HICP)\b/i.test(after)
      || /^\s*(?:의\s*)?(?:물가|인플레이션|가격)/.test(after)
      || /\b(?:compare|benchmark)\s+(?:the\s+)?$/i.test(before)
      || /\b(?:inflation|prices?|CPI|HICP)\s+(?:for|of|in)\s+(?:the\s+)?$/i.test(before);
    if (!direct) {
      // A category word in the business introduction or ordinary prose is not a changed request.
      // Keep concise market/category inputs and explicit category changes without needing "inflation".
      if (/^\s*(?:business|company|exporter|products?)\b/i.test(after) || /^\s*(?:수출업체|업체|제품)/.test(after) || /^(?:overall|headline)$/i.test(match[0])) continue;
      if (/^[가-힣]/.test(match[0]) && !/^(?:(?:으로|은|는|을|를|의|이|가|로))?(?=\s|[,.:;!?+−\-\d]|$)/.test(after)) continue;
      const preceding = before.trim().split(/[^\p{L}]+/u).filter(Boolean).at(-1);
      const following = after.replace(/^\s*(?:in|for|of|from)\s+/i, "").trim().split(/[^\p{L}]+/u).filter(Boolean)[0];
      const marketShorthand = !!(preceding && normalizeCountry(preceding, false) || following && normalizeCountry(following, false));
      const changed = /\b(?:switch\s+to|change\s+(?:the\s+)?category\s+to|category\s*[:=])\s*$/i.test(before)
        || /(?:이번에는|대신|범주[는를가]?|카테고리[는를가]?)\s*$/.test(before)
        || sameAsLastRequest(raw) && /\bbut\s*$/i.test(before) && /^[\s.!?]*$/.test(after);
      if (!marketShorthand && !changed) continue;
    }
    hits.push({ concept, index: match.index!, direct });
  }
  const direct = hits.filter(h => h.direct).sort((a, b) => a.index - b.index);
  const choices = [...new Set((direct.length ? direct : hits.sort((a, b) => a.index - b.index)).map(h => h.concept))];
  if (!choices.length || !direct.length && choices.length > 1) return { issues: [] };
  return { concept: choices[0], issues: choices.length > 1 ? [`This request names multiple market categories; PriceSignal compares one market category per brief. Using the first explicit category, ${choices[0]}; ${choices.slice(1).join(", ")} is not included in this market comparison.`] : [] };
}

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
/** "four percent" in the request, confirmed by the model's own reading of the same number (sign from the wording). */
function proposalFromWords(raw: string, modelValue: unknown): { value: number; words: string } | undefined {
  const m = raw.match(new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\s+(?:percent|per cent|pct)\\b`, "i"));
  const fromModel = numOrUndef(modelValue);
  if (!m || fromModel === undefined) return undefined;
  const value = NUMBER_WORDS.indexOf(m[1].toLowerCase()) * (/\b(?:cut|lower|reduce|decrease|drop)\b|인하|내리/i.test(raw) ? -1 : 1);
  return Math.abs(fromModel - value) < 1e-9 ? { value, words: m[0] } : undefined;
}

/** An exchange-rate move ("the euro weakened 4%", "환율 3%"); a currency code alone ("our EUR prices") is not one. */
const FX_MOVE = /\bexchange[- ]rates?\b|\bFX\b|\bcurrenc(?:y|ies)\s+(?:moves?|moved|swings?|fell|rose|weakened|strengthened)|\b(?:euro|dollar|won|yen|pound|loonie)s?\s+(?:has\s+|have\s+)?(?:weakened|strengthened|fell|rose|dropped|gained|depreciated|appreciated|moved)\b|환율|원화\s*(?:약세|강세)/i;

/** Percentages are grounded in the request, with separate denominators and explicit signs. */
function requestPercentages(raw: string, model: any): {
  proposedChangePct?: number; costIncreasePct?: number; costSharePct?: number; passThrough?: number;
  costContext?: string; proposalWords?: string;
  invalidCostShare: boolean; invalidPassThrough: boolean; invalidProposal: boolean; invalidCostChange: boolean; issues: string[];
} {
  // A malformed/huge token must never restart at its trailing digits and become a different rate.
  const matches = [...raw.matchAll(/(?<![\p{N}.,+＋\-−－])([+＋\-−－]?)\s*((?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+\-]?\d+)?|Infinity|NaN|∞)\s*(?:%|pct\b|percent\b|퍼센트|프로)/giu)];
  // Keep offsets unchanged while protecting common abbreviations from sentence splitting.
  const context = raw.replace(/\b(?:approx|e\.g|i\.e)\./gi, abbreviation => abbreviation.replace(/\./g, " "));
  const clauseBoundary = /[,;!?\n]|(?<!\d)\.|\.(?!\d)|\b(?:but|and|while|whereas)\b|하지만|그런데|반면|그리고/i;
  const found = matches.map((m, i) => {
    const from = i ? matches[i - 1].index! + matches[i - 1][0].length : 0;
    const end = m.index! + m[0].length;
    const before = context.slice(Math.max(from, m.index! - 80), m.index).split(clauseBoundary).at(-1)!;
    const after = context.slice(end, Math.min(matches[i + 1]?.index ?? raw.length, end + 70)).split(clauseBoundary)[0];
    const costWords = /\bcosts?\b|원가|비용|\binput\b|\bingredient\b|\bmaterial\b|\bfreight\b/i;
    const share = /cost[ -]*(?:share|ratio)|costs?[ -]*(?:to|\/)[ -]*(?:selling[ -]*)?price|원가\s*비중|비용\s*비중|판매가.*(?:원가|비용)|(?:원가|비용).*판매가/i.test(before)
      || /^\s*(?:(?:unit|current)\s+)?cost[ -]*(?:share|ratio)\b|^\s*(?:원가|비용)\s*비중/i.test(after)
      || (costWords.test(before) && /^\s*(?:of\s+)?(?:(?:the|our|current)\s+)*(?:(?:selling|sales|sale|retail)\s+)?price\b/i.test(after));
    const pass = !share && (/\bpass(?:ed|ing)?\b|\brecover(?:y)?\b|반영|전가|회수/i.test(before)
      || /^\s*(?:pass[ -]?(?:through|thru)|(?:만|을|를)?\s*(?:반영|전가|회수))/i.test(after)
      || (/원가|비용|상승분|인상분|증가분|그\s*중/.test(before) && /^\s*(?:만|을|를|정도|가량|쯤)?\s*(?:(?:판매\s*)?가격(?:에|으로)\s*)?(?:반영|전가|회수)/.test(after)));
    const cost = !share && !pass && (costWords.test(before) || /^\s*(?:costs?\s+(?:rise|increase|growth|change)|원가\s*(?:상승|증가))/i.test(after));
    // A later price clause cannot reverse an earlier cost change, even without punctuation.
    const directionAfter = cost ? after.split(/\b(?:prices?|selling)\b|가격/i)[0] : after;
    const direction = /\b(?:fall|fell|decreas\w*|reduc\w*|cut|lower\w*)\b|인하|내리|하락|감소/i.test(`${before} ${directionAfter}`);
    const x = Number(m[2].replace(",", ".")) * (/^[\-−－]$/.test(m[1]) || (!m[1] && !share && !pass && direction) ? -1 : 1);
    const lastIndex = (pattern: RegExp) => [...before.matchAll(pattern)].at(-1)?.index ?? -1;
    const fxAt = lastIndex(new RegExp(FX_MOVE.source, "gi"));
    const fxSubject = fxAt >= 0 && !/가격|인상|인하|올려|올리|내려|\bprices?\b|\braise\b|\bincrease\b|\bgo\b|\bwant\b|\bneed\b/i.test(before.slice(fxAt).replace(FX_MOVE, " ")) && !/^\s*(?:인상|인하|올려|올리|내려|price|raise|increase)/i.test(after);
    const unrelatedAt = Math.max(lastIndex(/\b(?:tax|VAT|margin|inflation|CPI|HICP|interest|discount rate)\b|부가세|세율|마진|이익률|물가상승률/gi), fxSubject ? fxAt : -1);
    const proposalAt = lastIndex(/\b(?:thinking|considering|propos\w*|planning|what about|(?:can|could|should|would|will)\s+[^:;.!?]*?\b(?:raise|increase|reduce|cut|change)\s+(?:our\s+)?prices?)\b|가격(?:은|을|이)?\s*(?:인상|인하|변경)/gi);
    const unrelated = unrelatedAt >= 0 && proposalAt <= unrelatedAt
      || /^\s*(?:VAT|tax|margin|inflation|부가세|세율|마진|이익률)\b/i.test(after);
    const timeContext = `${before} ${after}`.replace(/\b(?:same as|like) last (?:quarter|month|year)\b|지난\s*분기(?:와)?\s*같은\s*조건(?:으로)?/gi, " ");
    const historical = /\b(?:last year|last quarter|last month|previously|earlier|already|used to|previous price)\b|작년|지난해|지난\s*(?:분기|달)|이전\s*가격/i.test(timeContext);
    return { x, signed: !!m[1], share, pass, cost, unrelated, historical, before, after: directionAfter, previousValue: false, context: `${before} ${m[0]} ${directionAfter}` };
  });
  // A named field changed "from A% to B%" has one current value, B. Keep this
  // link narrow: intervening field names and alternatives must not inherit A's role.
  for (let i = 1; i < found.length; i++) {
    const previous = found[i - 1], current = found[i];
    const previousMatch = matches[i - 1], currentMatch = matches[i];
    const bridge = raw.slice(previousMatch.index! + previousMatch[0].length, currentMatch.index).trim();
    const english = /^to$/i.test(bridge) && /\bfrom\s*$/i.test(previous.before);
    const korean = bridge === "에서" && /^\s*(?:으)?로(?=$|[\s.,;!?]|바꾸|바꿔|변경|조정|낮추|높이)/.test(current.after);
    if (!english && !korean) continue;
    if (/\b(?:range|ranges|ranging|anywhere)\b|범위/i.test(previous.before)) continue;
    const role = (p: typeof current) => p.share ? "share" : p.pass ? "pass" : p.cost ? "cost" : p.unrelated ? "unrelated" : "proposal";
    if (role(current) !== "proposal" && role(current) !== role(previous)) continue;
    previous.previousValue = true;
    current.share = previous.share;
    current.pass = previous.pass;
    current.cost = previous.cost;
    current.unrelated = previous.unrelated;
    current.historical = previous.historical;
    // A named reduction is negative; "lower the proposal" only lowers its rate.
    // Use the subject next to A, not an earlier direction word or A's inferred sign.
    const subject = previous.before.replace(/\bfrom\s*$/i, "").trim();
    const reduction = !current.share && !current.pass && (
      /\b(?:prices?|costs?)\s+(?:reduction|decrease|decline|fall|cut)(?:\s+(?:rate|percentage))?$/i.test(subject)
      || /\b(?:reduction|decrease|decline|fall|cut)\s+(?:in|of)\s+(?:the\s+)?(?:prices?|costs?)$/i.test(subject)
      || /(?:가격|원가|비용)\s*(?:인하|하락|감소)(?:율|률)?(?:을|를|은|는)?$/.test(subject)
    );
    current.x = Number(currentMatch[2].replace(",", ".")) * (/^[\-−－]$/.test(currentMatch[1]) || !currentMatch[1] && reduction ? -1 : 1);
    current.context = `${previous.before} ${currentMatch[0]} ${current.after}`;
  }
  const chooseOption = (kind: "share" | "pass" | "cost", modelValue: unknown, scale = 1) => {
    const options = found.filter(p => p[kind] && !p.previousValue);
    const fromModel = numOrUndef(modelValue);
    return options.find(p => fromModel !== undefined && Math.abs(p.x - fromModel * scale) < 1e-9) ?? options.at(-1);
  };
  const choose = (kind: "share" | "pass" | "cost", modelValue: unknown, scale = 1) => chooseOption(kind, modelValue, scale)?.x;
  const share = choose("share", model.cost_share_pct);
  const passPct = choose("pass", model.pass_through, 100);
  const invalidCostShare = share !== undefined && (!Number.isFinite(share) || share < 0 || share > 100);
  const invalidPassThrough = passPct !== undefined && (!Number.isFinite(passPct) || passPct < 0 || passPct > 100);
  const proposals = found.filter(p => !p.previousValue && !p.share && !p.pass && !p.cost && !p.unrelated && !p.historical);
  const uniqueProposals = [...new Set(proposals.map(p => p.x))];
  const ambiguousProposal = uniqueProposals.length > 1;
  // "3-4%" or "3 to 4%" outside a cost, pass-through or share phrase is a range, not one proposal.
  const rangeProposal = [...raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|~|〜|\bto\b)\s*(\d+(?:[.,]\d+)?)\s*(?:%|pct\b|percent\b|퍼센트|프로)/gi)]
    .some(m => !/\b(?:costs?|pass\w*|recover\w*|share|margin|tax|VAT|inflation|CPI|HICP|rose|risen|running|was|were)\b|원가|비용|반영|전가|비중|물가/i.test(raw.slice(Math.max(0, m.index! - 40), m.index))
      && !/^\s*(?:of\s+)?(?:(?:our|the)\s+)?(?:costs?\b|cost increase|pass|recover|원가|비용|반영|전가)/i.test(raw.slice(m.index! + m[0].length, m.index! + m[0].length + 30)));
  // "four percent": used only when no digits gave a proposal and Nemotron read the same number from the request.
  const wordProposal = !proposals.length && !rangeProposal ? proposalFromWords(raw, model.proposed_change_pct) : undefined;
  const proposal = proposals[0] ?? (wordProposal ? { x: wordProposal.value } : undefined);
  const invalidProposal = ambiguousProposal || rangeProposal || proposals.some(p => !Number.isFinite(p.x) || p.x < -100);
  const selectedCost = chooseOption("cost", model.cost_increase_pct);
  const costChange = selectedCost?.x;
  const invalidCostChange = costChange !== undefined && (!Number.isFinite(costChange) || costChange < -100);
  const issues: string[] = [];
  if (invalidCostShare) issues.push("Cost share must be between 0% and 100% of the current selling price; the invalid value is not reused from memory and the cost-recovery target is omitted.");
  if (invalidPassThrough) issues.push("Cost pass-through must be between 0% and 100% of the monetary cost increase; the invalid policy is not replaced by a remembered value and the cost-recovery target is omitted.");
  if (ambiguousProposal) issues.push("Multiple different proposed price changes were supplied; provide one proposal. No proposal is chosen or recalled for this comparison.");
  if (rangeProposal) issues.push("A range of proposed changes was given; provide one proposal. No proposal is chosen or recalled for this comparison.");
  if (FX_MOVE.test(raw)) issues.push("An exchange-rate change was mentioned; exchange rates are not used in this comparison.");
  if (/\b(?:every|each|per)\s+quarter\b|\bquarterly\s+(?:increases?|rises?|hikes?|raises?)\b|매\s*분기|분기마다/i.test(raw)) issues.push("The question describes a repeated quarterly increase. The benchmark is year-on-year, and repeated quarterly increases add up over a year.");
  if (proposals.some(p => !Number.isFinite(p.x) || p.x < -100)) issues.push("The proposed price change must be finite and at least -100%; the invalid value is omitted and is not replaced from memory.");
  if (invalidCostChange) issues.push("The cost change must be finite and at least -100%; the invalid value is omitted and is not replaced from memory.");
  return {
    proposalWords: wordProposal && !invalidProposal ? wordProposal.words : undefined,
    proposedChangePct: invalidProposal ? undefined : proposal?.x,
    costIncreasePct: invalidCostChange ? undefined : costChange,
    costContext: invalidCostChange ? undefined : selectedCost?.context,
    costSharePct: invalidCostShare ? undefined : share,
    passThrough: invalidPassThrough || passPct === undefined ? undefined : passPct / 100,
    invalidCostShare, invalidPassThrough, invalidProposal, invalidCostChange, issues,
  };
}

/** Positive means a later observation of the same frequency; malformed/mixed periods are incomparable. */
function comparePeriods(previous: string, current: string): number | undefined {
  const index = (p: string) => {
    const monthly = p.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (monthly) return { frequency: "M", value: Number(monthly[1]) * 12 + Number(monthly[2]) - 1 };
    const quarterly = p.match(/^(\d{4})-Q([1-4])$/);
    return quarterly ? { frequency: "Q", value: Number(quarterly[1]) * 4 + Number(quarterly[2]) - 1 } : undefined;
  };
  const a = index(previous), b = index(current);
  return a && b && a.frequency === b.frequency ? b.value - a.value : undefined;
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
