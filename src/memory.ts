// Agent memory on Meterless H-MEM. What PriceSignal remembers across sessions:
//  - series mappings it had to discover ("DE food -> eurostat prc_hicp_minr CP01, view v_de_food_cp01")
//  - the user's pricing policy ("we pass through 70% of cost inflation")
//  - outcomes of past briefs
// Mappings are also kept as structured JSON tags so a recalled memory can be
// acted on (skip discovery and onboarding) rather than only quoted.
import path from "node:path";
import { ROOT, env } from "./env.ts";
import { HMEM } from "./hmem_impl.ts";

export interface SeriesMapping { country: string; concept: string; agency: string; dataset: string; code: string; label: string; view: string; frequency: string; note?: string }

export interface Recall { id: string; content: string; relevance: number; mapping?: SeriesMapping; policy?: number }

export class AgentMemory {
  readonly hmem: any;
  constructor(dir = path.resolve(ROOT, env("PSIG_MEMORY_DIR", ".pricesignal/memory"))) {
    this.hmem = new HMEM({ persistDir: dir, actor: "pricesignal" });
  }

  rememberMapping(m: SeriesMapping): string {
    const content = `Series mapping: ${m.country} ${m.concept} -> ${m.agency} ${m.dataset} ${m.code} (${m.label}), ${m.frequency}, Zetaris view psig.${m.view}.${m.note ? ` Note: ${m.note}` : ""}`;
    const rec = this.hmem.add({
      content,
      type: "factual",
      source: "pricesignal:onboard",
      confidence: 0.9,
      tags: ["series-mapping", `country:${m.country}`, `concept:${m.concept}`, `json:${JSON.stringify(m)}`],
      layer: "long_term",
      supersedes: this.findMapping(m.country, m.concept)?.id,
    });
    return rec.id;
  }

  rememberPolicy(passThrough: number, statement: string): string {
    const rec = this.hmem.add({
      content: `Pricing policy: ${statement} (pass-through ${Math.round(passThrough * 100)}% of category inflation)`,
      type: "preference",
      source: "pricesignal:user",
      confidence: 0.95,
      tags: ["pricing-policy", `passthrough:${passThrough}`],
      layer: "long_term",
    });
    return rec.id;
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
  findMapping(country: string, concept: string): Recall | undefined {
    const recs = this.structured("series-mapping").filter((i) => i.mapping?.country === country && i.mapping?.concept === concept);
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
      mapping: json ? (JSON.parse(json.slice(5)) as SeriesMapping) : undefined,
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
