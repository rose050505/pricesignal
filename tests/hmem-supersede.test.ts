// When the agent replaces a memory (a new pricing policy, a re-onboarded series), the old H-MEM record is marked
// `supersededBy`, so the engine's own retrieval ranks it down too, not only the agent's tag lookups
// (independent sponsor review, 27 Oct 12:55: supersedes was set on the new record only).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentMemory } from "../src/memory.ts";

test("a replaced pricing policy is superseded in H-MEM itself, and the engine ranks the current one first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-supersede-"));
  const m = new AgentMemory(dir);
  const old = m.rememberPolicy(0.7, "we pass on ~70% of cost increases");
  const now = m.rememberPolicy(0.6, "we pass thru like 60pct of costs");
  assert.equal(m.hmem.store.get(old).supersededBy, now);
  assert.equal(m.latestPolicy()?.id, now);
  // Even after the old record collected helpful feedback, the engine does not rank it above the current one.
  m.feedback(old, "helpful");
  m.feedback(old, "helpful");
  const ranked = m.hmem.query("pricing policy pass through cost increase", { topN: 5, threshold: 0 }).memories.map((x: any) => x.memory.id);
  assert.ok(ranked.indexOf(now) >= 0 && ranked.indexOf(now) < ranked.indexOf(old), ranked.join(","));
  // The mark persists on disk.
  assert.equal(new AgentMemory(dir).hmem.store.get(old).supersededBy, now);
});

test("a re-onboarded series and a repeated request supersede their predecessors the same way", () => {
  const m = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-supersede-map-")));
  const base = { country: "DE", concept: "food", agency: "eurostat", dataset: "prc_hicp_manr", code: "CP01", label: "Food", view: "v_de_food_old", frequency: "M" };
  const a = m.rememberMapping(base as any);
  const b = m.rememberMapping({ ...base, dataset: "prc_hicp_minr", view: "v_de_food_new" } as any);
  assert.equal(m.hmem.store.get(a).supersededBy, b);
  assert.equal(m.findMapping("DE", "food")?.id, b);
  const r1 = m.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, raw: "DE food +5%" });
  const r2 = m.rememberRequest({ countries: ["DE"], concept: "food", conceptWords: ["food"], proposedChangePct: 3, raw: "same, +3%" });
  assert.equal(m.hmem.store.get(r1).supersededBy, r2);
  assert.equal(m.lastRequest()?.id, r2);
});
