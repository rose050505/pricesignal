import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import type { Candidate, Country } from "../src/sources/types.ts";
import type { SqlResult } from "../src/zetaris.ts";

const candidate = (country: Country, code: string, label: string, broad = false): Candidate => ({
  country, agency: country === "DE" ? "eurostat" : "abs", dataset: "fixture", code: broad ? country === "DE" ? "CP01" : "20001" : code, label,
  frequency: "M", measure: "yoy_pct", status: "active", lastPeriod: "2026-09", sourceUrl: "https://fixture.invalid/unused",
  ...broad ? { isBroadFallback: true } : {},
});

function fixture() {
  const memory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-sku-selection-")));
  const legacy = memory.rememberMapping({ country: "DE", concept: "snacks", agency: "eurostat", dataset: "fixture", code: "sugar", label: "Sugar, confectionery and desserts", view: "legacy_de_snacks", frequency: "M" });
  for (const country of ["DE", "AU"] as const) for (const concept of ["food", "all_items"]) memory.rememberMapping({ country, concept, agency: country === "DE" ? "eurostat" : "abs", dataset: "fixture", code: concept, label: concept === "food" ? "Food" : "All items", view: `market_${country}_${concept}`, frequency: "M" });
  const registered = new Map<string, { country: Country; concept: string; candidate: Candidate }>([
    ["legacy_de_snacks", { country: "DE", concept: "snacks", candidate: candidate("DE", "sugar", "Sugar, confectionery and desserts") }],
  ]);
  const state = { selections: 0, discoveries: 0, reply: "valid", failSpecific: false, failAll: false, noCandidates: false, falseBroad: "", categoryFailure: "", joinError: false, staleSku: false, probePeriod: undefined as unknown, selectedPeriod: undefined as unknown, allOnboardPeriod: undefined as unknown, extraProduct: "", selectionOptions: [] as any[], prompts: [] as string[], onSelection: undefined as (() => void) | undefined };
  const sql = { async run(query: string): Promise<SqlResult> {
    let rows: unknown[][] = [];
    if (/SELECT DISTINCT country, sku_category/.test(query)) {
      if (state.categoryFailure === "throw") throw new Error("fixture category query unavailable");
      rows = state.categoryFailure === "empty" ? [] : [["DE", "snacks", "Honey butter chips 60 g"], ["DE", "snacks", state.extraProduct || "Chili crisps"], ["AU", "condiments", "Gochujang 500 g"]];
    } else if (/^SELECT COUNT/.test(query)) rows = [[12, /psig\.sku_/.test(query) && state.probePeriod !== undefined ? state.probePeriod : state.staleSku && /psig\.sku_/.test(query) ? "2000-01" : "2026-09"]];
    else if (/p\.sku_category = s\.concept/.test(query)) {
      if (state.joinError) throw new Error("fixture join failed");
      for (const [view, item] of registered) if (query.includes(`psig.${view} `)) {
        for (let month = 1; month <= 9; month++) rows.push([item.concept === "snacks" ? "HBC-60" : "GCJ-500", item.concept === "snacks" ? "Honey butter chips 60 g" : "Gochujang 500 g", item.country, item.concept, "EUR", 2.49, item.concept, item.candidate.label, "M", `2026-0${month}`, 1.4, item.candidate.code]);
      }
    } else if (/^SELECT country, concept/.test(query)) {
      for (const country of ["DE", "AU"]) for (const concept of ["food", "all_items"]) for (let month = 1; month <= 9; month++) rows.push([country, concept, concept === "food" ? "Food" : "All items", "M", `2026-0${month}`, 2, `${country}:${concept}`]);
    }
    return { id: "fake", sql: query, columns: [], rows, ms: 1 };
  } };
  const deps = () => ({ memory, sql, hedgeMs: 1,
    llm: async (messages: any[], opts: any) => {
      const first = messages[0].content as string;
      const last = messages.at(-1).content as string;
      if (last.startsWith("Extract")) return { text: '{"countries":["DE","AU"],"concept":"food","proposed_change_pct":3,"pass_through":0.7}', model: "fake", provider: "fake", ms: 1 };
      if (first.startsWith("You write short")) return { text: '{"headline":"Computed market figures.","markets":{}}', model: "fake", provider: "fake", ms: 1 };
      state.selections++;
      state.selectionOptions.push(opts);
      state.prompts.push(JSON.stringify(messages));
      state.onSelection?.();
      if (state.reply === "pending") return await new Promise<never>((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("selection timeout")), { once: true }));
      if (state.reply === "error") throw new Error("selection provider unavailable");
      if (state.reply === "invalid") return { text: '{"selections":[{"id":"DE:snacks","candidate":99,"fit":"specific","reason":"invented"}]}', model: "nemotron-test", provider: "meterless", ms: 1 };
      const groups = JSON.parse(last).groups;
      return { text: JSON.stringify({ selections: groups.map((g: any) => ({ id: g.id, candidate: g.concept === "snacks" ? 1 : 0, fit: "specific", reason: g.concept === "snacks" ? "Potato crisps cover the named chips and crisps." : "Condiments cover the named sauce." })) }), model: "nemotron-test", provider: "meterless", ms: 1 };
    },
    discoverFn: async (country: Country, concept: string) => {
      state.discoveries++;
      if (state.noCandidates) return { country, concept, candidates: [], notes: [] };
      if (state.falseBroad) {
        const wrong = { ...candidate(country, "narrow", state.falseBroad === "wrongCode" ? "Food" : "Food additives and condiments"), ...(state.falseBroad === "flagged" || state.falseBroad === "wrongCode" ? { isBroadFallback: true } : {}) };
        return { country, concept, candidates: concept === "food" || state.falseBroad !== "extra" ? [wrong] : [candidate(country, "sugar", "Sugar, confectionery and desserts")], notes: [] };
      }
      const candidates = concept === "snacks" ? [candidate(country, "sugar", "Sugar, confectionery and desserts"), candidate(country, "crisps", "Potato crisps"), candidate(country, "food", "Food", true)] : concept === "condiments" ? [candidate(country, "sauce", "Food additives and condiments"), candidate(country, "food", "Food", true)] : [candidate(country, concept, "Food", true)];
      return { country, concept, candidates, notes: [] };
    },
    onboardFn: async (_z: any, c: Candidate, concept: string) => {
      const view = `sku_${c.country}_${concept}_${c.code}`;
      const ok = !state.failAll && !(state.failSpecific && c.code === "crisps");
      if (ok) registered.set(view, { country: c.country, concept, candidate: c });
      const latest = state.allOnboardPeriod !== undefined ? state.allOnboardPeriod : state.selectedPeriod !== undefined && c.code === "crisps" ? state.selectedPeriod : "2026-09";
      return { view, table: "fixture", ok, existed: false, rows: ok ? 9 : 0, latest: latest as string, sql: [], error: ok ? undefined : "fixture unavailable" };
    },
  });
  return { memory, legacy, state, deps };
}

