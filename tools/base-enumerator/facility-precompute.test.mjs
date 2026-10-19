import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {localProfiles,localCombinations,compileLocal,evaluateLocal,localRecords,readLocalRecords,matchingLocalProfiles,selectLocalCandidates,joinLocalCandidates,solveLocalCatalog} from './facility-precompute.mjs';
import {factoryProfiles,factoryRecords,readFactoryRecords} from './factory-precompute.mjs';
import {writeExpansion,preservationHashes} from './facility-precompute-cli.mjs';
import {rule,unlock,group} from './rules.mjs';
import {cleanInput,buildModel,Enumerator,simulate,score,compare,snapshot,meetingTeamAllowed} from './core.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),base=path.dirname(new URL(import.meta.url).pathname);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`),key=ids=>[...ids].sort().join('|');
const tiny=['char_503_rang','char_283_midn','char_497_ctable','char_285_medic2'];
const tableFor=(room,ids)=>readLocalRecords(localRecords(localProfiles(catalog,room,{operatorIds:ids})),{fingerprint:catalog.fingerprint});
const actualOp=(header,i)=>{const p=header.profiles[i],state=p.states[0],rules=Object.fromEntries(Object.values(catalog.buffs).map(b=>[b.id,rule(b)]));return {...catalog.characters[p.operator],...state,skills:unlock(catalog.characters[p.operator],state,rules)};};

test('meeting profiles retain elite passive differences and local states never duplicate identities',()=>{
 const h=localProfiles(catalog,'MEETING');let pair;
 for(const a of h.profiles)for(const b of h.profiles)if(a.operator===b.operator&&a.elite!==b.elite&&key(a.skills)===key(b.skills))pair=[a,b];
 assert.ok(pair);for(const p of pair){const found=matchingLocalProfiles(h,catalog,{[p.operator]:p.states[0]}).available;assert.equal(found.size,1);assert.ok([...found].every(i=>h.profiles[i].elite===p.elite));}
 for(const room of ['TRADING','POWER','HIRE','MEETING']){
  const header=localProfiles(catalog,room);for(const indices of localCombinations(header))assert.equal(new Set(indices.map(i=>header.profiles[i].identity)).size,indices.length);
 }
 for(const room of ['CONTROL','DORMITORY'])assert.throws(()=>[...localCombinations(localProfiles(catalog,room))],/must not/);
});

test('tiny owned-state candidates match independent subsets and existing meeting/trade validity checks',()=>{
 for(const room of ['TRADING','POWER','HIRE','MEETING']){
  const h=localProfiles(catalog,room),ids=[...new Set([...h.profiles.slice(0,4),...h.excluded.slice(0,1)].map(p=>p.operator))],table=tableFor(room,ids);
  for(let mask=0;mask<1<<ids.length;mask++)for(const high of [false,true])for(const level of [1,2,3])for(const exchange of [false,true]){
   const progress=Object.fromEntries(ids.filter((id,i)=>mask&1<<i).map(id=>[id,{owned:true,elite:high?catalog.characters[id].maxLevels.length-1:0,level:1}]));
   const raw={base:{rooms:{work:{type:room,level}}},progress,options:{development:'all-operators',teams:2,rotation:'12h',clueExchangeActive:exchange,missingClues:[1],optimizeDormSupport:false}};
   const model=buildModel(catalog,cleanInput(raw,catalog)),work=model.work[0],pool=model.pool.filter(op=>model.canPlace(op,work)),expected=[];
   for(let bits=0;bits<1<<pool.length;bits++){
    const ops=pool.filter((o,i)=>bits&1<<i);if(ops.length>work.capacity)continue;
    if(room==='MEETING'&&!meetingTeamAllowed(ops,model.input.options))continue;
    try{snapshot(model,[{room:work,ops}],Object.fromEntries(ops.map(o=>[o.id,24])),{});}catch{continue;}
    expected.push(key(ops.map(o=>o.id)));
   }
   const chosen=selectLocalCandidates(table,catalog,progress,{level,clueExchangeActive:exchange,missingClues:[1]});
   assert.deepEqual(chosen.rows.map(r=>key(r.operators)).sort(),expected.sort());
  }
 }
});

