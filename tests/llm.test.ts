// Offline test of the Meterless provider client against a local fake runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chat } from "../src/llm.ts";

test("chat() keeps its time limit while the body streams, and an outside abort cancels the request", async () => {
  // A runtime that sends headers at once and the body 1.5 s later (a proxy can do this).
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"choices":[{"message":{"content":');
    setTimeout(() => res.end('"{}"}}],"model":"m"}'), 1500);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const keys = ["LLM_PROVIDER", "METERLESS_BASE_URL", "METERLESS_RUNTIME_TOKEN", "PSIG_VERBOSE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { LLM_PROVIDER: "meterless", METERLESS_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}`, METERLESS_RUNTIME_TOKEN: "test-token", PSIG_VERBOSE: "0" });
  try {
    const t0 = Date.now();
    await assert.rejects(chat([{ role: "user", content: "x" }], { attempts: 1, timeoutMs: 300 }));
    assert.ok(Date.now() - t0 < 1000, `timed out after ${Date.now() - t0} ms, not 300`);
    const ctl = new AbortController();
    const t1 = Date.now();
    const p = chat([{ role: "user", content: "x" }], { attempts: 2, timeoutMs: 10_000, signal: ctl.signal });
    setTimeout(() => ctl.abort(new Error("cancelled: the other request answered first")), 100);
    await assert.rejects(p, /cancelled/);
    assert.ok(Date.now() - t1 < 1000, "an aborted request is not retried");
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    server.closeAllConnections();
    server.close();
  }
});
