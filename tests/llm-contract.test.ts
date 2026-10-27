// The Meterless Runtime provider contract, checked against a fake Nightshift: Bearer token, `meterless-app` on
// every request, `meterless-scope: user` on chat only, /v1/models decides online / unauthorized / offline, and
// server errors are retried while client errors are not (independent sponsor review, 27 Oct 12:55: no such test).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chat, providerStatus } from "../src/llm.ts";

process.env.PSIG_VERBOSE = "0";

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
async function fakeNightshift(handler: (req: Seen, n: number) => { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const s = { method: req.method!, url: req.url!, headers: req.headers, body: raw };
      seen.push(s);
      const { status, body } = handler(s, seen.length);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const saved = { LLM_PROVIDER: process.env.LLM_PROVIDER, METERLESS_BASE_URL: process.env.METERLESS_BASE_URL, METERLESS_RUNTIME_TOKEN: process.env.METERLESS_RUNTIME_TOKEN };
  Object.assign(process.env, { LLM_PROVIDER: "meterless", METERLESS_BASE_URL: `http://127.0.0.1:${port}`, METERLESS_RUNTIME_TOKEN: "rt-contract-test" });
  return {
    seen,
    close: async () => {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
const models = { data: [{ id: "meterless/fast" }, { id: "meterless/deep" }] };
const completion = { model: "openrouter/nvidia/nemotron-3.5-lightning", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] };

test("/v1/models carries the token and app header (no user scope) and decides online, unauthorized or offline", async () => {
  for (const [status, body, state] of [[200, models, "online"], [401, {}, "unauthorized"], [403, {}, "unauthorized"], [200, { data: [{ id: "gpt-x" }] }, "offline"], [500, {}, "offline"]] as const) {
    const ns = await fakeNightshift(() => ({ status, body }));
    try {
      assert.equal((await providerStatus()).state, state, `${status} ${JSON.stringify(body)}`);
      const h = ns.seen[0].headers;
      assert.equal(ns.seen[0].url, "/v1/models");
      assert.equal(h.authorization, "Bearer rt-contract-test");
      assert.ok(h["meterless-app"], "meterless-app on /models");
      assert.equal(h["meterless-scope"], undefined, "no user scope on /models");
    } finally {
      await ns.close();
    }
  }
  // Nothing listening: offline, not an exception.
  const saved = { LLM_PROVIDER: process.env.LLM_PROVIDER, METERLESS_BASE_URL: process.env.METERLESS_BASE_URL, METERLESS_RUNTIME_TOKEN: process.env.METERLESS_RUNTIME_TOKEN };
  Object.assign(process.env, { LLM_PROVIDER: "meterless", METERLESS_BASE_URL: "http://127.0.0.1:9", METERLESS_RUNTIME_TOKEN: "rt-contract-test" });
  try {
    assert.equal((await providerStatus()).state, "offline");
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("chat carries the token, the app header and the user scope, and returns the model the runtime served", async () => {
  const ns = await fakeNightshift(() => ({ status: 200, body: completion }));
  try {
    const r = await chat([{ role: "user", content: "hi" }], { attempts: 1, timeoutMs: 5_000 });
    const h = ns.seen[0].headers;
    assert.equal(ns.seen[0].url, "/v1/chat/completions");
    assert.equal(h.authorization, "Bearer rt-contract-test");
    assert.ok(h["meterless-app"]);
    assert.equal(h["meterless-scope"], "user");
    assert.equal(r.model, "openrouter/nvidia/nemotron-3.5-lightning");
    assert.equal(r.provider, "meterless");
  } finally {
    await ns.close();
  }
});

test("chat asks Nemotron to skip its hidden reasoning pass (chat template switch), unless PSIG_NO_THINK=0", async () => {
  // Measured 27 Oct 18:20 through Nightshift: the same parse request took 4-7 s and 1.2-1.8k output tokens with
  // only /no_think and reasoning-effort hints, and 0.7-1.3 s and 49-60 tokens with enable_thinking=false.
  const ns = await fakeNightshift(() => ({ status: 200, body: completion }));
  try {
    await chat([{ role: "user", content: "hi" }], { attempts: 1, timeoutMs: 5_000 });
    assert.deepEqual(JSON.parse(ns.seen[0].body).chat_template_kwargs, { enable_thinking: false });
    process.env.PSIG_NO_THINK = "0";
    await chat([{ role: "user", content: "hi" }], { attempts: 1, timeoutMs: 5_000 });
    assert.equal(JSON.parse(ns.seen[1].body).chat_template_kwargs, undefined);
  } finally {
    delete process.env.PSIG_NO_THINK;
    await ns.close();
  }
});

test("with thinking off the token limit is the caller's own; with thinking on it keeps room for the reasoning", async () => {
  const ns = await fakeNightshift(() => ({ status: 200, body: completion }));
  try {
    await chat([{ role: "user", content: "hi" }], { attempts: 1, timeoutMs: 5_000, maxTokens: 1500 });
    assert.equal(JSON.parse(ns.seen[0].body).max_tokens, 1500);
    await chat([{ role: "user", content: "hi" }], { attempts: 1, timeoutMs: 5_000 });
    assert.equal(JSON.parse(ns.seen[1].body).max_tokens, 2048);
    process.env.PSIG_NO_THINK = "0";
    await chat([{ role: "user", content: "hi" }], { attempts: 1, timeoutMs: 5_000, maxTokens: 1500 });
    assert.equal(JSON.parse(ns.seen[2].body).max_tokens, 6000);
  } finally {
    delete process.env.PSIG_NO_THINK;
    await ns.close();
  }
});

test("a runtime that rejects the chat template switch gets the request again without it", async () => {
  const ns = await fakeNightshift((s) => (JSON.parse(s.body).chat_template_kwargs ? { status: 400, body: { error: "unrecognized field: chat_template_kwargs" } } : { status: 200, body: completion }));
  try {
    const r = await chat([{ role: "user", content: "hi" }], { attempts: 1, timeoutMs: 5_000 });
    assert.equal(r.text, '{"ok":true}');
    assert.equal(ns.seen.length, 2);
  } finally {
    await ns.close();
  }
});

test("a server error is retried; a client error is not", async () => {
  const flaky = await fakeNightshift((_s, n) => (n === 1 ? { status: 503, body: { error: "busy" } } : { status: 200, body: completion }));
  try {
    const r = await chat([{ role: "user", content: "hi" }], { attempts: 2, timeoutMs: 5_000 });
    assert.equal(r.text, '{"ok":true}');
    assert.equal(flaky.seen.length, 2);
  } finally {
    await flaky.close();
  }
  const bad = await fakeNightshift(() => ({ status: 400, body: { error: "bad request" } }));
  try {
    await assert.rejects(chat([{ role: "user", content: "hi" }], { attempts: 3, timeoutMs: 5_000 }), /LLM HTTP 400/);
    assert.equal(bad.seen.length, 1);
  } finally {
    await bad.close();
  }
});

test("the provider-layer header comment states the real time limits", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/llm.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src.split("\n").slice(0, 6).join("\n"), /180 s timeout/);
});