test('local effects match legacy snapshots with global controls, elite rooms, exchange and work ramps',()=>{
 for(const room of ['TRADING','POWER','HIRE','MEETING']){
  const header=localProfiles(catalog,room),combinations=[[],...header.profiles.map((p,i)=>[i])];let n=0;
  for(const indices of localCombinations(header))if(indices.length>1&&n++%251===0)combinations.push(indices);
  for(const indices of combinations)for(const level of [1,3])for(const variant of [0,1,2]){
   if(room==='TRADING'&&indices.length>level)continue;
   const ops=indices.map(i=>actualOp(header,i)),exchange=variant===2;
   if(room==='MEETING'&&!meetingTeamAllowed(ops,{clueExchangeActive:exchange}))continue;
   const program=compileLocal(header,indices),work={id:'work',type:room,level},control={id:'cc',type:'CONTROL',level:3};
   const cc=Array.from({length:variant+1},(_,i)=>({id:'cc'+i,groups:[],skills:[{room:'CONTROL',kind:'ccRecovery',amount:.05},...(i===0&&variant?[{room:'CONTROL',kind:'mlynar'},{room:'CONTROL',kind:'hireThreshold'},{room:'CONTROL',kind:'meetingBonus',amount:.1},{room:'CONTROL',kind:'globalMissing'}]:[])]}));
   const eliteRooms=Array.from({length:variant*3},(_,i)=>({room:{id:'elite'+i,type:'PRIVATE',level:1},ops:[{id:'elite-op'+i,groups:['elite'],skills:[]}]}));
   const placements=[{room:work,ops},{room:control,ops:cc},...eliteRooms],rooms=[work,control,...eliteRooms.map(p=>p.room),{id:'dorm',type:'DORMITORY',level:5,ambience:variant*2000}];
   const workedHours=Object.fromEntries(ops.map((op,i)=>[op.id,variant*6+i+.25])),pool=placements.flatMap(p=>p.ops),morale=Object.fromEntries(pool.map(o=>[o.id,24]));
   const context={level,controlCount:cc.length,mlynar:variant>0,exportRecovery:variant?cc.length*.05:0,hireThreshold:variant>0,dormLevelSum:5,eliteRoomCount:placements.filter(p=>p.ops.some(o=>group(o,'elite'))).length,ambienceTotal:variant*2000,meetingBonus:variant?.1:0,globalMissing:variant>0,clueExchangeActive:exchange,missingClues:[1,3],workedHours};
   const model={catalog,pool,rooms,input:{options:{clueExchangeActive:exchange,missingClues:[1,3]}}};
   if(room==='TRADING'&&program.levels[level-1].unsupported){assert.throws(()=>snapshot(model,placements,morale,workedHours));assert.throws(()=>evaluateLocal(header,indices,program,context));continue;}
   const reference=snapshot(model,placements,morale,workedHours),actual=evaluateLocal(header,indices,program,context);
   for(const op of ops)close(actual.rates[op.id],reference.rates[op.id]);
   if(room==='HIRE')close(actual.multiplier,reference.offices[0].multiplier);
   if(room==='MEETING'){close(actual.multiplier,reference.meetings[0].multiplier);assert.equal(actual.preference,reference.meetings[0].preference);}
   if(room==='TRADING'){close(actual.multiplier,reference.trading[0].multiplier);assert.equal(actual.capacity,reference.trading[0].capacity);assert.deepEqual(actual.order,reference.trading[0].order);assert.deepEqual(actual.baselineOrder,reference.trading[0].baselineOrder);}
   if(room==='POWER')close(actual.droneRecoveryBonus,ops.flatMap(o=>o.skills.filter(s=>s.room==='POWER')).reduce((n,s)=>n+s.prod,0));
  }
 }
});

