import test from "node:test";
import assert from "node:assert/strict";
import { validateSelections, type SelectionGroup } from "../src/selection.ts";
import { CONCEPT_WORDS, skuSearchWords } from "../src/sources/types.ts";

function chooseConfectionery(products: string[]) {
  const group: SelectionGroup = {
    id: "DE:snacks", country: "DE", concept: "snacks", products,
    candidates: [{ agency: "eurostat", country: "DE", dataset: "fixture", code: "sweet", label: "Sugar, confectionery and desserts", frequency: "M", measure: "yoy_pct", status: "active", sourceUrl: "https://fixture.invalid/unused" }],
  };
  return validateSelections({ selections: [{ id: group.id, candidate: 0, fit: "specific", reason: "The confectionery label covers the chocolate products." }] }, [group], "fixture");
}

test("chocolate chips and chocolate-chip cookies are not mistaken for savoury chips", () => {
  for (const product of ["Chocolate chips 60 g", "WHITE CHOCOLATE CHIPS", "Chocolate-chip cookies"]) {
    assert.doesNotThrow(() => chooseConfectionery([product]), product);
  }
});

test("chocolate-chip products do not add potato search hints or mutate market words", () => {
  const original = [...CONCEPT_WORDS.snacks];
  for (const product of ["Chocolate chips 60 g", "WHITE CHOCOLATE CHIPS", "Chocolate-chip cookies"]) {
    assert.deepEqual(skuSearchWords("snacks", [product]), original, product);
  }
  assert.deepEqual(CONCEPT_WORDS.snacks, original);
});

test("a mixed chocolate-chip and savoury-chip product still rejects confectionery-only labels", () => {
  for (const products of [["Chocolate chips and potato crisps"], ["Chocolate chips", "Honey butter chips"], ["Potato chips"], ["Chili crisps"]]) {
    assert.throws(() => chooseConfectionery(products), /conflicts with chips or crisps/, products.join(", "));
  }
});

test("mixed products and ordinary savoury chips retain potato search hints", () => {
  for (const products of [["Chocolate chips and potato crisps"], ["Chocolate chips", "Honey butter chips"], ["Potato chips"], ["Chili crisps"]]) {
    assert.deepEqual(skuSearchWords("snacks", products), [...CONCEPT_WORDS.snacks, "potato", "crisp", "chip"]);
  }
});
