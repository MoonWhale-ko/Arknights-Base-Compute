import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {factoryProfiles,compileFactory,evaluateFactory,profileCombinations,factoryRecords,readFactoryRecords,matchingFactoryProfiles,factoryCandidates} from './factory-precompute.mjs';
import {writeFactoryCatalog,probeFactoryCatalog} from './factory-precompute-cli.mjs';
import {rule,unlock} from './rules.mjs';
import {cleanInput,buildModel,Enumerator,simulate,score,compare,snapshot} from './core.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url)));
const tiny=['char_123_fang','char_124_kroos','char_284_spot','char_237_gravel','char_190_clour'];
const raw=progress=>({base:{rooms:{control:{type:'CONTROL',level:1},power:{type:'POWER',level:3},factory:{type:'MANUFACTURE',level:3},dorm:{type:'DORMITORY',level:5,ambience:5000}}},progress,products:{factory:'4'},options:{development:'all-operators',teams:2,rotation:'12h',maxHours:24,optimizeDormSupport:false,searchStrategy:'exhaustive'}});
const tableFor=ids=>readFactoryRecords(factoryRecords(factoryProfiles(catalog,{operatorIds:ids})),{fingerprint:catalog.fingerprint});
const key=ids=>[...ids].sort().join('|');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('factory catalog covers every tiny owned/unlock case without enumerating the whole owned-state product',()=>{
 const ids=[...tiny,'char_286_cast3','char_243_waaifu'],table=tableFor(ids);
 for(let mask=0;mask<1<<ids.length;mask++)for(const high of [false,true]){
  const progress=Object.fromEntries(ids.filter((id,i)=>mask&1<<i).map(id=>[id,{owned:true,elite:high?(catalog.characters[id].maxLevels.length-1):0,level:id==='char_286_cast3'?(high?30:29):1}]));
  for(const level of [1,2,3]){
   const r=raw(progress);r.base.rooms.factory.level=level;
   const model=buildModel(catalog,cleanInput(r,catalog)),candidates=model.pool.filter(o=>model.canPlace(o,model.work.find(r=>r.id==='factory'))).map(o=>o.id),reference=[];
   for(let subset=0;subset<1<<candidates.length;subset++){
    const selected=candidates.filter((id,i)=>subset&1<<i);if(selected.length<=level)reference.push(key(selected));
   }
   const actual=[...factoryCandidates(table,catalog,progress,{level,recipeId:'4'})].map(x=>key(x.operators));
   assert.deepEqual(actual.sort(),reference.sort());assert.equal(new Set(actual).size,actual.length);
  }
 }
 const castle={char_286_cast3:{owned:true,elite:0,level:29}};assert.equal(matchingFactoryProfiles(table.header,catalog,castle).available.size,0);
 castle.char_286_cast3.level=30;assert.equal(matchingFactoryProfiles(table.header,catalog,castle).available.size,1);
 const unsupported=matchingFactoryProfiles(table.header,catalog,{char_243_waaifu:{owned:true,elite:2,level:1}});assert.equal(unsupported.available.size,0);assert.equal(unsupported.excluded.length,1);
});

test('different local states and identities never coexist; empty, solo and partial staffing survive',()=>{
 const header=factoryProfiles(catalog),counts=[0,0,0,0];
 for(const indices of profileCombinations(header)){
  counts[indices.length]++;assert.equal(new Set(indices.map(i=>header.profiles[i].identity)).size,indices.length);
 }
 assert.equal(counts[0],1);assert.equal(counts[1],header.profiles.length);assert.ok(counts[2]>0&&counts[3]>0);
 assert.throws(()=>compileFactory(header,[0,0]),/Invalid/);
 assert.equal(new Set(header.profiles.map(p=>p.operator)).size,75);
});

test('compiled local expressions match the existing evaluator across all skill kinds and external contexts',()=>{
 const header=factoryProfiles(catalog),buffs=Object.fromEntries(Object.values(catalog.buffs).map(b=>[b.id,rule(b)]));
 const selected=[[],...header.profiles.map((p,i)=>[i])];let n=0;
 for(const indices of profileCombinations(header)){if(indices.length===3&&n++%1301===0)selected.push(indices);}
 for(const indices of selected)for(const variant of [0,1,2])for(const recipeId of ['4','3','13']){
  const ops=indices.map(i=>{const p=header.profiles[i],state=p.states[0];return {...catalog.characters[p.operator],...state,skills:unlock(catalog.characters[p.operator],state,buffs)};});
  const cc=Array.from({length:variant+1},(_,i)=>({id:'fake-cc-'+i,skills:[{room:'CONTROL',kind:'ccRecovery',amount:.05},...(i===0&&variant?[{room:'CONTROL',kind:'ccProd',amount:.02},{room:'CONTROL',kind:'mlynar'}]:[])]}));
  const context={level:3,recipeId,powerCount:variant+1,tradingCount:variant*2,dormLevelSum:variant*10,trainingLevel:variant?3:0,controlCount:cc.length,controlProduction:variant?.02:0,exportRecovery:variant?cc.length*.05:0,workedHours:Object.fromEntries(ops.map((o,i)=>[o.id,variant*6+i+.25]))};
  const room={id:'factory',type:'MANUFACTURE',level:3,recipe:catalog.recipes[recipeId]},control={id:'control',type:'CONTROL',level:cc.length};
  const rooms=[room,control,...Array.from({length:context.powerCount},(_,i)=>({id:'p'+i,type:'POWER',level:3})),...Array.from({length:context.tradingCount},(_,i)=>({id:'t'+i,type:'TRADING',level:3})),...Array.from({length:variant*2},(_,i)=>({id:'d'+i,type:'DORMITORY',level:5})),{id:'train',type:'TRAINING',level:context.trainingLevel}];
  const model={catalog,pool:[...ops,...cc],rooms,input:{options:{}}},placements=[{room:control,ops:cc},{room,ops}],morale=Object.fromEntries([...ops,...cc].map(o=>[o.id,24]));
  const reference=snapshot(model,placements,morale,context.workedHours),actual=evaluateFactory(header,indices,compileFactory(header,indices),context);
  near(actual.multiplier,reference.factories[0].multiplier);near(actual.capacity,reference.factories[0].capacity);
  for(const op of ops)near(actual.rates[op.id],reference.rates[op.id]);
 }
});

