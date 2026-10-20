import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTerraModel,terra} from './terra-model.mjs';
import {terraSnapshot} from './terra-snapshot.mjs';
import {linkedResources} from './terra-state.mjs';
import {simulate,score,Enumerator,compare} from './core.mjs';
import {solveHeuristic} from './heuristic.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url)));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const id=name=>{const o=terra.J.find(o=>o.name===name);assert.ok(o,name);return o.id;};
function fixture(groups,levels={}){
 const rooms={},progress={};for(const [room,names] of Object.entries(groups)){const type=room.split('-')[0];rooms[room]={type,level:levels[room]??(type==='CONTROL'||type==='DORMITORY'?5:3),ambience:0};for(const name of names){const o=terra.K.get(id(name));progress[o.id]={owned:true,elite:o.rarity>=4?2:o.rarity===3?1:0,level:o.rarity<=2?30:1};}}
 const products=Object.fromEntries(Object.keys(rooms).filter(k=>rooms[k].type==='MANUFACTURE').map(k=>[k,'4']));
 const model=createTerraModel(catalog,{base:{rooms},products,progress,options:{teams:2,rotation:'12h',maxHours:48,optimizeDormSupport:false,missingClues:[1,2]}});
 const placements=Object.entries(groups).map(([key,names])=>({room:model.rooms.find(r=>r.id===key),ops:names.map(n=>model.byId[id(n)])}));
 const morale=Object.fromEntries(model.pool.map(o=>[o.id,24]));return {model,placements,morale,snap:()=>terraSnapshot(model,placements,morale)};
}
test('Lin office level changes unlocked extra-slot skill',()=>{for(const level of [1,2,3]){const f=fixture({HIRE:['린']},{HIRE:level});near(f.snap().offices[0].multiplier,1.25+(level-1)*.1);}});
test('office clue synergy is local-level dependent and stops at exhaustion',()=>{const f=fixture({HIRE:['우요우'],MEETING:['12F']});const a=f.snap().meetings[0].multiplier;f.morale[id('우요우')]=0;near(a-f.snap().meetings[0].multiplier,.1);});
test('CONFESS faction condition can use another power plant',()=>{const f=fixture({'POWER-0':['CONFESS-47'],'POWER-1':['안드레아나']});f.placements[1].ops[0].terra.factions=['라테라노'];near(f.snap().power[0].bonus,.15);f.placements[1].ops=[];near(f.snap().power[0].bonus,.1);});
test('Morgan strengthens Siege recovery for Glasgow members',()=>{const f=fixture({DORMITORY:['시즈','모건','Lancet-2']});for(const k in f.morale)f.morale[k]=10;const s=f.snap();near(s.rates[id('모건')],2+.5);near(s.rates[id('Lancet-2')],2+.2);});
test('Coldshot combined recovery does not add to an inferior single bonus',()=>{const f=fixture({DORMITORY:['콜드샷','Lancet-2','시즈']});for(const k in f.morale)f.morale[k]=10;const s=f.snap();near(s.rates[id('콜드샷')],2+Math.max(.8,.2+.65));near(s.rates[id('시즈')],2+.8);});
test('actual dorm occupants plus unlocked office conversion feed Rosmontis',()=>{const f=fixture({MANUFACTURE:['로즈몬티스'],HIRE:['위스퍼레인'],DORMITORY:['Lancet-2','시즈']});let t=linkedResources(f.placements,f.morale).tokens;assert.equal(t['기억 조각'],20);assert.equal(t['생각의 사슬'],22);f.morale[id('위스퍼레인')]=0;t=linkedResources(f.placements,f.morale).tokens;assert.equal(t['생각의 사슬'],2);});
test('Ling and Dusk change tokens at the morale threshold',()=>{const f=fixture({CONTROL:['링','시']});let a=linkedResources(f.placements,f.morale);assert.equal(a.tokens['속세의 화식'],15);assert.equal(a.tokens['감지 정보'],10);f.morale[id('링')]=12;f.morale[id('시')]=12;a=linkedResources(f.placements,f.morale);assert.equal(a.tokens['속세의 화식'],15);assert.equal(a.tokens['감지 정보'],10);assert.ok(a.thresholds[id('링')].includes(12));});
test('Ela increases coworkers drain, not own drain',()=>{const f=fixture({CONTROL:['Ela','시']});let a=f.snap();f.placements[0].ops[0].terra.skills=f.placements[0].ops[0].terra.skills.filter(s=>!s.buffId.startsWith('control_clue_cost&faction'));let b=f.snap();near(a.rates[id('Ela')],b.rates[id('Ela')]);near(b.rates[id('시')]-a.rates[id('시')],.25);});
test('Pepe fixed order ignores speed and consumes no gold',()=>{const f=fixture({TRADING:['페페','미드나이트']});const s=f.snap().trading[0];assert.equal(s.order.seconds,16200);assert.equal(s.order.gold,0);assert.equal(s.order.lmd,1000);assert.equal(s.multiplier,1);assert.ok(s.capacity>=13);});
test('unlock state changes actual skill set',()=>{const o=terra.J.find(o=>o.name==='로즈몬티스');assert.equal(terra.kt(o,0,1).skills.flatMap(s=>s.tokenUse).find(u=>u.percent).per,2);assert.equal(terra.kt(o,2,1).skills.flatMap(s=>s.tokenUse).find(u=>u.percent).per,1);});
test('integrated two and three crews agree with small exhaustive enumeration',()=>{for(const teams of [2,3])for(const rotation of ['12h','first','all']){
 const raw={base:{rooms:{factory:{type:'MANUFACTURE',level:1},dorm:{type:'DORMITORY',level:3,ambience:3000}}},products:{factory:'4'},progress:{char_502_nblade:{owned:true,elite:0,level:30},char_500_noirc:{owned:true,elite:0,level:30}},options:{teams,rotation,maxHours:168,optimizeDormSupport:false}};
 const model=createTerraModel(catalog,raw),iter=new Enumerator({...model,symmetry:false});let best=null;
 for(;;){const x=iter.advance();if(x.done)break;if(!x.plan)continue;const v=score(model,simulate(model,x.plan));if(v&&(!best||compare(v,best)>0))best=v;}
 const got=solveHeuristic(model,{maxMilliseconds:3000,exactThreshold:100000});assert.equal(got.stats.evaluationErrors,0);assert.deepEqual(got.best?.score??null,best);
}});