test("SKU selection batches product-aware candidates after market numbers and supersedes no market mapping", async () => {
  const f = fixture();
  const partials: any[] = [];
  f.state.onSelection = () => assert.equal(partials[0]?.partialStage, "markets", "market numbers precede SKU selection");
  const agent = new PriceSignalAgent(f.deps());
  agent.on("partial", b => partials.push(b));
  const brief = await agent.run("DE and AU food +3%, pass through 70%");
  assert.equal(f.state.selections, 1, "all SKU choices use one model request");
  assert.match(f.state.prompts[0], /Honey butter chips/);
  assert.match(f.state.prompts[0], /Chili crisps/);
  assert.match(f.state.prompts[0], /Gochujang/);
  assert.equal(f.state.selectionOptions[0].timeoutMs, 20_000);
  assert.equal(f.state.selectionOptions[0].attempts, 1);
  const de = brief.skus!.find(s => s.country === "DE")!;
  assert.equal(de.rateLabel, "Potato crisps");
  assert.equal((de as any).selectionSource, "model");
  assert.equal((de as any).selectionFit, "specific");
  assert.equal(f.memory.findMapping("DE", "snacks")!.id, f.legacy, "SKU selection cannot replace the market mapping");
  assert.ok(brief.views.some(v => v.key.startsWith("DE:snacks:sku:")));
});

