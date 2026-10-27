// npm run demo  -> http://localhost:5179: the UI replaying the runs recorded in examples/ (no keys, Docker or network).
// npm run demo -- --build <dir>: write the same static site to <dir> (the GitHub Pages workflow publishes it).
// Each example folder needs result.json, which the CLI saves next to brief.md, trace.json and evidence.json.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/rose050505/pricesignal";
const MODEL_REPLY = /^(?:parsed request|SKU category selection|narrative) \(([\w./:-]+), \d+ ms via /;

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf-8"));

export function buildDemoSite(outDir: string, examplesDir = path.join(ROOT, "examples")): { examples: string[] } {
  const names = fs.readdirSync(examplesDir).filter((n) => fs.existsSync(path.join(examplesDir, n, "result.json"))).sort();
  if (!names.length) throw new Error(`no recorded run with result.json in ${examplesDir} (record them with bash scripts/15_examples.sh)`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "replay"), { recursive: true });
  const examples: { name: string; question: string; elapsedSeconds: number | null }[] = [];
  const models = new Set<string>();
  const recorded: string[] = [];
  for (const name of names) {
    const src = path.join(examplesDir, name);
    const dst = path.join(outDir, "replay", name);
    fs.mkdirSync(dst);
    const trace = readJson(path.join(src, "trace.json"));
    const result = readJson(path.join(src, "result.json"));
    const recording = fs.existsSync(path.join(src, "recording.json")) ? readJson(path.join(src, "recording.json")) : {};
    // The CLI wrote paths under out/; in the repository the run lives in examples/<name>.
    result.final.record = `examples/${name}`;
    if (result.final.verification) result.final.verification.path = `examples/${name}/evidence.json`;
    fs.writeFileSync(path.join(dst, "trace.json"), JSON.stringify(trace));
    fs.writeFileSync(path.join(dst, "result.json"), JSON.stringify(result));
    for (const f of ["brief.md", "evidence.json"]) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    examples.push({ name, question: trace.question, elapsedSeconds: recording.elapsedSeconds ?? null });
    for (const e of trace.trace ?? []) {
      const m = String(e.title).match(MODEL_REPLY);
      if (m) models.add(m[1]);
    }
    if (recording.recordedAt) recorded.push(recording.recordedAt);
  }
  const first = recorded.sort()[0];
  const recordedAt = first
    ? `${new Date(first).toLocaleString("en-GB", { timeZone: "Asia/Seoul", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} KST`
    : "an earlier date";
  const catalog = { recordedAt, model: [...models].join(", ") || "the recorded model", repo: REPO, examples };
  fs.writeFileSync(path.join(outDir, "replay", "catalog.js"), `window.PSIG_REPLAY=${JSON.stringify(catalog)};\n`);

  let html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf-8");
  const scripts = ['<script src="/scenario.js"></script>', '<script src="/preview-panel.js"></script>'];
  if (!scripts.every((s) => html.includes(s))) throw new Error("public/index.html no longer loads /scenario.js and /preview-panel.js; update src/demo.ts");
  html = html
    .replace(scripts[0], '<script src="replay/catalog.js"></script>\n<script src="replay.js"></script>\n<script src="scenario.js"></script>')
    .replace(scripts[1], '<script src="preview-panel.js"></script>')
    .replace("<title>PriceSignal</title>", "<title>PriceSignal · recorded runs</title>");
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  for (const f of ["scenario.js", "preview-panel.js", "replay.js"]) fs.copyFileSync(path.join(ROOT, "public", f), path.join(outDir, f));
  return { examples: names };
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json", ".md": "text/markdown; charset=utf-8" };

function serve(dir: string, port: number): void {
  http
    .createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "") || "index.html";
      const file = path.resolve(dir, rel);
      if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, "127.0.0.1", () => console.log(`[pricesignal] replay of the recorded runs on http://localhost:${port} (no live calls)`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bi = args.indexOf("--build");
  const out = path.resolve(bi >= 0 && args[bi + 1] ? args[bi + 1] : path.join(ROOT, "out", "demo-site"));
  const { examples } = buildDemoSite(out);
  console.log(`[pricesignal] demo site with ${examples.length} recorded runs: ${path.relative(ROOT, out) || out}`);
  if (bi < 0) serve(out, Number(process.env.PSIG_DEMO_PORT || 5179));
}
