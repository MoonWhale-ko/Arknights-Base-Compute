import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Run} from './runner.mjs';import {LayoutStream,cleanLayoutSearch,validateLayout} from './layouts.mjs';import {conditionKey,matchesResult} from './conditions.mjs';
import {buildModel,cleanInput,Enumerator,simulate,score,compare,stable} from './core.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),demo=JSON.parse(fs.readFileSync(new URL('./demo.json',import.meta.url))),batch=JSON.parse(fs.readFileSync(new URL('./batch-demo.json',import.meta.url)));
function layouts(config,resume=false){let s=new LayoutStream(data,cleanLayoutSearch(config,data)),out=[];for(let n=0;n<1000000;n++){const step=s.advance(7);if(step.done)return out;if(step.value){validateLayout(data,step.value);out.push(step.value);}if(resume&&n%7===0)s=new LayoutStream(data,s.config,JSON.parse(JSON.stringify(s.snapshot())));}throw Error('test iteration budget exceeded');}
function finish(run){const rows=[];for(let n=0;n<1000000&&!run.done;n++){const step=run.next();if(step.row)rows.push(step.row);}assert.equal(run.done,true);return rows;}
test('level-1 facility/product generation has 24 unique power-valid configurations and resumes exactly',()=>{
 const c={controlLevels:[1],recipes:['1','4']},a=layouts(c),b=layouts(c,true);assert.equal(a.length,24);assert.deepEqual(a,b);assert.equal(new Set(a.map(stable)).size,24);
});
test('facility generator matches independently counted level-2 configurations',()=>{assert.equal(layouts({controlLevels:[2],recipes:['1','4']}).length,54);});
test('generator never unlocks a recipe without the required factory and rejects power deficit',()=>{
 for(const x of layouts({controlLevels:[1],recipes:['1','3','4','13']}))assert.ok(Object.values(x.products).every(id=>['1','4'].includes(id)));
 const x=structuredClone(demo);x.base.rooms.power.level=1;x.base.rooms.factory.level=2;x.base.rooms.dorm.level=3;assert.throws(()=>validateLayout(data,x),/전력/);
});
test('same-room symmetry retains every schedule orbit and the exact optimum',()=>{
 const raw=structuredClone(demo);raw.base.rooms.factory2={...raw.base.rooms.factory};raw.products.factory2='4';const m=buildModel(data,cleanInput(raw,data));
 function run(symmetry){m.symmetry=symmetry;const e=new Enumerator(m),keys=new Set();let best=null,count=0;for(let n=0;n<100000;n++){const step=e.advance();if(step.done)break;if(!step.plan)continue;count++;const p=step.plan,rooms=['factory','factory2'].map(room=>p.groups.filter(g=>g.room===room).map(g=>g.operators)).sort((a,b)=>stable(a).localeCompare(stable(b)));keys.add(stable({rooms,other:p.groups.filter(g=>!['factory','factory2'].includes(g.room))}));const v=score(m,simulate(m,p));if(v&&(!best||compare(v,best)>0))best=v;}return {keys,best,count};}
 const brute=run(false),canonical=run(true);assert.deepEqual(canonical.keys,brute.keys);assert.equal(compare(canonical.best,brute.best),0);assert.equal(brute.count,63);assert.equal(canonical.count,33);
});
test('snapshot reuse preserves every candidate result',()=>{
 const m=buildModel(data,cleanInput(demo,data)),e=new Enumerator(m);let count=0;
 for(let n=0;n<1000;n++){const step=e.advance();if(step.done)break;if(!step.plan)continue;delete m.snapshotCache;const plain=simulate(m,step.plan);m.snapshotCache=new Map();const cached=simulate(m,step.plan);const again=simulate(m,step.plan);assert.deepEqual(cached,plain);assert.deepEqual(again,plain);count++;}
 assert.equal(count,21);assert.ok(m.snapshotHits>0);
});
test('batch stores one best result for each generated condition and resumes across layouts',()=>{
 const expected=finish(new Run(data,batch));let r=new Run(data,batch),actual=[];
 for(let n=0;n<8;n++){const step=r.next();if(step.row)actual.push(step.row);}
 r=new Run(data,batch,JSON.parse(JSON.stringify(r.checkpoint())));actual.push(...finish(r));assert.equal(actual.length,2);assert.ok(actual.every(x=>x.type==='condition-result'&&x.searchComplete));assert.deepEqual(actual.map(x=>[x.conditionKey,x.best?.score]),expected.map(x=>[x.conditionKey,x.best?.score]));
});
test('lookup ignores room names and inert levels, but preserves unlock, recipe and operating distinctions',()=>{
 const row=finish(new Run(data,demo))[0],renamed=structuredClone(demo);renamed.base.rooms.renamed=renamed.base.rooms.factory;delete renamed.base.rooms.factory;renamed.products.renamed=renamed.products.factory;delete renamed.products.factory;assert.equal(matchesResult(data,renamed,row),true);
 renamed.progress.char_502_nblade.level=29;assert.equal(matchesResult(data,renamed,row),false);
 const changed=structuredClone(demo);changed.options.teams=3;assert.notEqual(conditionKey(data,changed),row.conditionKey);changed.options.teams=2;changed.products.factory='1';assert.notEqual(conditionKey(data,changed),row.conditionKey);
 const incomplete={...row,searchComplete:false};assert.equal(matchesResult(data,demo,incomplete),false);
});
test('automatic dorm supporters cannot also work and remain in the simulated plan',()=>{
 const raw=structuredClone(demo);raw.options.optimizeDormSupport=true;raw.progress.char_285_medic2={owned:true,elite:0,level:30};const m=buildModel(data,cleanInput(raw,data)),e=new Enumerator(m);let found=false;
 for(let n=0;n<10000;n++){const s=e.advance();if(s.done)break;if(!s.plan)continue;const supports=Object.values(s.plan.dormSupport).flat();if(!supports.length)continue;found=true;assert.ok(!s.plan.groups.some(g=>g.operators.some(id=>supports.includes(id))));assert.doesNotThrow(()=>simulate(m,s.plan));}
 assert.equal(found,true);
});
