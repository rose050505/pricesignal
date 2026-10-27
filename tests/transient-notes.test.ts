// An agency outage during discovery is true for that run only. It must not be stored with the H-MEM mapping
// and replayed later as "(remembered from an earlier run)" (independent review, 27 Oct 11:30).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";
import { resetCacheRegistry } from "../src/sources/index.ts";

process.env.PSIG_VERBOSE = "0";
process.env.PSIG_ONBOARD_RETRY_MS = "0";

function rows(): unknown[][] {
  const r: unknown[][] = [];
  for (const [k, l, base] of [["food", "Food", 2.0], ["all_items", "All-items", 2.4]] as const)
    for (let m = 1; m <= 9; m++) r.push(["CA", k, l, "M", `2026-0${m}`, base + m * 0.05, `statcan:${k}`]);
  return r;
}
const z = {
  async run(sql: string) {
    if (/^SELECT COUNT/.test(sql)) return { id: "x", sql, columns: ["n", "latest"], rows: [[9, "2026-09"]], ms: 1 };
    if (/^SELECT country/.test(sql)) return { id: "x", sql, columns: ["country", "concept", "category_label", "frequency", "period", "yoy_pct", "source_id"], rows: rows(), ms: 1 };
    if (/^SELECT/.test(sql)) throw new Error("no price list here");
    return { id: "x", sql, columns: [], rows: [], ms: 1 };
  },
};
const ok = (text: string) => ({ text, model: "f", provider: "f", ms: 1 });
const llm = (async (m: any[]) => {
  const last = m.at(-1).content as string;
  if (last.startsWith("Extract")) return ok('{"countries":["CA"],"concept":"food","concept_words":["food"],"proposed_change_pct":3}');
  if (m[0].content.startsWith("You write short")) return ok('{"headline":"x","markets":{},"watch":"Re-check next month."}');
  return ok('{"actions":[{"action":"discover_and_onboard","args":{"country":"CA","concept":"food"}},{"action":"discover_and_onboard","args":{"country":"CA","concept":"all_items"}},{"action":"compare","args":{}}]}');
}) as any;

test("a StatCan outage note is shown in the run it happened in, but not remembered", async () => {
  resetCacheRegistry();
  const real = globalThis.fetch;
  let down = true;
  globalThis.fetch = (async () => {
    if (down) return new Response("<!DOCTYPE html><html><head><title>Statistics Canada - We're sorry!</title></head></html>", { status: 200 });
    throw new Error("network disabled in this test");
  }) as any;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-transient-"));
    const agent = () => new PriceSignalAgent({ llm, sql: z as any, memory: new AgentMemory(dir), hedgeMs: Infinity, compareRetryMs: 0 } as any);
    const first = await agent().run("canada food +3%");
    assert.ok(first.notes.some((n) => /did not answer during discovery/.test(n)), first.notes.join(" | "));
    down = false;
    const second = await agent().run("canada food +3%");
    assert.deepEqual(second.views.map((v: any) => v.via), ["memory", "memory"]);
    assert.deepEqual(second.notes.filter((n) => /did not answer/.test(n)), []);
    const stored = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    assert.doesNotMatch(stored, /did not answer during discovery/);
  } finally {
    globalThis.fetch = real;
  }
});

test("an outage note already in an older memory is not replayed", async () => {
  resetCacheRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-transient-old-"));
  const memory = new AgentMemory(dir);
  for (const k of ["food", "all_items"])
    memory.rememberMapping({ country: "CA", concept: k, agency: "statcan", dataset: "18100004", code: k === "food" ? "v41690974" : "v41690973", label: k, view: `v_ca_${k}`, frequency: "M", decoderVersion: 2,
      note: `StatCan's API did not answer during discovery (statcan.gc.ca returned a web page instead of data); the catalogued ${k} vector is checked against its registered Zetaris copy instead.` } as any);
  const b = await new PriceSignalAgent({ llm, sql: z as any, memory, hedgeMs: Infinity, compareRetryMs: 0 } as any).run("canada food +3%");
  assert.deepEqual(b.views.map((v: any) => v.via), ["memory", "memory"]);
  assert.deepEqual(b.notes.filter((n) => /did not answer/.test(n)), []);
});