test('independent warehouse conversion arithmetic and product restrictions',()=>{
 const header={profiles:[{operator:'a',identity:'a',skills:['a']},{operator:'b',identity:'b',skills:['b']},{operator:'c',identity:'c',skills:['c']}],definitions:{a:{kind:'simple',prod:0,cap:18},b:{kind:'bubble'},c:{kind:'simple',prod:0,cap:10}},categories:['F_GOLD','F_EXP','F_DIAMOND'],recipes:catalog.recipes,baseCapacity:[24,36,54],workerCost:catalog.workerCost};
 const value=evaluateFactory(header,[0,1,2],compileFactory(header,[0,1,2]),{level:3,recipeId:'4'});near(value.multiplier,1.67);near(value.capacity,82);
 header.definitions.b={kind:'vermeil'};near(evaluateFactory(header,[0,1,2],compileFactory(header,[0,1,2]),{level:3,recipeId:'4'}).multiplier,1.59);
 header.definitions.c={kind:'automation',amount:.1};near(evaluateFactory(header,[0,1,2],compileFactory(header,[0,1,2]),{level:3,recipeId:'4',powerCount:3}).multiplier,1.33);
 const real=factoryProfiles(catalog,{operatorIds:['char_286_cast3']});near(evaluateFactory(real,[0],compileFactory(real,[0]),{level:1,recipeId:'1'}).multiplier,1.31);near(evaluateFactory(real,[0],compileFactory(real,[0]),{level:1,recipeId:'4'}).multiplier,1.01);
});

test('catalog-based two-shift plans preserve the exhaustive 24h/cycle optimum',()=>{
 const table=tableFor(tiny),progress=Object.fromEntries(tiny.map(id=>[id,{owned:true,elite:1,level:1}]));
 for(const recipeId of ['4','3']){
  const r=raw(progress);r.options.development='current';r.products.factory=recipeId;const model=buildModel(catalog,cleanInput(r,catalog));
  const enumRef=new Enumerator(model);let reference=null,referencePlan=null,refCount=0;
  for(;;){const step=enumRef.advance();if(step.done)break;if(!step.plan)continue;refCount++;const value=score(model,simulate(model,step.plan));if(value&&(!reference||compare(value,reference)>0)){reference=value;referencePlan=step.plan;}}
  const candidates=[...factoryCandidates(table,catalog,progress,{level:3,recipeId})];let best=null,actualCount=0;
  for(const a of candidates)for(const b of candidates){
   if(a.operators.some(id=>b.operators.includes(id)))continue;
   const plan={groups:model.tasks.map(t=>({team:t.team,room:t.room,operators:t.room==='factory'?(t.team===0?a.operators:b.operators):[]}))};
   actualCount++;const value=score(model,simulate(model,plan));if(value&&(!best||compare(value,best)>0))best=value;
  }
  assert.equal(actualCount,refCount);assert.ok(referencePlan);assert.equal(compare(best,reference),0);
 }
});

test('gzip round-trip is complete, versioned, and rejects stale/truncated catalogs and locked recipes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'factory-local-'));
 try{
  const file=path.join(dir,'catalog.ndjson.gz'),report=await writeFactoryCatalog(catalog,file,{operatorIds:tiny});
  const text=gunzipSync(fs.readFileSync(file)).toString(),records=text.trim().split('\n').map(JSON.parse),table=readFactoryRecords(records,{fingerprint:catalog.fingerprint});
  assert.equal(report.rawBytes,Buffer.byteLength(text));assert.equal(report.combinations,table.rows.length);assert.equal(report.complete,true);
  const probe=probeFactoryCatalog(catalog,file);assert.equal(probe.fullOwnedMaxUnlockProbe.availableProfiles,5);assert.equal(probe.fullOwnedMaxUnlockProbe.candidates,26);
  assert.throws(()=>readFactoryRecords(records.slice(0,-1)),/Incomplete/);assert.throws(()=>readFactoryRecords(records,{fingerprint:'different'}),/Stale/);
  assert.throws(()=>[...factoryCandidates(table,catalog,{}, {level:1,recipeId:'3'})],/not unlocked/);
  assert.doesNotThrow(()=>[...factoryCandidates(table,catalog,{}, {level:1,recipeId:'3',maxFactoryLevel:3})]);
  const indices=[0],program=compileFactory(table.header,indices);assert.throws(()=>evaluateFactory(table.header,indices,program,{level:3,recipeId:'4',activeIds:[]}),/Fatigued/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
