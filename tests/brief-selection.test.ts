import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFacts,renderBrief,type Brief} from '../src/brief.ts';
import type {Request} from '../src/agent.ts';

function brief():Brief {
  const request:Request={raw:'DE food +3%',countries:['DE'],concept:'food',conceptWords:['food'],unknownCountries:[],proposedChangePct:3};
  const facts=buildFacts([{country:'DE',concept:'food',category_label:'Food',frequency:'M',period:'2026-09',yoy_pct:2,source_id:'official:food'}],request,'Q1',0.7);
  const compared={id:'Q1',sql:'SELECT fixture',columns:[],rows:[],ms:1};
  return {request,facts,notes:[],passThrough:0.7,compared,sqlLog:[compared],views:[],ms:10,trace:[],pricingQuery:compared,skus:[{sku:'CHIPS',product:'Honey butter chips',country:'DE',skuCategory:'snacks',currency:'EUR',currentPrice:3,period:'2026-09',yoy:2,sourceId:'official:food',cite:'Q1',rateLabel:'Food',low:3.04,high:3.05,rangeLow:1.4,rangeHigh:1.6,coarser:true,selectionSource:'fallback',selectionFit:'broader'}]};
}

test('Markdown marks broader SKU proxies and distinguishes unconfirmed, model and remembered selections',()=>{
  const b=brief();
  for (const [source,label] of [['fallback','unconfirmed match'],['model','model-selected'],['memory','remembered match']] as const) {
    b.skus![0].selectionSource=source;
    const md=renderBrief(b);
    assert.match(md,/broader proxy/);
    assert.ok(md.includes(label));
  }
});

test('Markdown negative SKU ranges do not acquire a contradictory plus sign',()=>{
  const b=brief();b.skus![0].rangeLow=-1.4;b.skus![0].rangeHigh=-1;
  assert.doesNotMatch(renderBrief(b),/\+-1\.4/);
});
