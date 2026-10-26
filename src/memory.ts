// Agent memory on Meterless H-MEM. What PriceSignal remembers across sessions:
//  - series mappings it had to discover ("DE food -> eurostat prc_hicp_minr CP01, view v_de_food_cp01")
//  - the user's pricing policy ("we recover 70% of the monetary cost increase")
//  - outcomes of past briefs (per market), so the next brief says what changed since
// Mappings are also kept as structured JSON tags so a recalled memory can be
// acted on (skip discovery and onboarding) rather than only quoted.
import path from "node:path";
import { ROOT, env } from "./env.ts";
import { HMEM } from "./hmem_impl.ts";
import type { SelectionDecision } from "./selection.ts";

export interface SeriesMapping { country: string; concept: string; agency: string; dataset: string; code: string; label: string; view: string; frequency: string; note?: string; scope?: string; selectionVersion?: number; selection?: SelectionDecision }

export interface Outcome { country: string; concept: string; period: string; yoy: number; low: number; high: number; policy?: number; proposed?: number; verdict?: string; sourceId?: string; methodVersion?: number; at: string }

export interface Recall { id: string; content: string; relevance: number; mapping?: SeriesMapping; policy?: number }

export class AgentMemory {
  readonly hmem: any;
  constructor(dir = path.resolve(ROOT, env("PSIG_MEMORY_DIR", ".pricesignal/memory"))) {
    this.hmem = new HMEM({ persistDir: dir, actor: "pricesignal" });
  }

  rememberMapping(m: SeriesMapping): string {
    const content = `Series mapping: ${m.country} ${m.concept}${m.scope ? ` [${m.scope}]` : ""} -> ${m.agency} ${m.dataset} ${m.code} (${m.label}), ${m.frequency}, Zetaris view psig.${m.view}.${m.note ? ` Note: ${m.note}` : ""}`;
    const rec = this.hmem.add({
      content,
      type: "factual",
      source: "pricesignal:onboard",
      confidence: 0.9,
      tags: ["series-mapping", `country:${m.country}`, `concept:${m.concept}`, `json:${JSON.stringify(m)}`],
      layer: "long_term",
      supersedes: this.findMapping(m.country, m.concept, m.scope)?.id,
    });
    return rec.id;
  }

  rememberPolicy(passThrough: number, statement: string): string {
    const rec = this.hmem.add({
      content: `Pricing policy: ${statement} (recover ${Math.round(passThrough * 100)}% of the monetary cost increase in the selling price)`,
      type: "preference",
      source: "pricesignal:user",
      confidence: 0.95,
      tags: ["pricing-policy", `passthrough:${passThrough}`],
      layer: "long_term",
      supersedes: this.latestPolicy()?.id,
    });
    return rec.id;
  }

  /** The last request, so "same as last time" can be resolved next quarter. */
  rememberRequest(r: { countries: string[]; concept: string; conceptWords: string[]; proposedChangePct?: number; costIncreasePct?: number; costSharePct?: number; raw: string }): string {
    const slim = { countries: r.countries, concept: r.concept, conceptWords: r.conceptWords, proposedChangePct: r.proposedChangePct, costIncreasePct: r.costIncreasePct, costSharePct: r.costSharePct };
    return this.hmem.add({
      content: `Last pricing request: markets ${r.countries.join(", ")}, category ${r.concept}${r.proposedChangePct !== undefined ? `, proposed ${r.proposedChangePct > 0 ? "+" : ""}${r.proposedChangePct}%` : ""} ("${r.raw.slice(0, 160)}")`,
      type: "general",
      source: "pricesignal:user",
      confidence: 0.9,
      tags: ["last-request", `json:${JSON.stringify(slim)}`],
      layer: "long_term",
      supersedes: this.lastRequest()?.id,
    }).id;
  }

  lastRequest(): { id: string; request: { countries: string[]; concept: string; conceptWords: string[]; proposedChangePct?: number; costIncreasePct?: number; costSharePct?: number } } | undefined {
    const hit = this.structured("last-request").at(-1);
    if (!hit) return undefined;
    const rec: any = this.hmem.store.all().find((r: any) => r.id === hit.id);
    const json = (rec?.tags ?? []).find((t: string) => t.startsWith("json:"));
    return json ? { id: hit.id, request: JSON.parse(json.slice(5)) } : undefined;
  }

