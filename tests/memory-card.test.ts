// Scene 2 ("same as last time"): what H-MEM recalled and what changed since the last brief, near the top.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
function render(sample: any): string {
  class El { innerHTML = ""; textContent = ""; className = ""; value = ""; disabled = false; scrollTop = 0; scrollHeight = 0; clientHeight = 0; children: El[] = []; appendChild(c: El) { this.children.push(c); } scrollIntoView() {} setAttribute() {} }
  const nodes = new Map<string, El>();
  const node = (q: string) => { if (!nodes.has(q)) nodes.set(q, new El()); return nodes.get(q)!; };
  const context = vm.createContext({ document: { querySelector: node, createElement: () => new El() }, fetch: async () => ({ json: async () => ({}) }), EventSource: class { addEventListener() {} close() {} }, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  for (const file of ["scenario.js", "preview-panel.js"]) vm.runInContext(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"), context);
  vm.runInContext(script, context);
  (context as any).sample = sample;
  vm.runInContext('render(sample,"q")', context);
  return node("#out").innerHTML;
}
// Real scene 2 result, 27 Oct 09:53 KST.
const scene2 = JSON.parse(fs.readFileSync(new URL("./fixtures/scene2-memory-result.json", import.meta.url), "utf8"));

test("a memory run shows what H-MEM recalled and how the verdict changed since the last brief, above the market cards", () => {
  const out = render(scene2);
  const card = out.indexOf('id="memory-card"');
  assert.ok(card > 0 && card < out.indexOf('class="markets"'), "near the top");
  const text = out.slice(card, out.indexOf("</div>", out.indexOf("</table>", card)));
  assert.match(text, /Remembered with Meterless H-MEM/);
  assert.match(text, /4 official series and 4 product category choices reused from memory/);
  assert.match(text, /pass-through 70% \(mem-1\)/);
  assert.match(text, /2 planner calls · 4 discoveries/);
  assert.match(text, /<td>AU<\/td><td>no new official release \(still 2026-08, \+3\.0%\)<\/td><td>\+5% above<\/td><td class="changed">\+3% within<\/td>/);
  assert.match(text, /<td>DE<\/td><td>no new official release \(still 2026-09, \+0\.4%\)<\/td><td>\+5% above<\/td><td>\+3% above<\/td>/);
});

test("a cold run has no memory card", () => {
  const cold = { ...scene2, views: scene2.views.map((v: any) => ({ ...v, via: "onboarded" })), sinceLast: [], policySource: "stated in this request", metrics: { ...scene2.metrics, reusedViews: 0 } };
  assert.doesNotMatch(render(cold), /id="memory-card"/);
});

test("an unparsed since-last line is still shown as text", () => {
  const odd = { ...scene2, sinceLast: ["CA Food (last brief 2026-10-26, mem-3): methodology changed: earlier outcomes may use a policy-scaled range; current requested-category benchmarks are not directly comparable."] };
  assert.match(render(odd), /methodology changed: earlier outcomes may use a policy-scaled range/);
});