test('quality uncertainty and clue specialist policies remain explicit',()=>{
 const trading=tableFor('TRADING',['char_252_bibeak','char_254_vodfox','char_486_takila']),progress=Object.fromEntries(['char_252_bibeak','char_254_vodfox','char_486_takila'].map(id=>[id,{owned:true,elite:2,level:1}]));
 const low=selectLocalCandidates(trading,catalog,progress,{level:1});assert.ok(low.rejected.some(r=>r.reason.includes('3레벨')));
 const high=selectLocalCandidates(trading,catalog,progress,{level:3});assert.ok(high.rows.some(r=>r.operators.length===3));
 const meeting=tableFor('MEETING',['char_497_ctable','char_4017_puzzle']),p={char_497_ctable:{owned:true,elite:2,level:1},char_4017_puzzle:{owned:true,elite:2,level:1}};
 const chosen=selectLocalCandidates(meeting,catalog,p,{level:3,missingClues:[1],clueExchangeActive:true});assert.ok(chosen.rejected.some(r=>r.indices.length===2));assert.ok(chosen.rows.some(r=>r.operators.length===1&&r.value.preference===1));
 const noMissing=selectLocalCandidates(meeting,catalog,p,{level:3,missingClues:[]});assert.ok(noMissing.rows.every(r=>r.value.preference===0));
});

test('composing current-user tables preserves exhaustive multi-room 2/3-shift scores',()=>{
 const progress={char_503_rang:{owned:true,elite:0,level:30},char_283_midn:{owned:true,elite:0,level:30},char_497_ctable:{owned:true,elite:2,level:1},char_285_medic2:{owned:true,elite:0,level:30}};
 const tables=Object.fromEntries(['TRADING','POWER','HIRE','MEETING'].map(room=>[room,tableFor(room,tiny)]));
 for(const teams of [2,3])for(const rotation of ['12h','first','all']){
  const raw={base:{rooms:{trading:{type:'TRADING',level:1},power:{type:'POWER',level:1},office:{type:'HIRE',level:1},meeting:{type:'MEETING',level:1},dorm:{type:'DORMITORY',level:5,ambience:5000}}},progress,options:{teams,rotation,maxHours:168,missingClues:[1],optimizeDormSupport:false,searchStrategy:'exhaustive'}};
  const model=buildModel(catalog,cleanInput(raw,catalog)),reference=new Enumerator(model);let refCount=0,best=null;
  for(;;){const step=reference.advance();if(step.done)break;if(!step.plan)continue;refCount++;const value=score(model,simulate(model,step.plan));if(value&&(!best||compare(value,best)>0))best=value;}
  const lists=model.tasks.map(task=>selectLocalCandidates(tables[task.type],catalog,progress,{level:task.level,missingClues:[1]}).rows),stats={};let actualBest=null;
  for(const choices of joinLocalCandidates(lists,{maxPlans:100000,maxMilliseconds:30000,stats})){
   const plan={groups:model.tasks.map((t,i)=>({room:t.room,team:t.team,operators:choices[i].operators}))};
   const value=score(model,simulate(model,plan));if(value&&(!actualBest||compare(value,actualBest)>0))actualBest=value;
  }
  assert.equal(stats.complete,true);assert.equal(stats.plans,refCount);assert.ok(best&&actualBest);assert.equal(compare(best,actualBest),0);
 }
});

test('join budgets are reported honestly and alternate identity reuse is blocked',()=>{
 const empty={operators:[],identities:[]},a={operators:['a'],identities:['same']},b={operators:['alternate-a'],identities:['same']};
 const stats={},all=[...joinLocalCandidates([[empty,a],[empty,b]],{maxPlans:10,maxMilliseconds:1000,stats})];assert.equal(all.length,3);assert.equal(stats.complete,true);assert.equal(stats.conflicts,1);
 const cut={};assert.equal([...joinLocalCandidates([[empty,a],[empty,b]],{maxPlans:1,maxMilliseconds:1000,stats:cut})].length,1);assert.equal(cut.complete,false);assert.equal(cut.reason,'plans');
 const exact={};assert.equal([...joinLocalCandidates([[empty,a],[empty,b]],{maxPlans:3,maxMilliseconds:1000,stats:exact})].length,3);assert.equal(exact.complete,true);
});

