// Reading the messy request with rules: markets, category intent, every percentage and its meaning. Nemotron's
// reading (src/prompts.ts) is a second opinion; these rules decide what is used.

import { COUNTRY_ALIASES, normalizeCountry, type Country } from "./sources/index.ts";
import type { Request } from "./agent.ts";

/** A concept name from the model ends up in view names and SQL string literals: keep it to plain words. */
export function cleanConcept(v: unknown): string {
  return typeof v !== "string" ? "" : v.toLowerCase().replace(/['"`\\;]/g, "").trim();
}

/**
 * The request as sent to the model. Through Nightshift on 27 Oct, questions with "go +3%" / "go -2%" came back as
 * empty replies from both Nemotron lanes, while "move +3%" answered in 1-3 s. The rules, the brief and the memory
 * keep the words as written.
 */
export function forModel(raw: string): string {
  return raw.replace(/\bgo(?=\s+(?:(?:up|down|to|by)\s+)?[+\-−]?\s?\d)/gi, (m) => (m[0] === "G" ? "Move" : "move"));
}

export function sameAsLastRequest(raw: string): boolean {
  return /\b(same as (last|before|previous)|like last time|as last time|as usual|same again)\b|지난번|저번|지난 분기|같은 조건/i.test(raw);
}

/** Literal aliases outrank model country guesses. Models may resolve a named typo, not invent a market. */
export function requestMarkets(raw: string, modelNames: string[]): { countries: Country[]; unknown: string[] } {
  const hits: { country: Country; at: number }[] = [];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [alias, country] of Object.entries(COUNTRY_ALIASES)) {
    const suffix = /[가-힣]/.test(alias) ? "(?=$|[^\\p{L}]|(?:에서|에서는|에서의|에는|으로|와|과|은|는|이|가|을|를|에|의|만|이랑|랑|하고|이나|나|및|도|까지|시장)(?=$|[^\\p{L}]))" : "(?![\\p{L}])";
    for (const match of raw.matchAll(new RegExp(`(?<![\\p{L}])${escape(alias)}${suffix}`, "giu"))) {
      // "a Germany-based exporter" describes the company, not a market.
      if (/^-?\s?(?:based|made)\b/i.test(raw.slice(match.index! + match[0].length))) continue;
      hits.push({ country, at: match.index! });
    }
  }
  for (const match of raw.matchAll(/\b[A-Z]{2}\b/g)) {
    // "US$12.50", "a US-based exporter": a currency or the company, not a market.
    if (/^(?:\$|-?\s?(?:based|made)\b|\s+dollars?\b)/i.test(raw.slice(match.index! + 2))) continue;
    const country = normalizeCountry(match[0], false);
    if (country) hits.push({ country, at: match.index! });
  }
  const countries = [...new Set(hits.sort((a, b) => a.at - b.at).map(h => h.country))];
  const unknown: string[] = [];
  const phrase = (value: string) => value.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).join(" ");
  const rawPhrase = ` ${phrase(raw)} `;
  // Ground a canonical model name in a nearby one-edit spelling only in a market position.
  // Ordinary freight prose ("inland", "pain") must not become Finland or Spain.
  for (const name of modelNames) {
    const country = normalizeCountry(name);
    if (!country || countries.includes(country)) continue;
    for (const match of raw.matchAll(/[\p{L}]{4,}/gu)) {
      if (/^(?:inland|pain)$/i.test(match[0]) || normalizeCountry(match[0], true) !== country) continue;
      const before = raw.slice(Math.max(0, match.index! - 24), match.index!);
      const after = raw.slice(match.index! + match[0].length);
      if (/^\s*(?:food|snacks?|condiments?|prices?|inflation|CPI|HICP|markets?)\b|^\s*(?:식품|간식|물가|가격)/i.test(after)
        || /\b(?:in|for|and|market)\s*$/i.test(before) || /[,&/]\s*$/.test(before)
        // A list that opens the request: "germny and austrlia food".
        || /^\s*(?:and|or|&|,|\/)/i.test(after)) { countries.push(country); break; }
    }
  }
  for (const name of modelNames) {
    if (!phrase(name) || !rawPhrase.includes(` ${phrase(name)} `)) continue;
    if (/^[A-Z]{2}$/.test(name) && !normalizeCountry(name.toLowerCase(), false) && !raw.split(/[^\p{L}]+/u).includes(name)) continue;
    const country = normalizeCountry(name);
    if (country) { if (!countries.includes(country)) countries.push(country); }
    else if (!unknown.some(value => phrase(value) === phrase(name))) unknown.push(name);
  }
  // These names only preserve explicit unsupported requests; they add no data-source coverage.
  const unsupported = [
    ["Japan", "japan", "일본"],
    ["United Kingdom", "united kingdom", "UK", "britain", "영국"], ["China", "china", "중국"],
    ["South Korea", "south korea", "korea", "한국", "대한민국"], ["Brazil", "brazil", "브라질"],
  ];
  for (const names of unsupported) {
    const mentioned = names.slice(1).find(name => {
      const flags = /^[A-Z]{2,3}$/.test(name) ? "u" : "iu";
      const suffix = /[가-힣]/.test(name) ? "(?=$|[^\\p{L}]|(?:에서|와|과|은|는|을|를|에|의|만)(?=$|[^\\p{L}]))" : "(?![\\p{L}])";
      return new RegExp(`(?<![\\p{L}])${escape(name)}${suffix}`, flags).test(raw);
    });
    if (!mentioned || unknown.some(value => names.some(name => phrase(name) === phrase(value)))) continue;
    const modelName = modelNames.find(value => names.some(name => phrase(name) === phrase(value)));
    const literal = raw.match(new RegExp(escape(mentioned), /^[A-Z]{2,3}$/.test(mentioned) ? "u" : "iu"))?.[0];
    unknown.push(modelName ?? literal ?? names[0]);
  }
  return { countries, unknown };
}