test("verified SKU scopes reuse without model selection, while changed products require a new selection", async () => {
  const f = fixture();
  await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
  f.state.selections = 0;
  f.state.discoveries = 0;
  const repeat = await new PriceSignalAgent(f.deps()).run("same as last time");
  assert.equal(f.state.selections, 0);
  assert.equal(f.state.discoveries, 0);
  assert.ok(repeat.skus!.every(s => (s as any).selectionSource === "memory"));
  f.state.extraProduct = "Chocolate bar";
  await new PriceSignalAgent(f.deps()).run("same as last time");
  assert.equal(f.state.selections, 1, "a different product set is not silently mapped through the old scope");
});

test("invalid selection and provider errors use a marked Food fallback, then retry on the next run", async () => {
  for (const reply of ["invalid", "error"]) {
    const f = fixture();
    f.state.reply = reply;
    const brief = await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
    assert.equal(f.state.selections, 1, "selection is not hedged or retried in the same run");
    assert.ok(brief.skus!.length);
    assert.ok(brief.skus!.every(s => s.rateLabel === "Food" && s.coarser && (s as any).selectionSource === "fallback"));
    assert.equal(f.memory.findMapping("DE", "snacks")!.id, f.legacy);
    await new PriceSignalAgent(f.deps()).run("same as last time");
    assert.equal(f.state.selections, 2, "fallback is not saved as a verified semantic mapping");
  }
});

test("a selected series that fails onboarding falls back to Food instead of the next narrow label", async () => {
  const f = fixture();
  f.state.failSpecific = true;
  const brief = await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
  const de = brief.skus!.find(s => s.country === "DE")!;
  assert.equal(de.rateLabel, "Food");
  assert.equal((de as any).selectionSource, "fallback");
  assert.equal(de.coarser, true);
});

test("scoped mappings cannot supersede or leak into the market mapping lookup", () => {
  const f = fixture();
  const id = f.memory.rememberMapping({ country: "DE", concept: "snacks", agency: "eurostat", dataset: "fixture", code: "crisps", label: "Potato crisps", view: "sku_scope", frequency: "M", scope: "sku:products", selectionVersion: 1 } as any);
  assert.equal(f.memory.findMapping("DE", "snacks")!.id, f.legacy);
  assert.equal((f.memory.findMapping as any)("DE", "snacks", "sku:products")!.id, id);
  assert.equal(f.memory.hmem.store.get(id).supersedes, undefined);
});

test("a broad Food candidate used for a market concept is also disclosed and remembered as a proxy", async () => {
  const f = fixture();
  const notes: string[] = [];
  const agent = new PriceSignalAgent(f.deps());
  const context = { views: new Map(), candidates: new Map([["DE:snacks", [candidate("DE", "food", "Food", true)]]]), notes, key: (country: string, concept: string) => `${country}:${concept}`, pairs: [{ country: "DE", concept: "snacks" }], getCompared: () => undefined, setCompared: () => {} };
  await (agent as any).execute({ action: "onboard_series", args: { country: "DE", concept: "snacks", candidate: 0 } }, { concept: "snacks" }, context);
  assert.match(notes.join(" "), /broader.*proxy.*coarser/i);
  assert.match(f.memory.findMapping("DE", "snacks")!.mapping!.note!, /broader.*proxy.*coarser/i);
});

test("failed SKU verification never silently falls back to the market category", async () => {
  for (const failure of ["noCandidates", "failAll", "joinError"] as const) {
    const f = fixture();
    f.state[failure] = true;
    const brief = await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
    assert.equal(brief.skus, undefined, failure);
    assert.equal(brief.facts.length, 2, "market numbers remain available");
    assert.match(brief.notes.join(" "), /SKU prices are omitted|SKU pricing is unavailable/i, failure);
    assert.ok(!brief.trace.some(e => /pricing on the requested category instead/.test(e.title)), "an unverified flat substitution would hide the selection failure");
  }
});

