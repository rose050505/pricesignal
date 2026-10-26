import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSelection, selectionMessages, skuScope, validateSelections, type SelectionGroup } from '../src/selection.ts';

const group = (): SelectionGroup => ({
  id: 'DE:snacks', country: 'DE', concept: 'snacks', products: ['Honey butter chips 60 g'],
  candidates: [
    { agency:'eurostat',country:'DE',dataset:'fixture',code:'sweet',label:'Sugar, confectionery and desserts',frequency:'M',measure:'yoy_pct',status:'active',sourceUrl:'https://example.test/sweet' },
    { agency:'eurostat',country:'DE',dataset:'fixture',code:'savory',label:'Potato crisps',frequency:'M',measure:'yoy_pct',status:'active',sourceUrl:'https://example.test/savory' },
    { agency:'eurostat',country:'DE',dataset:'fixture',code:'broad',label:'Food and non-alcoholic beverages',frequency:'M',measure:'yoy_pct',status:'active',sourceUrl:'https://example.test/food',isBroadFallback:true },
  ],
});
const reply = (candidate = 1, fit = 'specific') => ({ selections:[{id:'DE:snacks',candidate,fit,reason:'The label covers the listed savoury chips.'}] });

test('product scope is stable across order, duplicates and whitespace but changes with the product set', () => {
  assert.equal(skuScope([' Sauce  bottle ','CHIPS','chips']),skuScope(['chips','sauce bottle']));
  assert.notEqual(skuScope(['sweet candy']),skuScope(['savoury chips']));
  assert.match(skuScope(['chips']),/^sku:[a-f0-9]{16}$/);
});

test('selection prompt contains product context and only supplied candidates, without endpoint credentials', () => {
  const g=group();g.candidates[0].sourceUrl='https://example.test/?credential=do-not-send';
  const messages=selectionMessages([g]);
  assert.match(messages[0].content,/candidate/i);
  assert.match(messages[1].content,/Honey butter chips/);
  assert.match(messages[1].content,/Potato crisps/);
  assert.doesNotMatch(JSON.stringify(messages),/credential|sourceUrl/);
});

test('a valid specific selection retains its candidate, model and bounded explanation', () => {
  const decisions=validateSelections(reply(),[group()],'nemotron');
  assert.deepEqual(decisions.get('DE:snacks'),{candidate:1,fit:'specific',reason:'The label covers the listed savoury chips.',by:'model',model:'nemotron'});
});

test('known chips versus confectionery-only mismatch is rejected even when the model approves it', () => {
  assert.throws(()=>validateSelections(reply(0),[group()],'nemotron'),/conflict|chips/i);
  const g=group();g.candidates[0].label='Snacks and confectionery';
  assert.equal(validateSelections(reply(0),[g],'nemotron').get(g.id)?.candidate,0);
});

test('invalid, duplicate, missing and foreign group decisions cannot bypass the candidate allowlist', () => {
  for(const candidate of [-1,100,1.5,'1',null]) assert.throws(()=>validateSelections(reply(candidate as any),[group()],'m'));
  for(const fit of ['precise','none','',null]) assert.throws(()=>validateSelections(reply(1,fit as any),[group()],'m'));
  assert.throws(()=>validateSelections({selections:[]},[group()],'m'));
  assert.throws(()=>validateSelections({selections:[...reply().selections,...reply().selections]},[group()],'m'));
  assert.throws(()=>validateSelections({selections:[{...reply().selections[0],id:'AU:snacks'}]},[group()],'m'));
  assert.throws(()=>validateSelections({selections:[{...reply().selections[0],reason:{text:'x'}}]},[group()],'m'));
});

test('official Food alternative is broader, including on model failure; unavailable fallback returns none', () => {
  const g=group();
  assert.throws(()=>validateSelections(reply(2,'specific'),[g],'m'),/broader/i);
  assert.equal(validateSelections(reply(2,'broader'),[g],'m').get(g.id)?.fit,'broader');
  assert.deepEqual(fallbackSelection(g),{candidate:2,fit:'broader',reason:'Using the official Food series as a broader proxy; a product-specific match was not confirmed.',by:'fallback'});
  g.candidates=g.candidates.slice(0,2);
  assert.equal(fallbackSelection(g),undefined,'never silently return the first narrow candidate');
});

test('selection reasons cannot introduce unsupported numbers, price advice or forecasts', () => {
  for (const reason of [
    'Potato crisps are up 99%, so a 25% price rise is justified.',
    'Inflation will rise next year.',
    'A price increase is recommended for these products.',
    'Raise prices because this category covers chips.',
    'The rate is eight percent.',
    'The category permits passing through costs to customers.',
  ]) {
    const input = reply(); input.selections[0].reason = reason;
    assert.throws(() => validateSelections(input,[group()],'m'),/reason|coverage/i, reason);
  }
  const input=reply();input.selections[0].reason='The consumer price category covers savoury potato crisps.';
  assert.equal(validateSelections(input,[group()],'m').get('DE:snacks')?.reason,input.selections[0].reason);
});

test('broader model selections use a factual coverage disclosure instead of an unverified rationale',()=>{
  const input=reply(2,'broader');
  input.selections[0].reason='Honey butter chips are a food product within non-alcoholic beverages.';
  const decision=validateSelections(input,[group()],'m').get('DE:snacks')!;
  assert.equal(decision.reason,'This series is a broader category proxy, not a product-specific match.');
});