export function requestCostShareBasis(raw: string, share: number | undefined, newShare: boolean, costContext: string | undefined, remembered?: Request["costShareBasis"]): { value?: Request["costShareBasis"]; issues: string[] } {
  if (share === undefined) return { issues: [] };
  const before = /\b(?:before|prior to)\s*(?:(?:the|this|cost)\s+)*(?:change|increase|rise|decrease|reduction)\b|\bpre[- ]change\b|(?:변동|변화|상승|인상|인하|증가|감소)\s*전/i.test(raw);
  const after = /\b(?:after|following)\s*(?:(?:the|this|cost)\s+)*(?:change|increase|rise|decrease|reduction)\b|\bpost[- ]change\b|(?:변동|변화|상승|인상|인하|증가|감소)\s*후/i.test(raw);
  if (before !== after) return { value: before ? "before_change" : "after_change", issues: [] };
  const futureCost = /\b(?:will|expected|forecast|next|going to)\b|예정|전망|오를|내릴/i.test(costContext ?? "");
  const pastCost = /\b(?:rose|risen|increased|fell|fallen|decreased|grew|have|has)\b|올랐|상승했|증가했|내렸|감소했/i.test(costContext ?? "");
  const currentShare = /\b(?:current|now|today)\b[^%.!?;\n]{0,35}\b(?:unit\s+)?costs?\b|\bunit costs?\s+(?:are|is)\b|현재[^%.!?;\n]{0,25}(?:원가|비용)/i.test(raw);
  if (!before && !after && futureCost && (currentShare || !newShare)) return { value: "before_change", issues: !newShare ? ["The new future cost change uses the remembered cost share before that new change; the previous change's timing is not reused."] : [] };
  if (!before && !after && currentShare && pastCost) return { value: "after_change", issues: [] };
  if (!newShare && !before && !after && remembered) return { value: remembered, issues: [] };
  return { issues: [before && after ? "Conflicting cost-share timing was supplied; assuming the share is before the cost change until clarified." : "Cost-share timing is not specified; assuming the share is before the cost change. State before or after the change to make the basis explicit."] };
}

