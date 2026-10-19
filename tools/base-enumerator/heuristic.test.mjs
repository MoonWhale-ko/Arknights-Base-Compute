import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cleanInput,buildModel,Enumerator,simulate,score,compare,stable} from './core.mjs';
import {solveHeuristic,shortlist,validSelection,toPlan} from './heuristic.mjs';
import {runHeuristic} from './heuristic-cli.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url)));
const quality=JSON.parse(fs.readFileSync(new URL('./examples/quality-trading.json',import.meta.url)));
const raw=()=>({base:{rooms:{factory:{type:'MANUFACTURE',level:1},dorm:{type:'DORMITORY',level:3,ambience:3000}}},products:{factory:'4'},progress:{char_502_nblade:{owned:true,elite:0,level:30},char_500_noirc:{owned:true,elite:0,level:30}},options:{teams:2,rotation:'12h',maxHours:168,optimizeDormSupport:false}});
function oracle(model){let best=null,n=0;const iterator=new Enumerator({...model,symmetry:false});while(true){const s=iterator.advance();if(s.done)break;if(!s.plan)continue;n++;const result=simulate(model,s.plan),v=score(model,result);if(v&&(!best||compare(v,best)>0))best=v;}return {best,n};}
test('small exact path agrees with independent exhaustive iterator for 2/3 teams and all rotations',()=>{
 for(const teams of [2,3])for(const rotation of ['12h','first','all'])for(const rankingWindow of ['24h','cycle']){
  const r=raw();Object.assign(r.options,{teams,rotation,rankingWindow});const model=buildModel(catalog,cleanInput(r,catalog)),ref=oracle(model),got=solveHeuristic(model,{maxMilliseconds:3000,exactThreshold:100000});
  assert.equal(got.complete,true);assert.equal(got.modelOptimalityProven,true);assert.equal(got.stats.simulations,ref.n);assert.equal(Boolean(got.best),Boolean(ref.best));if(ref.best)assert.equal(compare(got.best.score,ref.best),0);
 }
});
test('forced heuristic recovers the small quality-trade package optimum without claiming proof',()=>{
 const model=buildModel(catalog,cleanInput(quality,catalog)),ref=oracle(model),got=solveHeuristic(model,{maxMilliseconds:3000,exactThreshold:0});
 assert.ok(got.best);assert.equal(compare(got.best.score,ref.best),0);assert.equal(got.complete,false);assert.equal(got.modelOptimalityProven,false);assert.equal(got.stats.evaluationErrors,0);
 assert.deepEqual(score(model,simulate(model,got.best.plan)),got.best.score);assert.ok(got.stats.simulations<ref.n);
});
test('candidate shortlist keeps weak conversion/quality anchors outside top ordinary candidates',()=>{
 const model=buildModel(catalog,cleanInput(quality,catalog)),task=model.tasks.find(t=>t.type==='TRADING');
 const ids=shortlist(model,task,1);assert.ok(ids.includes('char_252_bibeak'));assert.ok(ids.includes('char_254_vodfox'));assert.ok(ids.includes('char_486_takila'));
});
test('strict identity conflicts and fixed residents/supports survive conversion to final plans',()=>{
 const r=raw();r.base.rooms.office={type:'HIRE',level:1};r.progress.char_503_rang={owned:true,elite:0,level:30};r.progress.char_285_medic2={owned:true,elite:0,level:30};r.dormSupport={dorm:['char_285_medic2']};
 const model=buildModel(catalog,cleanInput(r,catalog)),empty=model.tasks.map(()=>[]),taskIndexes=model.tasks.map((t,i)=>t.type==='MANUFACTURE'?i:-1).filter(i=>i>=0);
 const dup=empty.map(ids=>[...ids]);for(const i of taskIndexes)dup[i]=['char_502_nblade'];assert.equal(validSelection(model,dup),false);
 const one=empty.map(ids=>[...ids]);one[taskIndexes[0]]=['char_502_nblade'];assert.equal(validSelection(model,one),true);
 const got=solveHeuristic(model,{maxMilliseconds:1000,exactThreshold:0});assert.ok(got.best);assert.deepEqual(got.best.plan.dormSupport,undefined);assert.equal(got.stats.evaluationErrors,0);
 const plan=toPlan(model,one);assert.equal(simulate(model,plan).status,'ok');
 // Two different forms with equal identity must also conflict.
 const other=model.tasks[taskIndexes[1]];other.candidates.push('char_500_noirc');model.byId.char_500_noirc.identity=model.byId.char_502_nblade.identity??'char_502_nblade';
 const forms=one.map(ids=>[...ids]);forms[taskIndexes[1]]=['char_500_noirc'];assert.equal(validSelection(model,forms),false);
});
test('missing clue policy permits only one provider plus speed, even in seeded construction',()=>{
 const r=structuredClone(quality);r.options.teams=3;r.options.maxHours=168;
 const model=buildModel(catalog,cleanInput(r,catalog)),got=solveHeuristic(model,{maxMilliseconds:1000,exactThreshold:0});
 assert.ok(got.best);for(const g of got.best.plan.groups.filter(g=>g.room==='meeting'))assert.ok(g.operators.length<=1);
 assert.equal(simulate(model,got.best.plan).status,'ok');
});
test('automatic dorm support stays disjoint from all work shifts and preserves fixed supporters',()=>{
 const r=structuredClone(quality);r.options.optimizeDormSupport=true;r.progress.char_500_noirc={owned:true,elite:0,level:30};r.progress.char_285_medic2={owned:true,elite:0,level:30};r.dormSupport={dorm:['char_285_medic2']};
 const model=buildModel(catalog,cleanInput(r,catalog)),got=solveHeuristic(model,{maxMilliseconds:2000,exactThreshold:0});
 assert.ok(got.best);assert.ok(got.best.plan.dormSupport.dorm.includes('char_285_medic2'));
 const ids=got.best.plan.groups.flatMap(g=>g.operators);for(const id of got.best.plan.dormSupport.dorm)assert.ok(!ids.includes(id));assert.equal(simulate(model,got.best.plan).status,'ok');
});
test('deterministic non-time-limited starts preserve model input and score',()=>{
 const model=buildModel(catalog,cleanInput(quality,catalog)),before=stable(model.input),options={maxMilliseconds:3000,maxEvaluations:10000,exactThreshold:0,starts:2,rounds:2};
 const a=solveHeuristic(model,options),b=solveHeuristic(model,options);assert.equal(a.stopReason,'heuristic-finished');assert.deepEqual(a.best.plan,b.best.plan);assert.deepEqual(a.best.score,b.best.score);assert.equal(stable(model.input),before);
});
test('budgets and unsafe universal inputs are explicit; no fake optimality from truncated search',()=>{
 const model=buildModel(catalog,cleanInput(quality,catalog)),got=solveHeuristic(model,{maxMilliseconds:1000,maxEvaluations:1,exactThreshold:0});
 assert.equal(got.stats.simulations,1);assert.equal(got.stopReason,'evaluation-budget');assert.equal(got.modelOptimalityProven,false);
 const limited=solveHeuristic(model,{maxMilliseconds:1,exactThreshold:0});assert.equal(limited.modelOptimalityProven,false);assert.ok(limited.elapsedMs<500);
 const all=structuredClone(quality);all.options.development='all-operators';all.candidates={};assert.throws(()=>runHeuristic(catalog,all),/현재 보유/);
 assert.throws(()=>runHeuristic(catalog,{...quality,layoutSearch:{}}),/기지 구성 하나/);
 for(const options of [{starts:0},{maxMilliseconds:NaN},{maxEvaluations:0},{exactThreshold:-1}])assert.throws(()=>solveHeuristic(model,options),/범위 오류/);
});
test('24h-ranked three-shift construction also staffs the later third crew when operators remain',()=>{
 const r=raw();r.progress.char_381_bubble={owned:true,elite:1,level:1};r.options.teams=3;
 const model=buildModel(catalog,cleanInput(r,catalog)),got=solveHeuristic(model,{maxMilliseconds:1000,exactThreshold:0,starts:1,rounds:0});
 assert.ok(got.best);assert.equal(got.best.plan.groups.find(g=>g.team===2&&g.room==='factory').operators.length,1);assert.equal(got.best.cycle.hour,36);
});