test('factory plus four-room catalog search reuses old data, lazy controls and fixed/automatic dorm support',()=>{
 const raw=JSON.parse(fs.readFileSync(new URL('./demo.json',import.meta.url)));
 const cc=localProfiles(catalog,'CONTROL').profiles.find(p=>p.skills.some(id=>rule(catalog.buffs[id]).kind==='ccRecovery'));
 raw.progress[cc.operator]=cc.states[0];raw.progress.char_285_medic2={owned:true,elite:0,level:30};
 const ids=Object.keys(raw.progress),tables=Object.fromEntries(['TRADING','POWER','HIRE','MEETING'].map(room=>[room,tableFor(room,ids)]));
 tables.MANUFACTURE=readFactoryRecords(factoryRecords(factoryProfiles(catalog,{operatorIds:ids})),{fingerprint:catalog.fingerprint});
 for(const auto of [false,true]){
  const input=structuredClone(raw);input.options.optimizeDormSupport=auto;if(!auto)input.dormSupport={dorm:['char_285_medic2']};input.options.searchStrategy='exhaustive';
  const model=buildModel(catalog,cleanInput(input,catalog)),e=new Enumerator(model);let best=null,count=0;
  for(;;){const step=e.advance();if(step.done)break;if(!step.plan)continue;count++;const value=score(model,simulate(model,step.plan));if(value&&(!best||compare(value,best)>0))best=value;}
  const actual=solveLocalCatalog(model,tables,{maxPlans:100000,maxMilliseconds:30000});assert.equal(actual.complete,true);assert.equal(actual.errors,0);assert.equal(actual.stats.plans,count);assert.ok(actual.best&&best);assert.equal(compare(actual.best.score,best),0);
 }
 const invalid=buildModel(catalog,cleanInput({...raw,options:{...raw.options,development:'all-operators'}},catalog));assert.throws(()=>solveLocalCatalog(invalid,tables),/actual owned roster/);
 const model=buildModel(catalog,cleanInput(raw,catalog)),cut=solveLocalCatalog(model,tables,{maxPlans:1,maxMilliseconds:1000});assert.equal(cut.complete,false);assert.equal(cut.modelOptimalityProven,false);
});

test('threshold arithmetic, explicit fatigue fallback and stale catalogs are guarded',()=>{
 const header={room:'HIRE',maxSeats:1,profiles:[{operator:'a',identity:'a',skills:[]}],constants:{hireBasicSpeedBuff:.05,workerCost:[]}},program={prod:.2,drains:[0],roomDrain:0};
 close(evaluateLocal(header,[0],program,{level:1,hireThreshold:true}).multiplier,1.45);program.prod=.25;close(evaluateLocal(header,[0],program,{level:1,hireThreshold:true}).multiplier,1.3);
 assert.throws(()=>evaluateLocal(header,[0],program,{activeIds:[]}),/Fatigued/);
 const records=[...localRecords(localProfiles(catalog,'HIRE',{operatorIds:tiny}))];assert.throws(()=>readLocalRecords(records.slice(0,-1)),/Incomplete/);assert.throws(()=>readLocalRecords(records,{fingerprint:'changed'}),/Stale/);assert.throws(()=>readLocalRecords([...records,{}]),/after end/);
});

test('new compressed outputs round-trip and preserve every previous factory artifact',async()=>{
 const before=preservationHashes(base),directory=fs.mkdtempSync(path.join(os.tmpdir(),'local-catalog-expansion-'));
 try{
  const report=await writeExpansion(catalog,directory,{operatorIds:tiny,preserveDirectory:base});assert.equal(report.previousFactoryFiles.preserved,true);assert.equal(report.facilities.length,4);assert.equal(report.contextProfiles.rooms.length,2);
  for(const f of report.facilities){const data=gunzipSync(fs.readFileSync(path.join(directory,f.file))).toString(),table=readLocalRecords(data.trim().split('\n').map(JSON.parse),{fingerprint:catalog.fingerprint});assert.equal(Buffer.byteLength(data),f.rawBytes);assert.equal(table.rows.length,f.combinations);}
  const context=gunzipSync(fs.readFileSync(path.join(directory,report.contextProfiles.file))).toString().trim().split('\n').map(JSON.parse);assert.ok(context.every(h=>h.mode==='profiles-only'));
  await assert.rejects(()=>writeExpansion(catalog,directory,{operatorIds:tiny}),/already exists/);assert.deepEqual(preservationHashes(base),before);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
