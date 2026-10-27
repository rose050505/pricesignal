// With thinking off a parse reply is ~50-90 tokens in 1-3 s. Through Nightshift on 27 Oct, parse requests containing
// "go" ("can we go +3%", "what if we go -2%") ran to the token limit and failed with HTTP 502 (7 of 7, 25-29 s at
// 2,048 tokens), while the same with "raise" or "what about" passed in 1-3 s. A small limit and a short timeout make
// such a failure fall back to the rules parser in seconds, not after 60 s.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

process.env.PSIG_VERBOSE = "0";

test("the parse call asks for a small reply with a short timeout when thinking is off", async () => {
  const seen: any[] = [];
  const agent = new PriceSignalAgent({
    llm: (async (_m: any[], o: any) => { seen.push(o); throw new Error("HTTP 502: All candidate providers failed for this request."); }) as any,
    sql: { run: async () => ({ id: "Q", sql: "", columns: [], rows: [], ms: 0 }) } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-plim-"))), hedgeMs: Infinity,
  } as any);
  const r = await (agent as any).parse("canada food, can we go -2%?");
  assert.ok(seen[0].maxTokens <= 600, String(seen[0].maxTokens));
  assert.ok(seen[0].timeoutMs <= 15_000, String(seen[0].timeoutMs));
  assert.deepEqual(r.countries, ["CA"]);
  assert.equal(r.proposedChangePct, -2);
});

test("the UI example questions avoid the wording that failed through Nightshift", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const ex = html.match(/const EX=\[([\s\S]*?)\];/)![1];
  assert.doesNotMatch(ex, /\bgo\s+[+-]?\d/i);
  assert.match(ex, /same as last time, but what about \+3%\?/);
  assert.match(ex, /can we raise prices \+3%\?/);
});