/** A direct inflation/price subject outranks a product introduction; memory fills only absent categories. */
export function explicitMarketConcept(raw: string): { concept?: string; issues: string[] } {
  const aliases: [string, RegExp][] = [
    ["all_items", /\b(?:all[-_ ]items|all groups|overall|headline)\b|전체|총지수/gi],
    ["food", /\b(?:food|grocer(?:y|ies))\b|식품|식료품/gi],
    ["snacks", /\bsnacks?\b|간식|과자/gi],
    ["condiments", /\b(?:condiments?|sauces?)\b|조미료|양념|소스/gi],
  ];
  const hits: { concept: string; index: number; direct: boolean }[] = [];
  for (const [concept, pattern] of aliases) for (const match of raw.matchAll(pattern)) {
    const before = raw.slice(Math.max(0, match.index! - 24), match.index);
    const after = raw.slice(match.index! + match[0].length);
    // An explicit exclusion is not a second requested category.
    if (/\b(?:not|except|excluding)\s*$/i.test(before) || /^\s*(?:말고|아닌|제외)/.test(after)) continue;
    const direct = /^\s*(?:consumer\s+)?(?:price(?:s| inflation)?|inflation|CPI|HICP)\b/i.test(after)
      || /^\s*(?:의\s*)?(?:물가|인플레이션|가격)/.test(after)
      || /\b(?:compare|benchmark)\s+(?:the\s+)?$/i.test(before)
      || /\b(?:inflation|prices?|CPI|HICP)\s+(?:for|of|in)\s+(?:the\s+)?$/i.test(before);
    if (!direct) {
      // A category word in the business introduction or ordinary prose is not a changed request.
      // Keep concise market/category inputs and explicit category changes without needing "inflation".
      if (/^\s*(?:business|company|exporter|products?)\b/i.test(after) || /^\s*(?:수출업체|업체|제품)/.test(after) || /^(?:overall|headline)$/i.test(match[0])) continue;
      if (/^[가-힣]/.test(match[0]) && !/^(?:(?:으로|은|는|을|를|의|이|가|로))?(?=\s|[,.:;!?+−\-\d]|$)/.test(after)) continue;
      const preceding = before.trim().split(/[^\p{L}]+/u).filter(Boolean).at(-1);
      const following = after.replace(/^\s*(?:in|for|of|from)\s+/i, "").trim().split(/[^\p{L}]+/u).filter(Boolean)[0];
      const marketShorthand = !!(preceding && normalizeCountry(preceding, false) || following && normalizeCountry(following, false));
      const changed = /\b(?:switch\s+to|change\s+(?:the\s+)?category\s+to|category\s*[:=])\s*$/i.test(before)
        || /(?:이번에는|대신|범주[는를가]?|카테고리[는를가]?)\s*$/.test(before)
        || sameAsLastRequest(raw) && /\bbut\s*$/i.test(before) && /^[\s.!?]*$/.test(after);
      if (!marketShorthand && !changed) continue;
    }
    hits.push({ concept, index: match.index!, direct });
  }
  const direct = hits.filter(h => h.direct).sort((a, b) => a.index - b.index);
  const choices = [...new Set((direct.length ? direct : hits.sort((a, b) => a.index - b.index)).map(h => h.concept))];
  if (!choices.length || !direct.length && choices.length > 1) return { issues: [] };
  return { concept: choices[0], issues: choices.length > 1 ? [`This request names multiple market categories; PriceSignal compares one market category per brief. Using the first explicit category, ${choices[0]}; ${choices.slice(1).join(", ")} is not included in this market comparison.`] : [] };
}

