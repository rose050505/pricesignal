// npm run demo: the UI replays recorded runs (trace + the results the browser received) with no live calls.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildDemoSite } from "../src/demo.ts";

const Q = "canada food: can we raise prices +3%?";

function recordedExamples(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-demo-"));
  const run = path.join(dir, "05_within_range");
  fs.mkdirSync(run);
  const trace = { question: Q, trace: [
    { t: 1000, kind: "llm", title: "parsed request (nvidia/nemotron-3.5-lightning-30b-a3b, 900 ms via Meterless Nightshift)" },
    { t: 1100, kind: "compare", title: "federated query Q3" },
    { t: 1300, kind: "done", title: "brief ready in 1 s" },
  ], sql: [] };
  fs.writeFileSync(path.join(run, "trace.json"), JSON.stringify(trace));
  fs.writeFileSync(path.join(run, "result.json"), JSON.stringify({ partials: [{ t: 1150, result: { headline: "early", partial: true } }], final: { headline: "final", record: "out/2026-10-27T10-00-00-000Z", verification: { ok: true, checks: 7, path: "out/2026-10-27T10-00-00-000Z/evidence.json", errors: [] } } }));
  fs.writeFileSync(path.join(run, "recording.json"), JSON.stringify({ recordedAt: "2026-10-27T09:55:00.000Z", elapsedSeconds: 9 }));
  fs.writeFileSync(path.join(run, "brief.md"), "# brief\n");
  fs.mkdirSync(path.join(dir, "99_without_result"));
  return dir;
}

test("the demo site is the real UI page with the replay scripts loaded first, and the repository paths of each run", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "psig-site-")), "site");
  const { examples } = buildDemoSite(out, recordedExamples());
  assert.deepEqual(examples, ["05_within_range"], "folders without result.json are not offered");
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.ok(html.indexOf('src="replay/catalog.js"') < html.indexOf('src="replay.js"') && html.indexOf('src="replay.js"') < html.indexOf('src="scenario.js"'));
  assert.doesNotMatch(html, /src="\//, "relative paths, so the site works under a GitHub Pages sub-path");
  const catalog = fs.readFileSync(path.join(out, "replay", "catalog.js"), "utf8");
  assert.match(catalog, /"recordedAt":"27 Oct 2026, 18:55 KST"/);
  assert.match(catalog, /"model":"nvidia\/nemotron-3.5-lightning-30b-a3b"/);
  const result = JSON.parse(fs.readFileSync(path.join(out, "replay", "05_within_range", "result.json"), "utf8"));
  assert.equal(result.final.record, "examples/05_within_range");
  assert.equal(result.final.verification.path, "examples/05_within_range/evidence.json");
  assert.ok(fs.existsSync(path.join(out, "replay", "05_within_range", "brief.md")));
});

function replayPage(site: string) {
  const files = (p: string) => JSON.parse(fs.readFileSync(path.join(site, p), "utf8"));
  const inserted: any[] = [];
  const ctx: any = {
    document: { readyState: "complete", body: { insertBefore: (d: any) => inserted.push(d) }, querySelector: () => ({}), createElement: () => ({ setAttribute() {} }) },
    fetch: async (p: string) => ({ ok: true, status: 200, json: async () => files(p) }),
    setTimeout, clearTimeout,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["replay/catalog.js", "replay.js"]) vm.runInContext(fs.readFileSync(path.join(site, f), "utf8"), ctx);
  return { ctx, inserted };
}

test("asking a recorded question replays its trace, the early result and the final result in recorded order", async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "psig-site-")), "site");
  buildDemoSite(out, recordedExamples());
  const { ctx, inserted } = replayPage(out);
  assert.match(inserted[0].innerHTML, /Replay of recorded runs\.<\/b> 1 question recorded in one session starting 27 Oct 2026, 18:55 KST/);
  assert.match(inserted[0].innerHTML, /no live calls/);
  const status = await (await ctx.fetch("/api/status")).json();
  assert.equal(status.replay, true);
  const { id } = await (await ctx.fetch("/api/ask", { body: JSON.stringify({ question: `  ${Q.toUpperCase()} ` }) })).json();
  assert.equal(id, "05_within_range");
  const seen: string[] = [];
  await new Promise<void>((resolve) => {
    const es = new ctx.EventSource(`/api/stream/${id}`);
    es.onmessage = (m: any) => seen.push(JSON.parse(m.data).kind);
    es.addEventListener("partial", (m: any) => seen.push(`partial:${JSON.parse(m.data).headline}`));
    es.addEventListener("result", (m: any) => { seen.push(`result:${JSON.parse(m.data).headline}`); resolve(); });
  });
  assert.deepEqual(seen, ["llm", "compare", "partial:early", "done", "result:final"]);
});

test("a question that was not recorded is refused with a pointer to running it locally", async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "psig-site-")), "site");
  buildDemoSite(out, recordedExamples());
  const { ctx } = replayPage(out);
  const r = await (await ctx.fetch("/api/ask", { body: JSON.stringify({ question: "japan food +5%?" }) })).json();
  assert.equal(r.id, undefined);
  assert.match(r.error, /replays recorded runs only.*run PriceSignal locally/);
});

test("the live page offers the recorded questions only in replay mode", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /const REPLAY=typeof PSIG_REPLAY==="object"\?PSIG_REPLAY:null;\nconst EX=REPLAY\?REPLAY\.examples\.map\(e=>e\.question\):\[/);
  assert.match(html, /if\(s\.replay\)\{/);
});

test("the CLI saves the UI result payloads (partials and final) that the replay needs", () => {
  const cli = fs.readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  assert.match(cli, /agent\.on\("partial"/);
  assert.match(cli, /result\.json"\), JSON\.stringify\(\{ partials, final \}\)/);
  const script = fs.readFileSync(new URL("../scripts/15_examples.sh", import.meta.url), "utf8");
  assert.match(script, /\[ ! -s "\$OUT\/result\.json" \]/);
});

test("the site builder never replaces a folder that is not an earlier demo site (review, 28 Oct 00:00)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psig-keep-"));
  fs.writeFileSync(path.join(dir, "important.txt"), "keep");
  assert.throws(() => buildDemoSite(dir, recordedExamples()), /not empty and is not an earlier demo site/);
  assert.equal(fs.readFileSync(path.join(dir, "important.txt"), "utf8"), "keep");
  const examples = recordedExamples();
  assert.throws(() => buildDemoSite(path.dirname(examples), examples), /contains the repository or the examples|not empty/);
  assert.ok(fs.existsSync(examples));
  const site = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "psig-site-")), "site");
  buildDemoSite(site, recordedExamples());
  assert.doesNotThrow(() => buildDemoSite(site, recordedExamples()), "an earlier demo site is rebuilt");
});