  /** What a brief concluded for one market, so the next brief can say what changed since. */
  rememberOutcome(o: Outcome): string {
    return this.hmem.add({
      content: `Brief outcome: ${o.country} ${o.concept} ${o.period} ${o.yoy}% YoY, ${o.methodVersion === 2 ? "historical market benchmark" : "legacy suggested range"} ${o.low}-${o.high}%${o.policy !== undefined ? `; cost-recovery policy ${Math.round(o.policy * 100)}%` : ""}${o.sourceId ? `; source ${o.sourceId}` : ""}${o.proposed !== undefined ? `, ${o.proposed > 0 ? "+" : ""}${o.proposed}% was ${o.verdict}` : ""} (${o.at.slice(0, 10)})`,
      type: "general",
      source: "pricesignal:agent",
      confidence: 0.9,
      tags: ["brief-outcome", `country:${o.country}`, `concept:${o.concept}`, `json:${JSON.stringify(o)}`],
      layer: "long_term",
      supersedes: this.lastOutcome(o.country, o.concept)?.id,
    }).id;
  }

  lastOutcome(country: string, concept: string): { id: string; outcome: Outcome } | undefined {
    const all: any[] = this.hmem.store.all();
    for (const hit of this.structured("brief-outcome").reverse()) {
      const rec = all.find((r) => r.id === hit.id);
      const json = (rec?.tags ?? []).find((t: string) => t.startsWith("json:"));
      if (!json) continue;
      const o = JSON.parse(json.slice(5)) as Outcome;
      if (o.country === country && o.concept === concept) return { id: hit.id, outcome: o };
    }
    return undefined;
  }

  rememberNote(text: string): string {
    return this.hmem.add({ content: text, type: "general", source: "pricesignal:agent", confidence: 0.7 }).id;
  }

  recall(query: string, topN = 8): { context: string; items: Recall[] } {
    const res = this.hmem.query(query, { topN, threshold: 0.05 });
    const items: Recall[] = res.memories.map((r: any) => this.toRecall(r.memory, Number(r.relevance ?? 0)));
    return { context: res.context ?? "", items };
  }

  /** Structured lookup used by the agent before discovering a series again. */
  findMapping(country: string, concept: string, scope?: string): Recall | undefined {
    const recs = this.structured("series-mapping").filter((i) => i.mapping?.country === country && i.mapping?.concept === concept && i.mapping?.scope === scope);
    const hit = recs.at(-1);
    if (hit) this.hmem.store.touch(hit.id);
    return hit;
  }

  latestPolicy(): Recall | undefined {
    return this.structured("pricing-policy").at(-1);
  }

  /** Records carrying a structured tag, newest last, skipping superseded ones. */
  private structured(tag: string): Recall[] {
    const all: any[] = this.hmem.store.all();
    const superseded = new Set(all.map((r) => r.supersedes).filter(Boolean));
    return all
      .filter((r) => (r.tags ?? []).includes(tag) && !superseded.has(r.id))
      .sort((a, b) => a.timestamp - b.timestamp || Number(a.id.slice(4)) - Number(b.id.slice(4)))
      .map((r) => this.toRecall(r, 1));
  }

  private toRecall(memory: any, relevance: number): Recall {
    const tags: string[] = memory.tags ?? [];
    const json = tags.find((t) => t.startsWith("json:"));
    const pt = tags.find((t) => t.startsWith("passthrough:"));
    return {
      id: memory.id,
      content: memory.content,
      relevance,
      mapping: json && tags.includes("series-mapping") ? (JSON.parse(json.slice(5)) as SeriesMapping) : undefined,
      policy: pt ? Number(pt.slice(12)) : undefined,
    };
  }

  feedback(id: string, kind: "helpful" | "not_helpful"): void {
    try {
      this.hmem.feedback(id, kind);
    } catch {
      /* feedback kinds differ between engine versions; never block the agent on it */
    }
  }
}
