// PriceSignal agent: messy pricing question -> discover fragmented sources ->
// onboard them into Zetaris -> one federated SQL -> evidence-backed brief.
// The model (Nemotron via Meterless Nightshift) chooses the next action from a
// JSON action protocol; code executes actions, enforces guardrails, and computes
// every number that reaches the user.
import { EventEmitter } from "node:events";
import { chat, ChatMessage, ChatResult } from "./llm.ts";
import { AgentMemory } from "./memory.ts";
import { SqlResult, SqlRunner, rowsAsObjects, isIncompleteResultError } from "./zetaris.ts";
import { AGENCY_FOR, COMPARE_COLUMNS, Candidate, Concept, Country, CONCEPT_WORDS, compareSql, discover, monthsBack, normalizeCountry, onboard, skuSearchWords, isBroadFoodLabel } from "./sources/index.ts";
import { MarketFacts, Brief, RunMetrics, SkuLine, buildFacts, renderBrief, signedPct, marketKey, allowedNumbers, checkNarrative, factsForNarrative, seriesFacts, marketBenchmark, Narrative, NarrativeIssue } from "./brief.ts";
import { buildAlignment } from "./alignment.ts";
import { PRICE_DB, PRICING_COLUMNS, SKU_RATE_COLUMNS, ensurePriceList, priceTable, priceView, pricingSql, skuCategoriesSql, skuRatesSql } from "./sources/pricelist.ts";
import { BROADER_COVERAGE_REASON, SELECTION_VERSION, skuScope, selectionMessages, validateSelections, fallbackSelection, type SelectionGroup, type SelectionDecision } from "./selection.ts";
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
  /** Current unit cost divided by the current selling price, expressed as 0..100%. */
  costSharePct?: number;
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

export interface AgentDeps { llm?: typeof chat; sql: SqlRunner; memory: AgentMemory; discoverFn?: typeof discover; onboardFn?: typeof onboard; maxSteps?: number; hedgeMs?: number }

const SYSTEM_PLANNER = `You are PriceSignal, an agent that helps an exporter's pricing manager decide price changes per market from official inflation statistics.
Markets and agencies: EU members (DE, FR, IT, ES, NL, BE, AT, IE, PT, FI, SE, DK, PL, CZ) = Eurostat HICP, CA = Statistics Canada CPI, AU = Australian Bureau of Statistics CPI.
Reply with a single JSON object and nothing else:
{"thought": "<one short sentence>", "actions": [{"action": "<name>", "args": {...}}, ...]}
"actions" holds 1 to 8 actions executed in order. Batch actions that do not depend on each other's results
(for example one discover_and_onboard or use_memory_mapping per missing pair) so the task needs few turns.
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
  private providerSlow = false;
  private hedgeMs: number;
  /** the Zetaris runner as this agent uses it: allowlist, trace, and this run's own statement numbers (Q1, Q2, ...) */
  private sql: SqlRunner;
  private cite = 0;
  private metrics: RunMetrics = { modelCalls: 0, plannerCalls: 0, discoveries: 0, reusedViews: 0 };
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
    this.hedgeMs = deps.hedgeMs ?? (process.env.PSIG_HEDGE_MS === "off" ? Infinity : Number(process.env.PSIG_HEDGE_MS || 10_000));
    const run = deps.sql.run.bind(deps.sql);
    this.sql = { run: async (sql, opts) => {
      // One statement per call, and only SELECT or onboarding DDL (quoted text may contain anything).
      const bare = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"[^"]*"/g, '""');
      if (!/^\s*(SELECT\b|CREATE\s+(LIGHTNING\s+(DATABASE|REST\s+TABLE)|SCHEMASTORE\s+(CONTAINER|VIEW))\b)/i.test(sql) || /;\s*\S/.test(bare)) {
        this.log("error", `blocked statement (only SELECT and onboarding DDL are allowed): ${sql.split("\n")[0].slice(0, 80)}`);
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
  private hedged(what: string, call: (signal: AbortSignal) => Promise<ChatResult>): Promise<ChatResult> {
    if (!Number.isFinite(this.hedgeMs)) return call(new AbortController().signal);
    return new Promise<ChatResult>((resolve, reject) => {
      let launched = 0;
      let failed = 0;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const inFlight: AbortController[] = [];
      const hedge = (why: string) => {
        if (done || launched > 1) return;
        clearTimeout(timer);
        this.log("warn", `${what}: ${why} - sent the same request again; the first reply wins`);
        launch();
      };
      const launch = () => {
        const n = ++launched;
        const ctl = new AbortController();
        inFlight.push(ctl);
        call(ctl.signal).then(
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

  // ---------- 1. understand the messy request ----------
  async parse(raw: string): Promise<Request> {
    const prompt = `Extract the pricing request as JSON with keys:
countries (array of strings as the user wrote them), concept (one of: food, all_items, snacks, condiments, or a short noun), concept_words (2-4 lowercase words an official statistics label might use),
proposed_change_pct (signed number or null, preserve price reductions), cost_increase_pct (signed number or null, only if the user states how much their own costs changed), cost_share_pct (0..100 or null, only if the user states current unit cost / current selling price as a percentage), pass_through (0..1 or null, the share of the monetary cost increase to recover in selling prices), policy_statement (string or null).
These percentages have different denominators: never infer cost_share_pct from a cost increase, pass-through policy, or proposed change. For "same as last time", return null for values the user did not change. Do not invent a cost share. The concept is the category whose inflation or prices the user asks to compare; product names introducing their business do not override an explicit comparison category.
Request: """${raw}"""
Reply with JSON only.`;
    let j: any = {};
    try {
      const r = await this.hedged("request parsing", (signal) => this.llm([{ role: "user", content: prompt }], { lane: "fast", temperature: 0, attempts: 1, timeoutMs: 60_000, signal }));
      j = extractJson(r.text) ?? {};
      this.log("llm", `parsed request (${r.model}, ${r.ms} ms${via(r)})`, j);
    } catch (e) {
      this.log("warn", `LLM parse failed, using rules: ${String(e).slice(0, 120)}`);
    }
    // Only the model's list can name a market we do not cover; scanning the words of the question
    // (when the model gave no list) must not turn "same", "as", "last" into markets.
    const named: string[] = Array.isArray(j.countries) ? j.countries.map(String) : [];
    const countries: Country[] = [];
    const unknown: string[] = [];
    for (const c of named.length ? named : raw.split(/[\s,&/]+/)) {
      const n = normalizeCountry(c.replace(/[^\p{L}]/gu, ""), named.length > 0);
      if (n && !countries.includes(n)) countries.push(n);
      else if (!n && named.length) unknown.push(c);
    }
    const intent = explicitMarketConcept(raw);
    const concept = intent.concept ?? (cleanConcept(j.concept) || "food");
    const words = intent.concept ? CONCEPT_WORDS[concept] : Array.isArray(j.concept_words) && j.concept_words.length ? j.concept_words.map((w: unknown) => String(w).toLowerCase()) : CONCEPT_WORDS[concept] ?? [concept];
    // "same as last time": start from the request H-MEM remembered, keep only what the user changed.
    const sameAsLast = sameAsLastRequest(raw);
    const last = sameAsLast ? this.deps.memory.lastRequest() : undefined;
    const explicitCountries = raw.split(/[^\p{L}]+/u).map((w) => normalizeCountry(w, false)).filter((c): c is Country => !!c);
    if (last) {
      if (explicitCountries.length) countries.splice(0, countries.length, ...new Set(explicitCountries));
      else if (!named.some(c => raw.toLowerCase().split(/[^\p{L}]+/u).includes(c.toLowerCase()))) countries.splice(0, countries.length, ...(last.request.countries as Country[]));
      this.log("memory", `recalled last request ${last.id}: markets ${last.request.countries.join(", ")}, category "${last.request.concept}"${last.request.proposedChangePct !== undefined ? `, ${signedPct(last.request.proposedChangePct)}` : ""}`);
    }
    // Nothing named and nothing remembered: the demo markets, said in the brief. Only unsupported markets named: none.
    const defaultMarkets = !countries.length && !unknown.length;
    if (defaultMarkets) countries.push("DE", "CA", "AU");
    const percentages = requestPercentages(raw, j);
    const { passThrough, costIncreasePct: costPct, costSharePct, proposedChangePct: explicitPct } = percentages;
    const req: Request = {
      raw,
      countries,
      concept: intent.concept ?? last?.request.concept ?? concept,
      conceptWords: intent.concept ? words : last?.request.conceptWords ?? words,
      proposedChangePct: explicitPct ?? last?.request.proposedChangePct,
      passThrough,
      costIncreasePct: costPct ?? (last ? last.request.costIncreasePct : undefined),
      costRemembered: costPct === undefined && last?.request.costIncreasePct !== undefined ? true : undefined,
      costSharePct: percentages.invalidCostShare ? undefined : costSharePct ?? last?.request.costSharePct,
      costShareRemembered: !percentages.invalidCostShare && costSharePct === undefined && last?.request.costSharePct !== undefined ? true : undefined,
      invalidPassThrough: percentages.invalidPassThrough || undefined,
      inputIssues: [...percentages.issues, ...intent.issues].length ? [...percentages.issues, ...intent.issues] : undefined,
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
    if (req.defaultMarkets) notes.push(`No market was named in the question, so the brief covers the default markets ${req.countries.join(", ")}.`);
    if (!req.countries.length) {
      // Only markets PriceSignal does not cover were named: say so instead of answering for markets nobody asked about.
      const brief: Brief = { request: req, facts: [], notes, passThrough: req.passThrough ?? memory.latestPolicy()?.policy ?? 1, compared: { id: "-", sql: "", columns: COMPARE_COLUMNS, rows: [], ms: 0 }, sqlLog: this.sqlLog, views: [], ms: Date.now() - t0, trace: this.trace };
      brief.markdown = renderBrief(brief);
      this.log("done", `none of the markets in the question is covered (${req.unknownCountries.join(", ")}) - nothing to compare`);
      return brief;
    }
    const key = (c: string, k: string) => `${c}:${k}`;

    const rememberedPairs = pairs.filter((p) => memory.findMapping(p.country, p.concept)?.mapping);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PLANNER },
      { role: "user", content: `Task: ${JSON.stringify({ request: raw, needed: pairs, concept_words: req.conceptWords, in_memory: rememberedPairs })}` },
    ];
    let compared: SqlResult | undefined;
    let comparedViews = -1; // views.size when the last federated query ran
    let badReplies = 0;
    let autopilot = rememberedPairs.length === pairs.length;
    if (autopilot) this.log("plan", "all needed series have remembered mappings - skipping the planner; verifying the live Zetaris views");

    // A pair is settled when it has a view, or when its agency was asked and has no usable series (":gaveup").
    const unsettled = () => pairs.filter((p) => !views.has(key(p.country, p.concept)) && !candidates.has(key(p.country, p.concept) + ":gaveup"));
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
          const r = await this.hedged("planner", (signal) => this.llm(messages, { lane: "fast", temperature: 0.1, maxTokens: 6000, attempts: 1, timeoutMs: 75_000, signal }));
          const j = extractJson(r.text);
          batch = Array.isArray(j?.actions) ? j.actions.filter((a: any) => a?.action).slice(0, 8) : j?.action ? [j] : [];
          if (!batch.length) throw new Error(`no action in: ${r.text.slice(0, 120)}`);
          messages.push({ role: "assistant", content: JSON.stringify({ thought: j.thought, actions: batch }) });
          this.log("plan", `${batch.map((b) => `${b.action} ${JSON.stringify(b.args ?? {})}`).join(" · ")}  [${r.model}${via(r)}]`, { thought: j.thought, model: r.model, ms: r.ms });
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
      if (autopilot && !batch.length) {
        const a = nextAutopilot(missing, candidates, views, compared, memory, key);
        batch = a ? [a] : [];
      }
      if (!batch.length) break;

      const observations: unknown[] = [];
      let finished = false;
      const sctx = { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c: SqlResult) => { compared = c; comparedViews = views.size; } };
      const results = await this.executeBatch(batch, req, sctx);
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

    if (!compared) {
      // Guardrail: never leave without the federated query if any view exists.
      if (views.size) await this.execute({ action: "compare", args: {} }, req, { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c) => (compared = c) });
    }
    if (!compared) throw new Error("No market could be onboarded; see trace.");

    // ---------- 3. facts are computed by code, narrative by the model ----------
    const remembered = req.passThrough === undefined && !req.invalidPassThrough ? memory.latestPolicy() : undefined;
    const policy = req.passThrough ?? remembered?.policy ?? 1.0;
    const policySource = req.invalidPassThrough ? "invalid input; cost-recovery target omitted" : req.passThrough !== undefined ? "stated in this request" : remembered ? `remembered from an earlier request (${remembered.id})` : "default: recover the full monetary cost increase (no policy given)";
    if (remembered) this.log("memory", `using remembered pricing policy ${remembered.id}: ${Math.round(policy * 100)}%`);
    const facts: MarketFacts[] = buildFacts(rowsAsObjects(compared, COMPARE_COLUMNS), req, compared.id, policy);
    const alignment = buildAlignment(rowsAsObjects(compared, COMPARE_COLUMNS), req, facts, compared.id);
    for (const p of pairs) if (!views.has(key(p.country, p.concept))) notes.push(`${p.country} ${p.concept}: no usable official series was found.`);
    const ctx = { views, candidates, notes, key, pairs, getCompared: () => compared, setCompared: (c: SqlResult) => (compared = c) };
    const ensureView = async (country: Country, concept: Concept) => {
      if (!views.has(key(country, concept)) && memory.findMapping(country, concept)?.mapping) await this.execute({ action: "use_memory_mapping", args: { country, concept } }, req, ctx);
      if (!views.has(key(country, concept))) await this.execute({ action: "discover_and_onboard", args: { country, concept } }, req, ctx);
      return views.get(key(country, concept));
    };
    const snapshotMetrics = (): RunMetrics => ({ ...this.metrics, reusedViews: [...views.values()].filter((v) => v.via === "memory").length });
    // Market facts are useful immediately; do not hide them behind slower SKU discovery and pricing.
    this.metrics.numbersMs = Date.now() - t0;
    const marketPartial: Brief = { request: req, facts, alignment, notes: [...notes], passThrough: policy, policySource, compared, sqlLog: [...this.sqlLog], views: [...views.entries()].map(([k, v]) => ({ key: k, ...v })), ms: this.metrics.numbersMs, trace: [...this.trace], metrics: snapshotMetrics(), partialStage: "markets" };
    this.log("progress", `market numbers ready in ${(this.metrics.numbersMs / 1000).toFixed(1)} s - pricing SKUs and writing the summary`);
    this.emit("partial", marketPartial);
    // The narrative only needs the market facts, so the model writes it while Zetaris prices the SKUs.
    const narrativeP = this.narrate(req, facts, [...notes], policy);
    const pricing = await this.priceList(req, views, facts, policy, ensureView, notes);
    const sinceLast = this.compareWithLastBrief(facts, req, policy);
    // Everything in the brief except the prose is ready: let the UI show it while the model finishes writing.
    const partial: Brief = { request: req, facts, alignment, notes, passThrough: policy, policySource, skus: pricing?.skus, pricingQuery: pricing?.query, sinceLast, compared, sqlLog: [...this.sqlLog], views: [...views.entries()].map(([k, v]) => ({ key: k, ...v })), ms: Date.now() - t0, trace: [...this.trace], metrics: snapshotMetrics(), partialStage: "pricing" };
    this.emit("partial", partial);
    const { narrative, issue: narrativeIssue } = await narrativeP;
    memory.rememberRequest(req);
    const brief: Brief = { request: req, facts, alignment, notes, narrative, narrativeIssue, passThrough: policy, policySource, skus: pricing?.skus, pricingQuery: pricing?.query, sinceLast, compared, sqlLog: this.sqlLog, views: [...views.entries()].map(([k, v]) => ({ key: k, ...v })), ms: Date.now() - t0, trace: this.trace, metrics: snapshotMetrics() };
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
          const probe = await this.sql.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${hit.mapping.view} WHERE yoy_pct IS NOT NULL`);
          const count = probe.rows[0]?.[0];
          const latest = probe.rows[0]?.[1];
          if (!isUsableObservationCount(count) || !hasFreshPeriod(latest, hit.mapping.frequency)) {
            this.log("memory", `remembered view psig.${hit.mapping.view} has invalid, empty, future or stale observations (latest ${String(latest ?? "unknown")}) - not reusing it`);
            return { error: `remembered view psig.${hit.mapping.view} has no usable fresh dated rows; discover_and_onboard again` };
          }
          const n = Number(count);
          s.views.set(s.key(country, concept), { view: hit.mapping.view, label: hit.mapping.label, via: "memory", note: hit.mapping.note, memoryId: hit.id });
          const remembered = `${country}: ${hit.mapping.note} (remembered from an earlier run)`;
          if (hit.mapping.note && !s.notes.includes(remembered)) s.notes.push(remembered);
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
            const note = `${country}: ${AGENCY_FOR[country].name} did not answer for "${concept}" (${String(e).replace(/^Error: /, "").slice(0, 80)}).`;
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
          if (!list?.length) return { error: "run discover_series for this pair first" };
          const c = list[Math.max(0, Math.min(list.length - 1, Number(a.candidate ?? 0)))];
          if (!c || !marketCategoryUsable(concept, c)) {
            this.log("warn", `refused ${c?.label ?? "invalid candidate"} for ${country} ${concept}: market coverage guard failed`);
            return { error: "candidate failed the market coverage guard; use a suitable category or verified Food alternative" };
          }
          let r = await this.onboardFn(this.sql, c, concept);
          if (r.ok && (!isUsableObservationCount(r.rows) || !hasFreshPeriod(r.latest, c.frequency))) {
            r = { ...r, ok: false, error: `view has no usable fresh dated rows (latest ${String(r.latest ?? "unknown")})` };
          }
          const how = onboardingSummary(r);
          this.log("onboard", `${r.ok ? "onboarded" : "FAILED"} ${c.agency} ${c.code} -> psig.${r.view}${r.ok ? ` (${how}: ${r.rows} rows, latest ${r.latest})` : `: ${r.error}`}`, { candidate: c, result: { ...r, sql: r.sql } });
          if (r.ok) {
            const own: string[] = [...((s.candidates as any).get(s.key(country, concept) + ":notes") ?? [])];
            if (c.isBroadFallback || concept !== "food" && concept !== "all_items" && isOfficialBroadFood(c)) {
              const broader = `${c.label} is used as a broader category proxy (coarser) for ${concept}.`;
              own.push(broader);
              s.notes.push(`${country}: ${broader}`);
            }
            const note = own.join(" ") || undefined;
            s.views.set(s.key(country, concept), { view: r.view, label: c.label, via: "onboarded", note });
            const id = memory.rememberMapping({ country, concept, agency: c.agency, dataset: c.dataset, code: c.code, label: c.label, view: r.view, frequency: c.frequency, decoderVersion: sourceDecoderVersion(c.agency), note });
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
          const res = await this.sql.run(compareSql(vs, monthsBack(15)));
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
    } catch (e) {
      this.log("warn", `price list registration failed: ${String(e).slice(0, 160)}`);
      return undefined;
    }
    let allowLegacyFallback = false;
    try {
      const catRes = await this.sql.run(skuCategoriesSql(req.countries));
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
        notes.push("No usable SKU category information was returned; SKU prices are omitted.");
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
      const res = await this.sql.run(skuRatesSql([...new Set([...skuViews.values()].map((v) => v.view))], req.countries, monthsBack(15)));
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
      if (hit && decoderCurrent && mapping?.selectionVersion === SELECTION_VERSION && mapping.selection?.by === "model" && !memory.hmem.store.get(hit.id)?.tags.includes("review")) {
        try {
          const probe = await this.sql.run(`SELECT COUNT(*) AS n, MAX(period) AS latest FROM psig.${mapping.view} WHERE yoy_pct IS NOT NULL`);
          const latest = probe.rows[0]?.[1];
          if (isUsableObservationCount(probe.rows[0]?.[0]) && hasFreshPeriod(latest, mapping.frequency)) {
            const selected: SkuView = { view: mapping.view, note: mapping.note, selectionReason: mapping.selection.fit === "broader" ? BROADER_COVERAGE_REASON : mapping.selection.reason, selectionSource: "memory", selectionFit: mapping.selection.fit };
            skuViews.set(id, selected);
            views.set(`${id}:${scope}`, { view: mapping.view, label: mapping.label, via: "memory", note: mapping.note, memoryId: hit.id });
            if (mapping.note) notes.push(`${country} ${concept}: ${mapping.note} (remembered SKU selection)`);
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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("SKU selection time budget expired")); }, 20_000);
      });
      const reply = await Promise.race([
        this.llm(selectionMessages(groups), { lane: "fast", temperature: 0, maxTokens: 2500, attempts: 1, timeoutMs: 20_000, signal: controller.signal }),
        expired,
      ]);
      decisions = validateSelections(extractJson(reply.text), groups, reply.model);
      this.log("llm", `SKU category selection (${reply.model}, ${reply.ms} ms${via(reply)}) - ${groups.length} product group(s) checked in one request`);
    } catch (e) {
      this.log("warn", `SKU category selection unavailable or invalid - using marked Food fallbacks where available (${String(e).slice(0, 140)})`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await byAgency(groups, async (group) => {
      let decision = decisions.get(group.id) ?? fallbackSelection(group);
      if (!decision) {
        notes.push(`${group.country} ${group.concept}: no verified category or official Food fallback is available; these SKU prices are omitted.`);
        return;
      }
      const register = async (choice: SelectionDecision) => {
        const candidate = group.candidates[choice.candidate];
        try {
          const result = await this.onboardFn(this.sql, candidate, group.concept);
          this.log("onboard", `${result.ok ? "onboarded" : "FAILED"} SKU ${candidate.agency} ${candidate.code} -> psig.${result.view}${result.ok ? ` (${onboardingSummary(result)}: ${result.rows} rows, latest ${result.latest})` : `: ${result.error}`}`, { candidate, selection: choice, result });
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
      if (decision.fit === "broader") ownNotes.push(`${candidate.label} is used as a broader category proxy (coarser) for these products${decision.by === "fallback" ? "; a product-specific selection was unavailable or unusable" : ""}.`);
      const note = [...new Set(ownNotes)].join(" ") || undefined;
      if (note) notes.push(`${group.country} ${group.concept}: ${note}`);
      skuViews.set(group.id, { view: result.view, note, selectionReason: decision.reason, selectionSource: decision.by, selectionFit: decision.fit });
      let memoryId: string | undefined;
      if (decision.by === "model") {
        memoryId = memory.rememberMapping({ country: group.country, concept: group.concept, agency: candidate.agency, dataset: candidate.dataset, code: candidate.code, label: candidate.label, view: result.view, frequency: candidate.frequency, decoderVersion: sourceDecoderVersion(candidate.agency), note, scope, selectionVersion: SELECTION_VERSION, selection: decision });
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
      const res = await this.sql.run(pricingSql([...new Set(catViews)], req.countries));
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
        let comparable = o.methodVersion === 2 && !!o.sourceId && o.sourceId === s.sourceId && (o.decoderVersion ?? 1) === decoderVersion;
        if (o.methodVersion !== 2) parts.push("methodology changed: the earlier policy-scaled range and current historical market benchmark are not directly comparable");
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
      if (!retainNewerOutcome) memory.rememberOutcome({ country: f.country, concept: s.concept, period: s.latestPeriod, yoy: s.latestYoy, low: f.suggested.low, high: f.suggested.high, policy: req.invalidPassThrough ? undefined : policy, proposed: req.proposedChangePct, verdict: f.verdict, sourceId: s.sourceId, methodVersion: 2, decoderVersion, at: new Date().toISOString() });
    }
    if (out.length) this.log("memory", `compared with ${out.length} remembered brief outcome(s): ${out.map((x) => x.split(" (")[0]).join(", ")}`, out);
    return out;
  }

  private async narrate(req: Request, facts: MarketFacts[], notes: string[], policy: number): Promise<{ narrative?: Narrative; issue?: NarrativeIssue }> {
    // Caveats are written by code (e.g. "no data after 2025-12 (10 months ago)"), so their numbers may be repeated.
    const noteNumbers = [...new Set(notes)].join(" ").replace(/\b(19|20)\d{2}(-(Q[1-4]|\d{2}))?\b/g, " ").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const allowed = [...allowedNumbers(facts, req, policy), ...noteNumbers];
    const payload = { request: req.raw, proposed_change_pct: req.proposedChangePct ?? null, cost_increase_pct: req.costIncreasePct ?? null, cost_share_pct: req.costSharePct ?? null, cost_share_basis: "current unit cost / current selling price", cost_pass_through_pct: req.invalidPassThrough ? null : Math.round(policy * 100), facts: factsForNarrative(facts, req, policy), caveats: [...new Set(notes)] };
    const ask: ChatMessage[] = [
      { role: "system", content: "You write short, plain-English pricing briefs for an exporter's pricing manager. Use ONLY numbers that appear in the facts JSON, written with the same rounding. Copy benchmark_range_pct low and high exactly; never compute a range yourself. This is a historical year-on-year consumer-price benchmark, not a recommended price, willingness-to-pay estimate, or forecast. Each market's verdict field is final: say it as given (above, within or below the market benchmark), keeping every market and the headline consistent. Average coverage states how many monthly or quarterly observations were available; do not call partial coverage a complete annual average or insufficient history a flat trend. cost_need_pct, when provided, is a conditional cost-recovery scenario computed from current unit cost / current selling price, stated cost change and monetary cost pass-through. It does not assume or preserve a profit margin. If cost share or a valid policy is absent, do not invent a price target from the cost increase. Use cost_vs_market exactly when comparing that scenario with the historical benchmark. Never write internal JSON keys in the prose; name the cost recovery target and its explicit percentage as the subject of a cost comparison, separately from the proposed price change. No new numbers, no predictions about customers accepting a price. Mention the caveats supplied in the facts JSON and do not invent other source or methodology claims." },
      { role: "user", content: `Facts: ${JSON.stringify(payload)}\nReply with JSON only: {"headline": str (<= 25 words), "markets": {"<country code>": str (2-3 sentences: what the data says and what it means for the proposed change)}, "watch": str (one sentence on what to re-check next month)}` },
    ];
    // One time budget for the prose, retries included: the numbers never wait more than this for the words.
    const deadline = Date.now() + Number(process.env.PSIG_NARRATIVE_BUDGET_MS || 55_000);
    let issue: NarrativeIssue | undefined; // why the last attempt failed, so the brief states the real reason
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 8_000) {
        this.log("warn", "narrative time budget used up - the brief uses the computed summary");
        issue ??= "budget";
        break;
      }
      try {
        const r = await this.hedged("narrative", (signal) => this.llm(ask, { lane: (process.env.PSIG_NARRATIVE_LANE as "fast" | "deep") || "fast", temperature: 0.2, maxTokens: 8000, attempts: 1, timeoutMs: Math.max(1_000, deadline - Date.now()), signal }));
        const n = extractJson(r.text) as Narrative | null;
        if (!n?.headline) throw new Error(`no headline in reply: ${r.text.replace(/\s+/g, " ").slice(0, 160)}`);
        const bad = checkNarrative(n, allowed, facts, req, policy, noteNumbers);
        this.log("llm", `narrative (${r.model}, ${r.ms} ms${via(r)})${bad.length ? ` - does not match the facts: ${bad.join(", ")}` : " - numbers and verdicts match the facts"}`);
        if (!bad.length) return { narrative: { ...n, markets: Object.fromEntries(Object.entries(n.markets ?? {}).map(([k, v]) => [marketKey(k), v])) } };
        issue = "grounding";
        ask.push({ role: "assistant", content: r.text }, { role: "user", content: `These numbers, ranges or verdicts do not match the facts for that market: ${bad.join(", ")}. Rewrite using only that market's numbers; the benchmark range must be exactly benchmark_range_pct low to high, and each market's verdict must be exactly its verdict field. JSON only.` });
      } catch (e) {
        this.log("warn", `narrative attempt failed: ${String(e).slice(0, 120)}`);
        issue = /no headline in reply/.test(String(e)) ? "unusable" : "provider";
        // Failures through Nightshift come and go from one request to the next, so the next attempt runs while the budget lasts.
      }
    }
    return { issue }; // renderBrief falls back to a deterministic summary
  }
}

// ---------- helpers ----------
type ExecCtx = { views: Map<string, any>; candidates: Map<string, Candidate[]>; notes: string[]; key: (a: string, b: string) => string; pairs: { country: Country; concept: Concept }[]; getCompared: () => SqlResult | undefined; setCompared: (c: SqlResult) => void };
type SkuView = { view: string; note?: string; selectionReason?: string; selectionSource?: "model" | "memory" | "fallback"; selectionFit?: "specific" | "broader" };

function onboardingSummary(result: { existed: boolean; createdObjects?: number; existingObjects?: number }): string {
  if (result.createdObjects !== undefined && result.existingObjects !== undefined) return `created ${result.createdObjects} SQL object${result.createdObjects === 1 ? "" : "s"}; ${result.existingObjects} already existed; verified`;
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

/** Which runtime answered a model call, shown next to the model name in the trace. */
function via(r: ChatResult): string {
  return r.provider === "meterless" ? " via Meterless Nightshift" : ` via ${r.provider}`;
}

/** A concept name from the model ends up in view names and SQL string literals: keep it to plain words. */
function cleanConcept(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).toLowerCase().replace(/['"`\\;]/g, "").trim();
}

function sameAsLastRequest(raw: string): boolean {
  return /\b(same as (last|before|previous)|like last time|as last time|as usual|same again)\b|지난번|저번|지난 분기|같은 조건/i.test(raw);
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

/** Percentages are grounded in the request, with separate denominators and explicit signs. */
function requestPercentages(raw: string, model: any): {
  proposedChangePct?: number; costIncreasePct?: number; costSharePct?: number; passThrough?: number;
  invalidCostShare: boolean; invalidPassThrough: boolean; issues: string[];
} {
  const matches = [...raw.matchAll(/([+＋\-−－]?)\s*(\d+(?:\.\d+)?)\s*(?:%|pct\b|percent\b|퍼센트|프로)/gi)];
  const clauseBoundary = /[,;!?\n]|\b(?:but|and|while|whereas)\b|하지만|그런데|반면|그리고/i;
  const found = matches.map((m, i) => {
    const from = i ? matches[i - 1].index! + matches[i - 1][0].length : 0;
    const end = m.index! + m[0].length;
    const before = raw.slice(Math.max(from, m.index! - 80), m.index).split(clauseBoundary).at(-1)!;
    const after = raw.slice(end, Math.min(matches[i + 1]?.index ?? raw.length, end + 70)).split(clauseBoundary)[0];
    const costWords = /\bcosts?\b|원가|비용|\binput\b|\bingredient\b|\bmaterial\b|\bfreight\b/i;
    const share = /cost[ -]*(?:share|ratio)|costs?[ -]*(?:to|\/)[ -]*(?:selling[ -]*)?price|원가\s*비중|비용\s*비중|판매가.*(?:원가|비용)|(?:원가|비용).*판매가/i.test(before)
      || /^\s*(?:(?:unit|current)\s+)?cost[ -]*(?:share|ratio)\b|^\s*(?:원가|비용)\s*비중/i.test(after)
      || (costWords.test(before) && /^\s*(?:of\s+)?(?:(?:the|our|current)\s+)*(?:(?:selling|sales|sale|retail)\s+)?price\b/i.test(after));
    const pass = !share && (/\bpass(?:ed|ing)?\b|\brecover(?:y)?\b|반영|전가|회수/i.test(before)
      || /^\s*(?:pass[ -]?(?:through|thru)|반영|전가|회수)/i.test(after));
    const cost = !share && !pass && (costWords.test(before) || /^\s*(?:costs?\s+(?:rise|increase|growth|change)|원가\s*(?:상승|증가))/i.test(after));
    // A later price clause cannot reverse an earlier cost change, even without punctuation.
    const directionAfter = cost ? after.split(/\b(?:prices?|selling)\b|가격/i)[0] : after;
    const direction = /\b(?:fall|fell|decreas\w*|reduc\w*|cut|lower\w*)\b|인하|내리|하락|감소/i.test(`${before} ${directionAfter}`);
    const x = Number(m[2]) * (/^[\-−－]$/.test(m[1]) || (!m[1] && !share && !pass && direction) ? -1 : 1);
    return { x, signed: !!m[1], share, pass, cost };
  });
  const choose = (kind: "share" | "pass" | "cost", modelValue: unknown, scale = 1) => {
    const options = found.filter(p => p[kind]);
    const fromModel = numOrUndef(modelValue);
    return options.find(p => fromModel !== undefined && Math.abs(p.x - fromModel * scale) < 1e-9)?.x ?? options.at(-1)?.x;
  };
  const share = choose("share", model.cost_share_pct);
  const passPct = choose("pass", model.pass_through, 100);
  const invalidCostShare = share !== undefined && (share < 0 || share > 100);
  const invalidPassThrough = passPct !== undefined && (passPct < 0 || passPct > 100);
  const proposals = found.filter(p => !p.share && !p.pass && !p.cost);
  const fromModel = numOrUndef(model.proposed_change_pct);
  const proposal = proposals.find(p => p.signed)
    ?? proposals.find(p => fromModel !== undefined && Math.abs(p.x - fromModel) < 1e-9)
    ?? proposals[0];
  const issues: string[] = [];
  if (invalidCostShare) issues.push("Cost share must be between 0% and 100% of the current selling price; the invalid value is not reused from memory and the cost-recovery target is omitted.");
  if (invalidPassThrough) issues.push("Cost pass-through must be between 0% and 100% of the monetary cost increase; the invalid policy is not replaced by a remembered value and the cost-recovery target is omitted.");
  return {
    proposedChangePct: proposal?.x,
    costIncreasePct: choose("cost", model.cost_increase_pct),
    costSharePct: invalidCostShare ? undefined : share,
    passThrough: invalidPassThrough || passPct === undefined ? undefined : passPct / 100,
    invalidCostShare, invalidPassThrough, issues,
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
