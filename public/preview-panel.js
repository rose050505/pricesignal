// A separate local comparison panel: the original brief is never re-rendered on input.
(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const signed = value => `${value > 0 ? "+" : ""}${value}%`;
  const money = value => value.toFixed(2);
  const eligible = result => result && !result.partial && ((result.facts?.length ?? 0) > 0 || (result.skus?.length ?? 0) > 0);
  const seed = result => typeof result.proposed === "number" && Number.isFinite(result.proposed) && result.proposed >= -100 && result.proposed <= 100 ? result.proposed : 0;

  function contents(preview) {
    if (!preview.ok) return `<p class="preview-error" role="alert">${esc(preview.error)}</p>`;
    // Without a cost-recovery scenario the column would only repeat "Not available".
    const cost = preview.markets.some(m => m.costNeed != null);
    return `<p class="preview-title"><b>Preview at ${esc(signed(preview.proposed))}</b> · the original brief below is unchanged.</p>
      <div class="preview-scroll" tabindex="0" role="region" aria-label="Preview market comparisons"><table class="preview-table"><thead><tr><th>Market / observation</th><th>Historical benchmark</th><th>Preview comparison</th>${cost ? "<th>Cost target (unchanged)</th>" : ""}</tr></thead><tbody>${preview.markets.map(m => `<tr><th scope="row">${esc(m.country)}${m.available ? `<div class="sub">${esc(m.label)} · ${esc(m.period)}</div><div class="src">${esc(m.sourceId)} · ${esc(m.cite)}</div>` : ""}</th><td>${m.available ? `${esc(m.low)}–${esc(m.high)}%` : "—"}</td><td>${m.available ? esc(m.verdict) : `Unavailable: ${esc(m.reason)}`}</td>${cost ? `<td>${m.costNeed != null ? esc(signed(m.costNeed)) : "Not available"}</td>` : ""}</tr>`).join("")}</tbody></table></div>
      ${preview.skus.length ? `<details class="preview-skus"><summary>Preview prices for ${preview.skus.length} available SKUs</summary><div class="preview-scroll" tabindex="0" role="region" aria-label="Preview SKU prices"><table class="preview-table"><thead><tr><th>SKU / market</th><th>Current</th><th>Preview price</th><th>Comparison with its own benchmark</th><th>Observation / source</th></tr></thead><tbody>${preview.skus.map(s => `<tr><th scope="row">${esc(s.sku)} · ${esc(s.country)}<div class="sub">${esc(s.product)}</div></th><td>${money(s.currentPrice)} ${esc(s.currency)}</td><td><b>${money(s.price)} ${esc(s.currency)}</b></td><td>${esc(s.verdict)}</td><td>${esc(s.period)}<div class="sub">${esc(s.rateLabel)}${s.selectionFit === "broader" || s.coarser ? " · broader proxy" : ""}${s.selectionSource === "fallback" ? " · unconfirmed match" : ""}</div><div class="src">${esc(s.sourceId)} · ${esc(s.cite)}</div></td></tr>`).join("")}</tbody></table></div></details>` : "<p class=\"sub\">No SKU prices are available for this preview.</p>"}
      ${preview.omittedSkus.length ? `<ul class="notes sub">${preview.omittedSkus.map(s => `<li>${esc(s.country)} ${esc(s.sku)} omitted: ${esc(s.reason)}</li>`).join("")}</ul>` : ""}`;
  }

  function render(result) {
    if (!eligible(result)) return "";
    const original = typeof result.proposed === "number" && Number.isFinite(result.proposed) ? signed(result.proposed) : "not supplied";
    const time = typeof result.startedAt === "string" && Number.isFinite(Date.parse(result.startedAt))
      ? `Run started: ${new Date(result.startedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}`
      : "Recorded run time unavailable";
    return `<details class="card preview" id="scenario-panel"><summary><b>Try another price change</b> · instant what-if on this brief's evidence; nothing is queried again</summary>
      <p class="sub">Original proposal: ${esc(original)} · ${esc(time)}. Observation periods are listed below.</p>
      <div class="preview-controls"><label for="scenario-proposal">Preview change (%)</label><input id="scenario-proposal" type="number" min="-100" max="100" step="any" value="${seed(result)}" aria-describedby="scenario-help"><button type="button" id="scenario-reset">Reset preview</button></div>
      <p class="sub" id="scenario-help">From −100% to +100%. Uses this brief's existing evidence; no data refresh. This preview is not saved and does not change the original analysis or your remembered request. It does not predict customer acceptance.</p>
      <div id="scenario-results" aria-live="polite">${contents(globalThis.PriceScenario.preview(result, seed(result)))}</div></details>`;
  }

  function bind(result) {
    if (!eligible(result)) return;
    const input = document.querySelector("#scenario-proposal");
    const output = document.querySelector("#scenario-results");
    const reset = document.querySelector("#scenario-reset");
    if (!input || !output || !reset) return;
    const update = () => { output.innerHTML = contents(globalThis.PriceScenario.preview(result, input.value)); };
    input.value = String(seed(result));
    input.oninput = update;
    reset.onclick = () => { input.value = String(seed(result)); update(); };
    update();
  }

  globalThis.PricePreviewPanel = Object.freeze({ render, bind });
})();
