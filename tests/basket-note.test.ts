// "Food" is not the same basket everywhere (judge Impact review, 27 Oct 13:18, -2): StatCan's Food index includes
// food purchased from restaurants (v41691046 sits under v41690974) and ABS's Food and non-alcoholic beverages group
// includes Meals out and take away foods, while Eurostat's COICOP 01 excludes restaurants (they are in division 11).
// The brief and the result card say so when one comparison mixes the two kinds.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { basketNote, renderBrief } from "../src/brief.ts";
import type { Request } from "../src/agent.ts";

const series = (sourceId: string, label: string) => ({ concept: "food", label, frequency: "M", sourceId, latestPeriod: "2026-09", latestYoy: 1, avg12: 1, averageCount: 12, averageExpected: 12 as const, averageLabel: "12 of 12 monthly observations", trend: "flat" as const, points: [] });
const DE = { country: "DE", agency: "Eurostat (HICP)", category: series("eurostat:prc_hicp_minr:CP01:RCH_A", "Food and non-alcoholic beverages"), cite: "Q1" } as any;
const FR = { ...DE, country: "FR", category: series("eurostat:prc_hicp_minr:CP01:RCH_A", "Food and non-alcoholic beverages") };
const CA = { country: "CA", agency: "Statistics Canada (CPI)", category: series("statcan:18100004:v41690974", "Food"), cite: "Q1" } as any;
const AU = { country: "AU", agency: "Australian Bureau of Statistics (CPI)", category: series("abs:CPI:1.20001.10.50.M", "Food and non-alcoholic beverages"), cite: "Q1" } as any;
const req: Request = { raw: "q", countries: ["DE", "CA", "AU"], concept: "food", conceptWords: ["food"], proposedChangePct: 5, passThrough: 0.7, unknownCountries: [] };

test("a comparison that mixes food baskets with and without restaurant meals says which is which", () => {
  assert.equal(basketNote([DE, CA, AU], req), "Basket note: the CA (StatCan Food) and AU (ABS Food and non-alcoholic beverages) series include restaurant and take-away meals; the DE (Eurostat Food and non-alcoholic beverages) series does not (HICP counts restaurants separately).");
  assert.equal(basketNote([DE, FR, AU], { ...req, countries: ["DE", "FR", "AU"] }), "Basket note: the AU (ABS Food and non-alcoholic beverages) series includes restaurant and take-away meals; the DE and FR (Eurostat Food and non-alcoholic beverages) series do not (HICP counts restaurants separately).");
});

test("no note when every series has the same scope, for other categories, or for all-items", () => {
  assert.equal(basketNote([DE, FR], { ...req, countries: ["DE", "FR"] }), undefined);
  assert.equal(basketNote([CA, AU], { ...req, countries: ["CA", "AU"] }), undefined);
  const snackDE = { ...DE, category: series("eurostat:prc_hicp_minr:CP01193:RCH_A", "Confectionery products") };
  assert.equal(basketNote([snackDE, CA], req), undefined);
  assert.equal(basketNote([DE, CA, AU], { ...req, concept: "all_items" }), undefined);
});

test("the brief and the result card carry the note", () => {
  const b: any = { request: req, facts: [DE, CA, AU], notes: [], passThrough: 0.7, compared: { id: "Q1", sql: "", columns: [], rows: [], ms: 0 }, sqlLog: [], views: [], ms: 1, trace: [] };
  assert.match(renderBrief(b), /^Basket note: the CA \(StatCan Food\) and AU/m);
  const server = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(server, /basket: b\.facts\.length \? basketNote\(b\.facts, b\.request\) \?\? null : null/);
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /exchange rates are not included\.\$\{r\.basket\?` \$\{esc\(r\.basket\)\}`:""\}<\/div>/);
});
