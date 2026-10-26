// Pure calculations over an existing result. No requests, storage or original-result edits.
(() => {
  "use strict";
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const text = value => typeof value === "string" ? value : "";
  const validRange = (low, high) => finite(low) && finite(high) && low <= high;
  const verdict = (proposed, low, high) => `${proposed > high ? "above" : proposed < low ? "below" : "within"} the market benchmark`;

  function validSeries(series) {
    if (!series || typeof series !== "object" || !finite(series.latestYoy) || !text(series.sourceId).trim()) return false;
    if (series.frequency === "M") return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(series.latestPeriod));
    if (series.frequency === "Q") return /^\d{4}-Q[1-4]$/.test(text(series.latestPeriod));
    return false;
  }

  function preview(result, proposedInput) {
    let proposed = proposedInput;
    if (typeof proposedInput === "string") {
      const input = proposedInput.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return { ok: false, error: "Enter a decimal percentage between -100 and 100." };
      proposed = Number(input);
    }
    if (!finite(proposed) || proposed < -100 || proposed > 100) return { ok: false, error: "Enter a decimal percentage between -100 and 100." };
    if (!result || typeof result !== "object" || Array.isArray(result) || !Array.isArray(result.facts) || (result.skus != null && !Array.isArray(result.skus))) return { ok: false, error: "A result with market facts is required for a local preview." };

    const markets = result.facts.map(fact => {
      const market = { country: text(fact?.country), available: false };
      if (finite(fact?.costNeed)) market.costNeed = fact.costNeed;
      const series = fact?.category ?? fact?.allItems;
      if (typeof result.concept === "string" && result.concept && series?.concept !== result.concept) return { ...market, reason: "The requested market category is unavailable; another category cannot supply its verdict." };
      if (!validSeries(series)) return { ...market, reason: "The market series or its source and period is unavailable." };
      if (!validRange(fact?.suggested?.low, fact?.suggested?.high)) return { ...market, reason: "A valid historical market benchmark is unavailable." };
      return {
        ...market,
        available: true,
        label: text(series.label),
        low: fact.suggested.low,
        high: fact.suggested.high,
        verdict: verdict(proposed, fact.suggested.low, fact.suggested.high),
        period: series.latestPeriod,
        sourceId: series.sourceId,
        cite: text(fact.cite),
      };
    });

    const skus = [];
    const omittedSkus = [];
    for (const original of result.skus ?? []) {
      const omitted = { sku: text(original?.sku), country: text(original?.country) };
      if (!finite(original?.currentPrice) || original.currentPrice < 0) {
        omittedSkus.push({ ...omitted, reason: "The current SKU price is missing or invalid." });
        continue;
      }
      if (!validRange(original.rangeLow, original.rangeHigh)) {
        omittedSkus.push({ ...omitted, reason: "A valid SKU-specific historical benchmark is unavailable." });
        continue;
      }
      // Keep the agent's existing two-decimal policy for all displayed currencies.
      const price = Math.round(original.currentPrice * (1 + proposed / 100) * 100) / 100;
      if (!finite(price)) {
        omittedSkus.push({ ...omitted, reason: "The scenario price exceeds the supported numeric range." });
        continue;
      }
      const line = {
        sku: text(original.sku), product: text(original.product), country: text(original.country), currency: text(original.currency),
        currentPrice: original.currentPrice, price, verdict: verdict(proposed, original.rangeLow, original.rangeHigh),
        period: text(original.period), sourceId: text(original.sourceId), cite: text(original.cite),
      };
      for (const key of ["rateLabel", "selectionSource", "selectionFit", "selectionReason"]) if (typeof original[key] === "string") line[key] = original[key];
      if (typeof original.coarser === "boolean") line.coarser = original.coarser;
      skus.push(line);
    }
    return { ok: true, proposed, originalProposed: finite(result.proposed) ? result.proposed : null, markets, skus, omittedSkus };
  }

  globalThis.PriceScenario = Object.freeze({ preview });
})();
