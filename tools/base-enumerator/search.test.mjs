import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Run} from './runner.mjs';
import {cleanInput,buildModel,Enumerator,simulate,score,compare,stable} from './core.mjs';
import {officeUpperBound,candidateTableKey,FacilityCandidates} from './search.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),demo=JSON.parse(fs.readFileSync(new URL('./demo.json',import.meta.url))),trade=JSON.parse(fs.readFileSync(new URL('./examples/quality-trading.json',import.meta.url)));
function finish(raw,strategy,resume=false){const input=structuredClone(raw);input.options.searchStrategy=strategy;let r=new Run(catalog,input),row,n=0;for(;!r.done&&n<100000;n++){const s=r.next();if(s.row)row=s.row;if(resume&&n===9)r=new Run(catalog,input,JSON.parse(JSON.stringify(r.checkpoint())));}assert.ok(r.done);assert.equal(row.evaluationErrors,0);return row;}
test('bounded search matches exhaustive best for 2/3 teams, ranking windows, and depletion fallback',()=>{
 for(const teams of [2,3])for(const rankingWindow of ['24h','cycle'])for(const rotation of ['12h','first','all']){
  const raw=structuredClone(demo);Object.assign(raw.options,{teams,rankingWindow,rotation,maxHours:168});const reference=finish(raw,'exhaustive'),fast=finish(raw,'bounded');
  assert.equal(Boolean(fast.best),Boolean(reference.best));if(fast.best)assert.equal(compare(fast.best.score,reference.best.score),0,JSON.stringify({teams,rankingWindow,rotation}));
  if(rotation!=='12h')assert.equal(fast.boundPruned,'0');
 }
});
test('bounded search strictly reduces simulated plans and resumes to the same optimum',()=>{
 const ref=finish(demo,'exhaustive'),fast=finish(demo,'bounded'),resumed=finish(demo,'bounded',true);
 assert.ok(BigInt(fast.examined)<BigInt(ref.examined));assert.ok(BigInt(fast.boundPruned)>0n);
 assert.deepEqual(fast.best.score,resumed.best.score);assert.deepEqual(fast.best.plan,resumed.best.plan);assert.equal(fast.examined,resumed.examined);
 assert.equal(fast.conditionKey,ref.conditionKey);assert.ok(fast.controlEffectsCacheHits>0);
});
test('partial office bounds dominate every feasible completion in a tiny exhaustive oracle',()=>{
 const model=buildModel(catalog,cleanInput(demo,catalog)),e=new Enumerator(model);let s;
 while(!(s=e.advance()).done){if(!s.plan)continue;const value=score(model,simulate(model,s.plan));if(!value)continue;
  const selected=model.tasks.map(t=>s.plan.groups.find(g=>g.team===t.team&&g.room===t.room)?.operators.filter(id=>!t.fixed.includes(id))??[]);
  for(let depth=0;depth<=model.tasks.length;depth++)assert.ok(officeUpperBound(model,selected,depth)>=value[0]-1e-9);
 }
 const office=model.pool.find(o=>o.skills.some(s=>s.room==='HIRE'));office.skills.push({room:'HIRE',kind:'unreviewedFutureEffect',prod:1});assert.equal(officeUpperBound(model,[],0),null);
});
test('facility tables preserve distinct users and unlock states and lazily reuse only identical profiles',()=>{
 const model=buildModel(catalog,cleanInput(demo,catalog)),task=model.tasks.find(t=>t.type==='MANUFACTURE'),table=new FacilityCandidates(task,model);
 assert.equal(table.records.size,0);const unrank=(ids,cap,rank)=>rank===0n?[]:[ids[0]];
 table.get(1n,unrank);table.get(1n,()=>{throw Error('should be cached');});assert.equal(table.hits,1);assert.equal(table.records.size,1);
 const key=candidateTableKey(task,model);const changed={...task,candidates:task.candidates.slice(1)};assert.notEqual(key,candidateTableKey(changed,model));
 model.byId[task.candidates[0]].skills=[];assert.notEqual(key,candidateTableKey(task,model));
});
test('quality-trade and constrained meeting optimum is unchanged by the new search',()=>{
 const ref=finish(trade,'exhaustive'),fast=finish(trade,'bounded');assert.equal(compare(ref.best.score,fast.best.score),0);assert.deepEqual(ref.best.at24.trade.range,fast.best.at24.trade.range);
});
