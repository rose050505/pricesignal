import { test } from "node:test";
import assert from "node:assert/strict";
import { publishRun, subscribeRun, type Run, type StreamListener } from "../src/run-stream.ts";

function run(): Run {
  return { events: [], listeners: new Set(), done: false };
}

function receiver(): StreamListener & { events: { event: string; data: unknown }[] } {
  const events: { event: string; data: unknown }[] = [];
  return {
    events,
    write(chunk) {
      const lines = chunk.trim().split("\n");
      events.push({ event: lines[0].slice("event: ".length), data: JSON.parse(lines[1].slice("data: ".length)) });
    },
  };
}

test("a reconnect replays trace and the latest numeric partial while prose is pending", () => {
  const state = run();
  const first = receiver();
  const disconnect = subscribeRun(state, first);
  const trace = { t: 10, kind: "sql", title: "Compared markets" };
  state.events.push(trace);
  publishRun(state, trace);
  publishRun(state, { partial: true, partialStage: "markets", facts: [{ country: "CA", latestYoy: 3.4 }] }, "partial");
  const priced = { partial: true, partialStage: "pricing", facts: [{ country: "CA", latestYoy: 3.4 }], skus: [{ sku: "GCJ-500", low: 7.6 }] };
  publishRun(state, priced, "partial");
  disconnect();
  const reconnected = receiver();
  const unsubscribe = subscribeRun(state, reconnected);
  assert.deepEqual(reconnected.events, [{ event: "message", data: trace }, { event: "partial", data: priced }]);
  assert.equal(state.listeners.size, 1);
  unsubscribe();
  assert.equal(state.listeners.size, 0);
});

test("a late first subscription gets numbers emitted before the SSE connection opened", () => {
  const state = run();
  const partial = { partial: true, partialStage: "markets", facts: [{ country: "AU", latestYoy: 3 }] };
  publishRun(state, partial, "partial");
  const client = receiver();
  const unsubscribe = subscribeRun(state, client);
  assert.deepEqual(client.events, [{ event: "partial", data: partial }]);
  unsubscribe();
});

test("disconnect cleanup prevents future writes to the old connection", () => {
  const state = run();
  const first = receiver();
  const disconnect = subscribeRun(state, first);
  disconnect();
  disconnect();
  const second = receiver();
  const unsubscribe = subscribeRun(state, second);
  publishRun(state, { partial: true, facts: [] }, "partial");
  assert.equal(first.events.length, 0);
  assert.equal(second.events.length, 1);
  assert.equal(state.listeners.size, 1);
  unsubscribe();
  assert.equal(state.listeners.size, 0);
});

test("a completed run replays the final result and keeps no live listener", () => {
  const state = run();
  publishRun(state, { partial: true, facts: [] }, "partial");
  state.result = { facts: [], narrative: { headline: "Complete" } };
  state.done = true;
  const client = receiver();
  const unsubscribe = subscribeRun(state, client);
  assert.deepEqual(client.events, [{ event: "result", data: state.result }]);
  assert.equal(state.listeners.size, 0);
  unsubscribe();
});

test("a failed run replays its failure and keeps no live listener", () => {
  const state = run();
  state.error = "Query unavailable";
  state.done = true;
  const client = receiver();
  const unsubscribe = subscribeRun(state, client);
  assert.deepEqual(client.events, [{ event: "failure", data: { error: "Query unavailable" } }]);
  assert.equal(state.listeners.size, 0);
  unsubscribe();
});

test("live result and failure each release listeners after the terminal event", () => {
  for (const event of ["result", "failure"] as const) {
    const state = run();
    const client = receiver();
    const unsubscribe = subscribeRun(state, client);
    state.done = true;
    const terminal = event === "result" ? { facts: [] } : { error: "Query unavailable" };
    publishRun(state, terminal, event);
    assert.deepEqual(client.events, [{ event, data: terminal }]);
    assert.equal(state.listeners.size, 0);
    unsubscribe();
  }
});
