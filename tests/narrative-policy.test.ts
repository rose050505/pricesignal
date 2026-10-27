import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedNumbers, buildFacts, checkNarrative } from '../src/brief.ts';
import { PriceSignalAgent } from '../src/agent.ts';
import { AgentMemory } from '../src/memory.ts';
import { HMEM } from '../src/hmem_impl.ts';

const request = (cost = false): any => ({ raw: 'Canada food +4%; recover 60%', countries: ['CA'], concept: 'food', conceptWords: ['food'], unknownCountries: [], proposedChangePct: 4, passThrough: .6, ...(cost ? { costIncreasePct: 8, costSharePct: 60 } : {}) });
function check(text: string, cost = false, field: 'markets'|'headline'|'watch' = 'markets') {
  const req = request(cost);
  const facts = buildFacts([['2026-08',6],['2026-09',2.2]].map(([period,yoy_pct]) => ({ country: 'CA', concept: 'food', category_label: 'Food', frequency: 'M', period, yoy_pct, source_id: 'fixture' })), req, 'Q1', .6, new Date('2026-10-27'));
  return checkNarrative({ headline: field === 'headline' ? text : 'Canada food', markets: field === 'markets' ? { CA: text } : {}, ...(field === 'watch' ? {watch:text} : {}) }, allowedNumbers(facts, req, .6), facts, req, .6);
}

test('a recorded unsupported policy application is rejected in each prose field', () => {
  // Preserved batch 3 example 03: no cost change or cost share was supplied.
  const text = 'With a 60% cost pass-through applied, the adjustment is evaluated against the Food CPI benchmark.';
  for (const field of ['markets','headline','watch'] as const) assert.ok(check(text,false,field).some(e=>/policy|pass.through/i.test(e)), field);
});

test('the cost policy cannot be claimed to scale the historical market benchmark even with complete costs', () => {
  for (const text of [
    'The market benchmark of 2.2–4.1% is calculated after applying the 60% cost pass-through.',
    'Applying the 60% cost pass-through to the market benchmark gives a range of 2.2–4.1%.',
    'The historical CPI benchmark is scaled by the 60% pass-through policy.',
    'The benchmark is adjusted for the 60% cost recovery policy.',
  ]) assert.ok(check(text,true).some(e=>/policy|pass.through/i.test(e)), text);
});

test('policy statements and separate cost scenarios remain valid without a false application claim', () => {
  for (const text of [
    'The 60% cost pass-through is separate from the 2.2–4.1% market benchmark.',
    'The market benchmark is not scaled by the 60% cost pass-through.',
    'Applying the 60% pass-through does not change the historical market benchmark.',
    'The proposed 4% change is within the market benchmark; the stated cost pass-through is 60%.',
    'A cost share is needed before applying the 60% cost pass-through.',
    'Cost pass-through is 60%; the market benchmark remains unadjusted.',
  ]) assert.deepEqual(check(text), [], text);
  for (const text of [
    'Applying the 60% pass-through to the cost change gives a 2.9% cost recovery target.',
    'With a 60% cost pass-through applied, the cost recovery target is 2.9%, within the market benchmark.',
    'The cost recovery target is 2.9%; the market benchmark is 2.2–4.1%.',
  ]) assert.deepEqual(check(text,true), [], text);
});

test('the narrative request keeps the exact cost basis and rewrites a false market-policy claim', async () => {
  const req = { ...request(true), costShareBasis: 'after_change' as const };
  const facts = buildFacts([{country:'CA',concept:'food',category_label:'Food',frequency:'M',period:'2026-09',yoy_pct:2.2,source_id:'fixture'}],req,'Q1',.6,new Date('2026-10-27'));
  const memory: AgentMemory = Object.create(AgentMemory.prototype); (memory as any).hmem = new HMEM();
  let calls = 0; let payload: any; let instructions = '';
  const agent: any = new PriceSignalAgent({ memory, hedgeMs: Infinity, sql: {run:async()=>{throw Error('SQL forbidden');}}, llm: async(messages: any[]) => {
    calls++; instructions=messages[0].content;
    payload = JSON.parse(messages[1].content.split('Facts: ')[1].split('\nReply with JSON only')[0]);
    return {model:'offline',provider:'fixture',ms:0,text:JSON.stringify({ headline:'Canada food', markets:{CA:calls === 1 ? 'The market benchmark is scaled by the 60% pass-through policy.' : 'Cost recovery target 2.7% is above the market benchmark.'} })};
  } });
  const result = await agent.narrate(req,facts,[],.6);
  assert.equal(calls,2);
  assert.ok(result.narrative);
  assert.match(payload.cost_share_basis,/after the stated cost change/);
  assert.equal(payload.cost_share_basis,payload.facts[0].cost_share_basis);
  assert.match(instructions,/does not (?:scale|change).*market benchmark/);
});

test('pass-thru spelling has the same checks as pass-through',()=>{
  assert.ok(check('The market benchmark is scaled by the 60% pass-thru policy.').some(e=>/policy/i.test(e)));
});

test('negative instructions about applying the policy remain valid',()=>{
  assert.deepEqual(check('Never apply the 60% cost pass-through to the market benchmark.'),[]);
});
