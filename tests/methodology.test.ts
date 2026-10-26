import test from 'node:test';
import assert from 'node:assert/strict';
import { seriesFacts, buildFacts, factsForNarrative, allowedNumbers, checkNarrative, renderBrief } from '../src/brief.ts';

const row = (period: string, yoy: unknown, frequency = 'M') => ({country:'DE',concept:'food',category_label:'Food',frequency,period,yoy_pct:yoy,source_id:'fixture'});
const request = (extra: Record<string, unknown> = {}): any => ({raw:'DE food',countries:['DE'],concept:'food',conceptWords:['food'],unknownCountries:[],...extra});
const facts = (rows: Record<string, unknown>[], req = request(), policy = 0.7) => buildFacts(rows,req,'Q1',policy,new Date('2026-10-27'));
const markdown = (rows: Record<string, unknown>[], req = request(), policy = 0.7) => renderBrief({request:req,facts:facts(rows,req,policy),notes:[],passThrough:policy,compared:{id:'Q1',sql:'',columns:[],rows:[],ms:0},sqlLog:[],views:[],ms:1,trace:[]});

test('a sparse average covers the latest calendar year and cannot invent a flat trend', () => {
  const s: any = seriesFacts([row('2024-09',99),row('2025-09',88),row('2026-09',2)]);
  assert.equal(s.avg12,2);
  assert.equal(s.averageCount,1);
  assert.equal(s.averageExpected,12);
  assert.equal(s.averageLabel,'1 of 12 monthly observations');
  assert.equal(s.trend,'insufficient history');
  assert.equal(s.yoy6Back,undefined);
});

test('quarterly observations have explicit coverage and a six-calendar-month comparison', () => {
  const s: any = seriesFacts([row('2025-Q3',99,'Q'),row('2025-Q4',1,'Q'),row('2026-Q1',2,'Q'),row('2026-Q2',3,'Q'),row('2026-Q3',4,'Q')]);
  assert.equal(s.avg12,2.5);
  assert.equal(s.averageLabel,'4 of 4 quarterly observations');
  assert.equal(s.averageCount,4);
  assert.equal(s.averageExpected,4);
  assert.equal(s.yoy6Back,2);
  assert.equal(s.trend,'rising');
});

test('a row-count offset cannot replace a missing six-month observation', () => {
  const s = seriesFacts(['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2026-09'].map(p=>row(p,2)))!;
  assert.equal(s.yoy6Back,undefined);
  assert.equal(s.trend,'insufficient history');
  const exact = seriesFacts([row('2026-03',4),row('2026-09',2)])!;
  assert.equal(exact.yoy6Back,4);
  assert.equal(exact.trend,'easing');
});

test('null, blank, boolean and invalid-period observations do not become zero rates; periods are counted once', () => {
  const s: any = seriesFacts([row('2026-07',2),row('2026-07',2),row('2026-08','4.0'),row('2026-09',null),row('2026-10',' '),row('2026-11',false),row('2026-13',80),row('bad',99)]);
  assert.equal(s.latestPeriod,'2026-08');
  assert.equal(s.latestYoy,4);
  assert.equal(s.avg12,3);
  assert.equal(s.averageCount,2);
  assert.equal(seriesFacts([row('2026-Q5',2,'Q'),row('2026-00',3),row('2026-09',null)]),undefined);
});

test('the market benchmark uses observed rates regardless of the cost policy and preserves deflation', () => {
  const req=request({proposedChangePct:-2});
  const rows=[row('2026-08',-4),row('2026-09',-2)];
  const [a]=facts(rows,req,0.7);
  const [b]=facts(rows,req,0.2);
  assert.deepEqual({low:a.suggested!.low,high:a.suggested!.high},{low:-3,high:-2});
  assert.deepEqual(a.suggested,b.suggested);
  assert.equal(a.verdict,'within the market benchmark');
  assert.equal(a.passThroughNeeded,undefined);
  assert.doesNotMatch(a.suggested!.basis,/pass-through/);
});

test('the cost scenario uses the unit-cost to selling-price denominator and requires its input', () => {
  const rows=[row('2026-09',2)];
  const req=request({costIncreasePct:8,costSharePct:60,proposedChangePct:4});
  const [a]=facts(rows,req);
  assert.equal(a.costNeed,3.4,'100 price, 60 cost, 8% cost rise and 70% recovery gives 3.36%, rounded to 3.4%');
  assert.equal(a.costVsMarket,'above the market benchmark');
  const [missing]=facts(rows,request({costIncreasePct:8}));
  assert.equal(missing.costNeed,undefined);
  for(const costSharePct of [-1,101,NaN]) assert.equal(facts(rows,request({costIncreasePct:8,costSharePct}))[0].costNeed,undefined);
  assert.equal(facts(rows,request({costIncreasePct:8,costSharePct:0}))[0].costNeed,0);
});

test('narrative facts identify coverage, market benchmark and the cost denominator', () => {
  const req=request({costIncreasePct:8,costSharePct:60});
  const [payload]: any = (factsForNarrative as any)(facts([row('2026-09',2)],req),req,0.7);
  assert.deepEqual(payload.benchmark_range_pct,{low:2,high:2});
  assert.equal(payload.suggested_range_pct,undefined);
  assert.equal(payload.category.averageLabel,'1 of 12 monthly observations');
  assert.equal(payload.cost_share_pct,60);
  assert.equal(payload.cost_share_basis,'current unit cost / current selling price');
  assert.equal(payload.cost_pass_through_pct,70);
  assert.equal(payload.pass_through_needed_pct,undefined);
});

