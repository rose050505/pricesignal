// Through Nightshift on 27 Oct, requests whose question said "go +3%" / "go -2%" came back as empty replies from both
// Nemotron lanes (16 of 16 failures 18:46-18:53 were empty_response; a "go" request that did succeed spent 1,906
// tokens and 21.6 s on planning). The same questions with "move" answered in 1.5-2.7 s. Only the text sent to the
// model is changed; the rules, the brief and the memory keep the question as written.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PriceSignalAgent, forModel } from "../src/agent.ts";
import { AgentMemory } from "../src/memory.ts";

process.env.PSIG_VERBOSE = "0";

test("'go' before a percentage is sent to the model as 'move'; other uses of 'go' are left alone", () => {
  assert.equal(forModel("canada food, can we go -2%?"), "canada food, can we move -2%?");
  assert.equal(forModel("same as last time, but what if we only go +3%?"), "same as last time, but what if we only move +3%?");
  assert.equal(forModel("Go +3%? or go up 2%, go to 4%, go by 1.5 %"), "Move +3%? or move up 2%, move to 4%, move by 1.5 %");
  assert.equal(forModel("let's go with Germany; go ahead if food CPI is under 3%"), "let's go with Germany; go ahead if food CPI is under 3%");
});

test("the parse prompt carries the model text while the request keeps the words as written", async () => {
  const prompts: string[] = [];
  const agent = new PriceSignalAgent({
    llm: (async (m: any[]) => { prompts.push(m.at(-1).content); return { text: '{"countries":["canada"],"concept":"food","proposed_change_pct":-2}', model: "f", provider: "f", ms: 1 }; }) as any,
    sql: { run: async () => ({ id: "Q", sql: "", columns: [], rows: [], ms: 0 }) } as any,
    memory: new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), "psig-mt-"))), hedgeMs: Infinity,
  } as any);
  const r = await (agent as any).parse("canada food, can we go -2%?");
  assert.match(prompts[0], /Request: """canada food, can we move -2%\?"""/);
  assert.equal(r.raw, "canada food, can we go -2%?");
  assert.equal(r.proposedChangePct, -2);
  const src = fs.readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  assert.match(src, /request: forModel\(raw\), needed: pairs/);
  assert.match(src, /const payload = \{ request: forModel\(req\.raw\)/);
});
