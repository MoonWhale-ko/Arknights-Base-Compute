import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import vm from 'node:vm';
import {Run} from './runner.mjs';
import {cleanInput,buildModel,Enumerator,simulate,subsetCount,subsetAt,developmentStates,scenarioCount,scenarioAt,score,snapshot} from './core.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),demo=JSON.parse(fs.readFileSync(new URL('./demo.json',import.meta.url)));
// Keep the original full-search fixtures as an independent regression oracle.
demo.options.searchStrategy='exhaustive';
const make=(x=structuredClone(demo))=>{const input=cleanInput(x,data);return buildModel(data,input);};
function plan(m,factory=['char_500_noirc','char_502_nblade'],office=['char_503_rang',null]){return {groups:m.work.flatMap(r=>[]).concat(Array.from({length:m.input.options.teams},(_,team)=>m.work.map(r=>({team,room:r.id,operators:[r.type==='HIRE'?office[team]:r.type==='MANUFACTURE'?factory[team]:null].filter(Boolean)}))).flat())};}
test('combination unranking is complete and has no duplicate subsets',()=>{assert.equal(subsetCount(4,2),11n);const a=Array.from({length:11},(_,i)=>subsetAt(['a','b','c','d'],2,BigInt(i)));assert.equal(new Set(a.map(JSON.stringify)).size,11);assert.deepEqual(a.at(-1),['c','d']);assert.throws(()=>subsetAt(['a'],1,2n));});
test('exact DFS handles intersecting candidate pools, empty seats and resume',()=>{
 const model={tasks:[{team:0,room:'f',capacity:1,candidates:['a','b'],fixed:[]},{team:1,room:'f',capacity:1,candidates:['a','b'],fixed:[]}]};
 let e=new Enumerator(model),plans=[],x;while(!(x=e.advance(1)).done){if(x.plan)plans.push(x.plan);if(plans.length===3){e=new Enumerator(model,e.snapshot());}}
 assert.equal(plans.length,7);assert.equal(new Set(plans.map(JSON.stringify)).size,7);assert.equal(e.upperBound(),9n);
});
test('first 24h and first two-shift cycle agree at 24h; output conserves production',()=>{
 const m=make(),r=simulate(m,plan(m),{record:true});assert.equal(r.status,'ok');assert.equal(r.at24.hour,24);assert.equal(r.cycle.hour,24);assert.equal(r.at24.completedShifts,2);assert.ok(r.at24.produced.F_GOLD>0);assert.ok(Math.abs(r.at24.produced.F_GOLD-r.at24.collected.F_GOLD-r.at24.pending.F_GOLD)<1e-8);assert.equal(r.cycle.completedShifts,2);
});
test('three shifts finish at 36 hours and 24h values are not extrapolated',()=>{
 const input=structuredClone(demo);input.options.teams=3;const m=make(input),p=plan(m,['char_500_noirc','char_502_nblade',null],['char_503_rang',null,null]),r=simulate(m,p);assert.equal(r.status,'ok');assert.equal(r.at24.hour,24);assert.equal(r.cycle.hour,36);assert.ok(r.cycle.officeEquivalentHours>r.at24.officeEquivalentHours);
});
test('level-30 skill remains locked at level 29 and unlocks exactly at 30',()=>{
 const input=structuredClone(demo);input.progress.char_502_nblade.level=29;let m=make(input);assert.ok(!m.tasks.find(t=>t.room==='factory').candidates.includes('char_502_nblade'));assert.ok(m.ledger.find(x=>x.id==='char_502_nblade').locked.some(s=>s.id==='manu_prod_spd[000]'));
 input.progress.char_502_nblade.level=30;m=make(input);assert.ok(m.tasks.find(t=>t.room==='factory').candidates.includes('char_502_nblade'));
});
test('development scenarios enumerate unique skill sets without confusing actual state',()=>{
 const input=cleanInput(demo,data);input.options.development='all-unlock-states';const groups=developmentStates(data,input),count=scenarioCount(groups);assert.ok(count>1n);assert.equal(input.progress.char_502_nblade.level,30);assert.ok(scenarioAt(groups,0n).char_502_nblade.level<30);assert.equal(scenarioCount(developmentStates(data,cleanInput(demo,data))),1n);
});
test('simple factory has independently derived batch count and unfinished progress',()=>{
 const input=structuredClone(demo);delete input.base.rooms.office;const m=make(input),p=plan(m),r=simulate(m,p); // Noir: 10% +1% staffing; Yato: 15% +1% staffing.
 assert.equal(r.at24.produced.F_GOLD,22);assert.ok(Math.abs(r.at24.inventory.factory.progress-3024)<1e-5);
});
test('no dorm means fatigue persists; fixed 12h does not reset morale',()=>{
 const input=structuredClone(demo);delete input.base.rooms.dorm;const m=make(input),r=simulate(m,plan(m));assert.ok(Math.abs(r.at24.morale.char_500_noirc-12)<1e-8);assert.ok(Math.abs(r.at24.morale.char_502_nblade-12)<1e-8);
});
test('zero consumption cycle is unresolved; no fabricated 12h first depletion',()=>{
 const input=structuredClone(demo);input.options.rotation='first';const m=make(input);const p={groups:Array.from({length:2},(_,team)=>m.work.map(r=>({team,room:r.id,operators:[]}))).flat()};const r=simulate(m,p);assert.equal(r.at24.hour,24);assert.equal(r.cycle,null);assert.match(r.reason,/소진 교대/);
});
test('different shifts may not share normal operators; support cannot also work',()=>{const m=make();assert.throws(()=>simulate(m,plan(m,['char_502_nblade','char_502_nblade'])),/중복/);});
test('input rejects invalid recipe, levels and ambience and strips account fields',()=>{
 for(const mutate of [x=>x.base.rooms.dorm.ambience=6000,x=>x.progress.char_502_nblade.elite=2,x=>x.products.factory='bad']){const x=structuredClone(demo);mutate(x);assert.throws(()=>make(x));}
 const raw={...demo,email:'private',uid:'secret'};assert.ok(!JSON.stringify(cleanInput(raw,data)).includes('private'));
});
test('office contact work integrates active and fatigued staffing rather than counting only seed scores',()=>{
 const input=structuredClone(demo);delete input.base.rooms.dorm;input.options.rotation='all';const m=make(input),r=simulate(m,plan(m));assert.ok(r.at24.officeEquivalentHours>=24);assert.ok(r.at24.officeEquivalentHours>r.cycle?.officeEquivalentHours||r.cycle?.hour>=24||!r.cycle);assert.equal(score(m,r).length,6);
});
test('unsupported skill holders are explicitly reported and excluded from that working facility',()=>{
 const x=structuredClone(demo);x.progress.char_243_waaifu={owned:true,elite:2,level:1};const m=make(x);assert.ok(m.excluded.some(x=>x.id==='char_243_waaifu'));assert.ok(!m.tasks.find(t=>t.room==='factory').candidates.includes('char_243_waaifu'));
});
test('runner resumes and emits only one completed best record per condition',()=>{
 let run=new Run(data,demo),rows=[];run.describe();
 for(let i=0;run.examined<5n&&i<1000;i++)run.next();assert.equal(run.examined,5n);
 run=new Run(data,demo,JSON.parse(JSON.stringify(run.checkpoint())));run.describe();
 for(let i=0;!run.done&&i<10000;i++){const step=run.next();if(step.row)rows.push(step.row);}
 assert.equal(run.done,true);assert.equal(rows.length,1);assert.equal(rows[0].type,'condition-result');assert.equal(rows[0].searchComplete,true);assert.equal(String(run.valid),'21');
 const changed=structuredClone(demo);changed.options.teams=3;assert.throws(()=>new Run(data,changed,run.checkpoint()),/이어서/);
});
test('automatic whole-catalog scenarios cover absent and all unlock states without an owned list',()=>{
 const raw=structuredClone(demo);raw.progress={};raw.options.development='all-operators';
 const input=cleanInput(raw,data),groups=developmentStates(data,input);
 assert.equal(groups.length,Object.keys(data.characters).length);
 assert.ok(groups.every(g=>g.states[0]===null));assert.deepEqual(scenarioAt(groups,0n),{});
 assert.equal(scenarioCount(groups),groups.reduce((n,g)=>n*BigInt(g.states.length),1n));
 raw.options.ownedMin=10;raw.options.ownedMax=10;
 const ten=developmentStates(data,cleanInput(raw,data)),total=scenarioCount(ten);
 for(const rank of [0n,1n,total/2n,total-1n])assert.equal(Object.keys(scenarioAt(ten,rank)).length,10);
});
test('ownership-count unranking agrees with exhaustive tiny reference and includes locked states',()=>{
 const groups=[{id:'a',states:[null,{elite:0,level:1},{elite:1,level:1}]},{id:'b',states:[null,{elite:0,level:1}]},{id:'c',states:[null,{elite:0,level:1}]}];groups.ownedRange=[1,2];
 const reference=[];for(const a of groups[0].states)for(const b of groups[1].states)for(const c of groups[2].states){const x=Object.fromEntries([['a',a],['b',b],['c',c]].filter(([,v])=>v));if(Object.keys(x).length>=1&&Object.keys(x).length<=2)reference.push(JSON.stringify(x));}
 const actual=Array.from({length:Number(scenarioCount(groups))},(_,i)=>JSON.stringify(scenarioAt(groups,BigInt(i))));
 assert.deepEqual(new Set(actual),new Set(reference));assert.equal(actual.length,reference.length);
});
test('cycle ending exactly at the safety cap is recorded as complete',()=>{
 const x=structuredClone(demo);x.options.teams=3;x.options.maxHours=36;
 const m=make(x),r=simulate(m,plan(m,['char_500_noirc','char_502_nblade',null],['char_503_rang',null,null]));
 assert.equal(r.cycle.hour,36);assert.equal(r.cycle.completedShifts,3);assert.equal(r.at24.hour,24);
});
test('bundled standalone worker compiles and runs the same 21 demo cases',async()=>{
 const page=fs.readFileSync(new URL('./standalone.html',import.meta.url),'utf8');
 const raw=page.match(/const WORKER_SOURCE=(.*);\n/)[1];const source=JSON.parse(raw).replaceAll('<\\/script','</script');
 const messages=[],timers=[];const sandbox={structuredClone,performance,console,setTimeout:fn=>timers.push(fn),self:{postMessage:message=>messages.push(message)}};
 vm.createContext(sandbox);new vm.Script(source).runInContext(sandbox);
 await sandbox.self.onmessage({data:{type:'start',input:structuredClone(demo)}});
 let cases=0,complete=false,lastProgress=null;
 for(let n=0;n<1000&&!complete;n++){
  const batch=messages.splice(0);for(const m of batch){assert.notEqual(m.type,'error',m.message);if(m.type==='batch'){assert.ok(m.rows.every(r=>r.type!=='case'));cases+=m.rows.filter(r=>r.type==='condition-result').length;lastProgress=m.progress;await sandbox.self.onmessage({data:{type:'ack'}});}if(m.type==='stopped')complete=m.complete;}
  const pending=timers.splice(0);for(const fn of pending)fn();
 }
 assert.equal(complete,true);assert.equal(cases,1);assert.equal(lastProgress.examined,'21');
});