test('an invalid explicit cost policy cannot silently calculate with a default', () => {
  const req=request({costIncreasePct:8,costSharePct:60,invalidPassThrough:true});
  const fs=facts([row('2026-09',2)],req);
  assert.equal(fs[0].costNeed,undefined);
  const [payload]: any=(factsForNarrative as any)(fs,req,0.7);
  assert.equal(payload.cost_pass_through_pct,undefined);
  const md=markdown([row('2026-09',2)],req);
  assert.match(md,/cost policy.*unavailable|invalid.*cost policy/i);
  assert.doesNotMatch(md,/recover 70%|\+3\.4%/);
});

test('Markdown describes benchmark limits and asks for the cost denominator when absent', () => {
  const rows=[row('2026-09',2)];
  const missing=markdown(rows,request({costIncreasePct:8}));
  assert.match(missing,/current unit cost as a percentage of (?:the )?current selling price/i);
  assert.match(missing,/not a forecast|does not forecast/i);
  assert.match(missing,/not.*confidence interval/i);
  assert.match(missing,/1 of 12 monthly observations/);
  assert.doesNotMatch(missing,/Suggested new price|Suggested range|what the market supports|12-period avg|\+5\.6% price rise/);
  const cost=markdown(rows,request({costIncreasePct:8,costSharePct:60}));
  assert.match(cost,/60%.*current selling price/);
  assert.match(cost,/\+3\.4%/);
  assert.doesNotMatch(cost,/costs call for|above local inflation|needs .*pass-through/);
});

test('grounding checks signed benchmark ranges and the new verdict vocabulary', () => {
  const req=request({proposedChangePct:-2});
  const fs=facts([row('2026-08',-4),row('2026-09',-2)],req);
  const check=(text:string)=>checkNarrative({headline:'Historical market comparison',markets:{DE:text}},allowedNumbers(fs,req,0.7),fs,req,0.7);
  assert.deepEqual(check('The market benchmark is -3% to -2%; -2% is within the market benchmark.'),[]);
  assert.ok(check('The market benchmark is 2% to 3%; -2% is within the market benchmark.').length);
  assert.ok(check('-2% is above the market benchmark.').length);
  assert.ok(check('Consumers will accept a price increase.').length);
  assert.ok(check('Food inflation will rise next month.').length);
  assert.ok(check('Food inflation is +2% YoY.').length, 'a deflation rate cannot acquire an explicit plus sign');
  assert.ok(check('Given costs, the proposed -2% is above the market benchmark.').length, 'mentioning costs cannot hide a wrong proposal verdict');
  assert.deepEqual(check('This historical benchmark is not a forecast of customer demand.'),[]);
});

test('observation counts may describe coverage but cannot authorize an invented inflation rate', () => {
  const req=request();
  const fs=facts([row('2026-09',2)],req);
  const check=(text:string)=>checkNarrative({headline:'Historical comparison',markets:{DE:text}},allowedNumbers(fs,req,0.7),fs,req,0.7);
  assert.ok(check('Food inflation is 12% YoY.').length);
  assert.deepEqual(check('The average is 2%, based on 1 of 12 monthly observations.'),[]);
  assert.ok(check('The average is 2%, based on 2 of 12 monthly observations.').length);
});

test('cost scenario comparison labels are checked independently from the proposal', () => {
  const req=request({costIncreasePct:8,costSharePct:60,proposedChangePct:1});
  const fs=facts([row('2026-09',2)],req);
  const check=(text:string, headline='Historical comparison')=>checkNarrative({headline,markets:{DE:text}},allowedNumbers(fs,req,0.7),fs,req,0.7);
  assert.equal(fs[0].costNeed,3.4);
  for(const word of ['within','below']) {
    assert.ok(check(`Your cost recovery target of 3.4% is ${word} the market benchmark.`).length,word);
    assert.ok(check('',`The cost recovery target is ${word} the market benchmark in DE.`).length,`headline ${word}`);
  }
  assert.deepEqual(check('The proposed 1% is below the market benchmark, while the cost recovery target of 3.4% is above the market benchmark.'),[]);
  assert.deepEqual(check('Your cost recovery target of 3.4% is above the market benchmark.','The cost recovery target is above the market benchmark in DE.'),[]);
});

test('deflation cannot be described as an unsigned positive YoY or a price rise, while a fall magnitude stays valid', () => {
  const req=request({proposedChangePct:2,costIncreasePct:2});
  const fs=facts([row('2026-09',-2)],req);
  const check=(text:string)=>checkNarrative({headline:'Historical comparison',markets:{DE:text}},allowedNumbers(fs,req,0.7),fs,req,0.7);
  for(const text of ['Food inflation is 2% YoY.','Food prices rose 2%.','Food prices increased by 2%.','Food inflation was 2% year on year.']) assert.ok(check(text).length,text);
  for(const text of ['Food inflation is -2% YoY.','Food prices fell by 2%.','Food prices declined 2% year on year.','The proposed 2% price increase is above the market benchmark.']) assert.deepEqual(check(text),[],text);
});