export function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
/** "four percent" in the request, confirmed by the model's own reading of the same number (sign from the wording). */
export function proposalFromWords(raw: string, modelValue: unknown): { value: number; words: string } | undefined {
  const m = raw.match(new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\s+(?:percent|per cent|pct)\\b`, "i"));
  const fromModel = numOrUndef(modelValue);
  if (!m || fromModel === undefined) return undefined;
  const value = NUMBER_WORDS.indexOf(m[1].toLowerCase()) * (/\b(?:cut|lower|reduce|decrease|drop)\b|인하|내리/i.test(raw) ? -1 : 1);
  return Math.abs(fromModel - value) < 1e-9 ? { value, words: m[0] } : undefined;
}

/** An exchange-rate move ("the euro weakened 4%", "환율 3%"); a currency code alone ("our EUR prices") is not one. */
const FX_MOVE = /\bexchange[- ]rates?\b|\bFX\b|\bcurrenc(?:y|ies)\s+(?:moves?|moved|swings?|fell|rose|weakened|strengthened)|\b(?:euro|dollar|won|yen|pound|loonie)s?\s+(?:has\s+|have\s+)?(?:weakened|strengthened|fell|rose|dropped|gained|depreciated|appreciated|moved)\b|환율|원화\s*(?:약세|강세)/i;

/** Percentages are grounded in the request, with separate denominators and explicit signs. */
export function requestPercentages(raw: string, model: any): {
  proposedChangePct?: number; costIncreasePct?: number; costSharePct?: number; passThrough?: number;
  costContext?: string; proposalWords?: string;
  invalidCostShare: boolean; invalidPassThrough: boolean; invalidProposal: boolean; invalidCostChange: boolean; issues: string[];
} {
  // A malformed/huge token must never restart at its trailing digits and become a different rate.
  const matches = [...raw.matchAll(/(?<![\p{N}.,+＋\-−－])([+＋\-−－]?)\s*((?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[+\-]?\d+)?|Infinity|NaN|∞)\s*(?:%|pct\b|percent\b|퍼센트|프로)/giu)];
  // Keep offsets unchanged while protecting common abbreviations from sentence splitting.
  const context = raw.replace(/\b(?:approx|e\.g|i\.e)\./gi, abbreviation => abbreviation.replace(/\./g, " "));
  const clauseBoundary = /[,;!?\n]|(?<!\d)\.|\.(?!\d)|\b(?:but|and|while|whereas)\b|하지만|그런데|반면|그리고/i;
  const found = matches.map((m, i) => {
    const from = i ? matches[i - 1].index! + matches[i - 1][0].length : 0;
    const end = m.index! + m[0].length;
    const before = context.slice(Math.max(from, m.index! - 80), m.index).split(clauseBoundary).at(-1)!;
    const after = context.slice(end, Math.min(matches[i + 1]?.index ?? raw.length, end + 70)).split(clauseBoundary)[0];
    const costWords = /\bcosts?\b|원가|비용|\binput\b|\bingredient\b|\bmaterial\b|\bfreight\b/i;
    const share = /cost[ -]*(?:share|ratio)|costs?[ -]*(?:to|\/)[ -]*(?:selling[ -]*)?price|원가\s*비중|비용\s*비중|판매가.*(?:원가|비용)|(?:원가|비용).*판매가/i.test(before)
      || /^\s*(?:(?:unit|current)\s+)?cost[ -]*(?:share|ratio)\b|^\s*(?:원가|비용)\s*비중/i.test(after)
      || (costWords.test(before) && /^\s*(?:of\s+)?(?:(?:the|our|current)\s+)*(?:(?:selling|sales|sale|retail)\s+)?price\b/i.test(after));
    const pass = !share && (/\bpass(?:ed|ing)?\b|\brecover(?:y)?\b|반영|전가|회수/i.test(before)
      || /^\s*(?:pass[ -]?(?:through|thru)|(?:만|을|를)?\s*(?:반영|전가|회수))/i.test(after)
      || (/원가|비용|상승분|인상분|증가분|그\s*중/.test(before) && /^\s*(?:만|을|를|정도|가량|쯤)?\s*(?:(?:판매\s*)?가격(?:에|으로)\s*)?(?:반영|전가|회수)/.test(after)));
    const cost = !share && !pass && (costWords.test(before) || /^\s*(?:costs?\s+(?:rise|increase|growth|change)|원가\s*(?:상승|증가))/i.test(after));
    // A later price clause cannot reverse an earlier cost change, even without punctuation.
    const directionAfter = cost ? after.split(/\b(?:prices?|selling)\b|가격/i)[0] : after;
    const direction = /\b(?:fall|fell|decreas\w*|reduc\w*|cut|lower\w*)\b|인하|내리|하락|감소/i.test(`${before} ${directionAfter}`);
    const x = Number(m[2].replace(",", ".")) * (/^[\-−－]$/.test(m[1]) || (!m[1] && !share && !pass && direction) ? -1 : 1);
    const lastIndex = (pattern: RegExp) => [...before.matchAll(pattern)].at(-1)?.index ?? -1;
    const fxAt = lastIndex(new RegExp(FX_MOVE.source, "gi"));
    const fxSubject = fxAt >= 0 && !/가격|인상|인하|올려|올리|내려|\bprices?\b|\braise\b|\bincrease\b|\bgo\b|\bwant\b|\bneed\b/i.test(before.slice(fxAt).replace(FX_MOVE, " ")) && !/^\s*(?:인상|인하|올려|올리|내려|price|raise|increase)/i.test(after);
    const unrelatedAt = Math.max(lastIndex(/\b(?:tax|VAT|margin|inflation|CPI|HICP|interest|discount rate)\b|부가세|세율|마진|이익률|물가상승률/gi), fxSubject ? fxAt : -1);
    const proposalAt = lastIndex(/\b(?:thinking|considering|propos\w*|planning|what about|(?:can|could|should|would|will)\s+[^:;.!?]*?\b(?:raise|increase|reduce|cut|change)\s+(?:our\s+)?prices?)\b|가격(?:은|을|이)?\s*(?:인상|인하|변경)/gi);
    const unrelated = unrelatedAt >= 0 && proposalAt <= unrelatedAt
      || /^\s*(?:VAT|tax|margin|inflation|부가세|세율|마진|이익률)\b/i.test(after);
    const timeContext = `${before} ${after}`.replace(/\b(?:same as|like) last (?:quarter|month|year)\b|지난\s*분기(?:와)?\s*같은\s*조건(?:으로)?/gi, " ");
    const historical = /\b(?:last year|last quarter|last month|previously|earlier|already|used to|previous price)\b|작년|지난해|지난\s*(?:분기|달)|이전\s*가격/i.test(timeContext);
    return { x, signed: !!m[1], share, pass, cost, unrelated, historical, before, after: directionAfter, previousValue: false, context: `${before} ${m[0]} ${directionAfter}` };
  });
  // A named field changed "from A% to B%" has one current value, B. Keep this
  // link narrow: intervening field names and alternatives must not inherit A's role.
  for (let i = 1; i < found.length; i++) {
    const previous = found[i - 1], current = found[i];
    const previousMatch = matches[i - 1], currentMatch = matches[i];
    const bridge = raw.slice(previousMatch.index! + previousMatch[0].length, currentMatch.index).trim();
    const english = /^to$/i.test(bridge) && /\bfrom\s*$/i.test(previous.before);
    const korean = bridge === "에서" && /^\s*(?:으)?로(?=$|[\s.,;!?]|바꾸|바꿔|변경|조정|낮추|높이)/.test(current.after);
    if (!english && !korean) continue;
    if (/\b(?:range|ranges|ranging|anywhere)\b|범위/i.test(previous.before)) continue;
    const role = (p: typeof current) => p.share ? "share" : p.pass ? "pass" : p.cost ? "cost" : p.unrelated ? "unrelated" : "proposal";
    if (role(current) !== "proposal" && role(current) !== role(previous)) continue;
    previous.previousValue = true;
    current.share = previous.share;
    current.pass = previous.pass;
    current.cost = previous.cost;
    current.unrelated = previous.unrelated;
    current.historical = previous.historical;
    // A named reduction is negative; "lower the proposal" only lowers its rate.
    // Use the subject next to A, not an earlier direction word or A's inferred sign.
    const subject = previous.before.replace(/\bfrom\s*$/i, "").trim();
    const reduction = !current.share && !current.pass && (
      /\b(?:prices?|costs?)\s+(?:reduction|decrease|decline|fall|cut)(?:\s+(?:rate|percentage))?$/i.test(subject)
      || /\b(?:reduction|decrease|decline|fall|cut)\s+(?:in|of)\s+(?:the\s+)?(?:prices?|costs?)$/i.test(subject)
      || /(?:가격|원가|비용)\s*(?:인하|하락|감소)(?:율|률)?(?:을|를|은|는)?$/.test(subject)
    );
    current.x = Number(currentMatch[2].replace(",", ".")) * (/^[\-−－]$/.test(currentMatch[1]) || !currentMatch[1] && reduction ? -1 : 1);
    current.context = `${previous.before} ${currentMatch[0]} ${current.after}`;
  }
  const chooseOption = (kind: "share" | "pass" | "cost", modelValue: unknown, scale = 1) => {
    const options = found.filter(p => p[kind] && !p.previousValue);
    const fromModel = numOrUndef(modelValue);
    return options.find(p => fromModel !== undefined && Math.abs(p.x - fromModel * scale) < 1e-9) ?? options.at(-1);
  };
  const choose = (kind: "share" | "pass" | "cost", modelValue: unknown, scale = 1) => chooseOption(kind, modelValue, scale)?.x;
  const share = choose("share", model.cost_share_pct);
  const passPct = choose("pass", model.pass_through, 100);
  const invalidCostShare = share !== undefined && (!Number.isFinite(share) || share < 0 || share > 100);
  const invalidPassThrough = passPct !== undefined && (!Number.isFinite(passPct) || passPct < 0 || passPct > 100);
  const proposals = found.filter(p => !p.previousValue && !p.share && !p.pass && !p.cost && !p.unrelated && !p.historical);
  const uniqueProposals = [...new Set(proposals.map(p => p.x))];
  const ambiguousProposal = uniqueProposals.length > 1;
  // "3-4%" or "3 to 4%" outside a cost, pass-through or share phrase is a range, not one proposal.
  const rangeProposal = [...raw.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|~|〜|\bto\b)\s*(\d+(?:[.,]\d+)?)\s*(?:%|pct\b|percent\b|퍼센트|프로)/gi)]
    .some(m => !/\b(?:costs?|pass\w*|recover\w*|share|margin|tax|VAT|inflation|CPI|HICP|rose|risen|running|was|were)\b|원가|비용|반영|전가|비중|물가/i.test(raw.slice(Math.max(0, m.index! - 40), m.index))
      && !/^\s*(?:of\s+)?(?:(?:our|the)\s+)?(?:costs?\b|cost increase|pass|recover|원가|비용|반영|전가)/i.test(raw.slice(m.index! + m[0].length, m.index! + m[0].length + 30)));
  // "four percent": used only when no digits gave a proposal and Nemotron read the same number from the request.
  const wordProposal = !proposals.length && !rangeProposal ? proposalFromWords(raw, model.proposed_change_pct) : undefined;
  const proposal = proposals[0] ?? (wordProposal ? { x: wordProposal.value } : undefined);
  const invalidProposal = ambiguousProposal || rangeProposal || proposals.some(p => !Number.isFinite(p.x) || p.x < -100);
  const selectedCost = chooseOption("cost", model.cost_increase_pct);
  const costChange = selectedCost?.x;
  const invalidCostChange = costChange !== undefined && (!Number.isFinite(costChange) || costChange < -100);
  const issues: string[] = [];
  if (invalidCostShare) issues.push("Cost share must be between 0% and 100% of the current selling price; the invalid value is not reused from memory and the cost-recovery target is omitted.");
  if (invalidPassThrough) issues.push("Cost pass-through must be between 0% and 100% of the monetary cost increase; the invalid policy is not replaced by a remembered value and the cost-recovery target is omitted.");
  if (ambiguousProposal) issues.push("Multiple different proposed price changes were supplied; provide one proposal. No proposal is chosen or recalled for this comparison.");
  if (rangeProposal) issues.push("A range of proposed changes was given; provide one proposal. No proposal is chosen or recalled for this comparison.");
  if (FX_MOVE.test(raw)) issues.push("An exchange-rate change was mentioned; exchange rates are not used in this comparison.");
  if (/\b(?:every|each|per)\s+quarter\b|\bquarterly\s+(?:increases?|rises?|hikes?|raises?)\b|매\s*분기|분기마다/i.test(raw)) issues.push("The question describes a repeated quarterly increase. The benchmark is year-on-year, and repeated quarterly increases add up over a year.");
  if (proposals.some(p => !Number.isFinite(p.x) || p.x < -100)) issues.push("The proposed price change must be finite and at least -100%; the invalid value is omitted and is not replaced from memory.");
  if (invalidCostChange) issues.push("The cost change must be finite and at least -100%; the invalid value is omitted and is not replaced from memory.");
  return {
    proposalWords: wordProposal && !invalidProposal ? wordProposal.words : undefined,
    proposedChangePct: invalidProposal ? undefined : proposal?.x,
    costIncreasePct: invalidCostChange ? undefined : costChange,
    costContext: invalidCostChange ? undefined : selectedCost?.context,
    costSharePct: invalidCostShare ? undefined : share,
    passThrough: invalidPassThrough || passPct === undefined ? undefined : passPct / 100,
    invalidCostShare, invalidPassThrough, invalidProposal, invalidCostChange, issues,
  };
}