test("a stale or review-marked SKU memory is selected again instead of being silently trusted", async () => {
  for (const invalidation of ["stale", "review", "version"] as const) {
    const f = fixture();
    await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
    f.state.selections = 0;
    if (invalidation === "stale") f.state.staleSku = true;
    else {
      const record = f.memory.hmem.store.all().find((r: any) => r.tags.some((t: string) => t.startsWith("json:") && t.includes('"scope":"sku:') && t.includes('"country":"DE"')));
      if (invalidation === "review") f.memory.hmem.feedback(record.id, "wrong");
      else {
        const tags = record.tags.map((tag: string) => tag.startsWith("json:") ? tag.replace('"selectionVersion":1', '"selectionVersion":0') : tag);
        f.memory.hmem.store.update(record.id, { tags });
      }
    }
    await new PriceSignalAgent(f.deps()).run("same as last time");
    assert.equal(f.state.selections, 1, invalidation);
    assert.equal(f.memory.findMapping("DE", "snacks")!.id, f.legacy);
  }
});

test("a stalled SKU selection is aborted at its single time budget and leaves marked fallbacks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let reached!: () => void;
  const selectionStarted = new Promise<void>(resolve => { reached = resolve; });
  f.state.reply = "pending";
  f.state.onSelection = reached;
  const running = new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
  await selectionStarted;
  t.mock.timers.tick(20_000);
  const brief = await running;
  assert.equal(f.state.selections, 1);
  assert.equal(f.state.selectionOptions[0].signal.aborted, true);
  assert.ok(brief.skus!.every(s => s.rateLabel === "Food" && s.coarser && s.selectionSource === "fallback"));
});

test("Food fallback requires both the official broad label and the agency's broad code", async () => {
  for (const variant of ["extra", "flagged", "wrongCode"]) {
    const f = fixture();
    f.state.reply = "error";
    f.state.falseBroad = variant;
    const brief = await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
    assert.equal(brief.skus, undefined, `${variant}: a narrow category cannot be relabeled as the Food fallback`);
    assert.ok(!brief.views.some(v => v.key.includes(":sku:")), variant);
  }
});

test("SKU memory rejects missing, malformed, stale and future periods before reuse", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const period of [null, "", "2026-13", "2026-00", "2026-Q5", "2000-01", "2027-01"]) {
    const f = fixture();
    await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
    f.state.selections = 0;
    f.state.probePeriod = period;
    await new PriceSignalAgent(f.deps()).run("same as last time");
    assert.equal(f.state.selections, 1, `unusable latest period ${String(period)} must trigger selection again`);
  }
});

test("newly selected SKU views must pass the same freshness gate as remembered views", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T00:00:00Z") });
  for (const period of [null, "", "2026-13", "2026-01", "2027-01"]) {
    const f = fixture();
    f.state.selectedPeriod = period;
    const brief = await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
    const de = brief.skus!.find(s => s.country === "DE")!;
    assert.equal(de.rateLabel, "Food", `onboarding's unusable latest period ${String(period)} must force the safe alternative`);
    assert.equal(de.selectionSource, "fallback");
    assert.ok(!f.memory.hmem.store.all().some((r: any) => r.tags.some((tag: string) => tag.startsWith("json:") && tag.includes('"scope":"sku:') && tag.includes('"country":"DE"'))));
  }
  const f = fixture();
  f.state.allOnboardPeriod = "2026-01";
  const brief = await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
  assert.equal(brief.skus, undefined, "an equally stale fallback is omitted too");
});

test("failed or empty SKU category discovery cannot authorize unmarked market-category pricing", async () => {
  for (const failure of ["throw", "empty"]) {
    const f = fixture();
    f.state.categoryFailure = failure;
    const brief = await new PriceSignalAgent(f.deps()).run("DE and AU food +3%, pass through 70%");
    assert.equal(brief.skus, undefined, failure);
    assert.match(brief.notes.join(" "), /SKU prices are omitted/i);
    assert.ok(!brief.trace.some(e => /pricing on the requested category instead/.test(e.title)));
    assert.equal(brief.facts.length, 2);
  }
});
