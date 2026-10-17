import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {expectedOrder,orderDistribution} from './trading.mjs';
import {cleanInput,buildModel,snapshot,simulate,score,meetingTeamAllowed,Enumerator} from './core.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url)));
const owned=ids=>Object.fromEntries(ids.map(id=>[id,{owned:true,elite:catalog.characters[id].rarity>=4?2:0,level:catalog.characters[id].rarity>=4?1:30}]));
function model(type,ids,options={}){return buildModel(catalog,cleanInput({base:{rooms:{room:{type,level:3}}},progress:owned(ids),options:{maxHours:24,...options}},catalog));}
function snap(m,ids){return snapshot(m,[{room:m.rooms[0],ops:ids.map(id=>m.byId[id])}],Object.fromEntries(m.pool.map(o=>[o.id,24])),{});}
test('observed order distributions and reward/time expectations are explicit',()=>{
 assert.deepEqual(orderDistribution(1),[1,0,0]);assert.deepEqual(orderDistribution(2),[.6,.4,0]);
 assert.deepEqual(orderDistribution(3,['alpha','alpha']),[.13,.22,.65]);assert.deepEqual(orderDistribution(3,['alpha','beta']),[.05,.1,.85]);
 const base=expectedOrder(3),beta=expectedOrder(3,['beta'],500);
 assert.ok(Math.abs(base.seconds-12204)<1e-8);assert.ok(Math.abs(base.gold-2.9)<1e-8);
 assert.ok(Math.abs(beta.gold-3.8)<1e-8);assert.equal(beta.lmd,2325);
 assert.throws(()=>orderDistribution(2,['alpha']),/3레벨/);assert.throws(()=>orderDistribution(3,['beta','beta']),/중첩/);
});
test('specific clue preferences do not earn missing-clue priority; duplicate missing skills do not stack',()=>{
 const ids=['char_133_mm','char_497_ctable','char_4017_puzzle'],m=model('MEETING',ids,{missingClues:[2]});
 assert.equal(snap(m,[ids[0]]).meetings[0].preference,0);
 assert.equal(snap(m,[ids[1]]).meetings[0].preference,1);
 assert.equal(snap(m,ids.slice(1)).meetings[0].preference,1);
 const none=model('MEETING',ids,{missingClues:[]});assert.equal(snap(none,[ids[1]]).meetings[0].preference,0);
});
test('exchange-only missing preference requires exchange state',()=>{
 const id='char_445_wscoot';for(const on of [false,true]){const m=model('MEETING',[id],{missingClues:[1],clueExchangeActive:on});assert.equal(snap(m,[id]).meetings[0].preference,Number(on));}
});
test('Shamare counts other operators, preserves quality and Tequila payout, and applies morale costs',()=>{
 const ids=['char_254_vodfox','char_486_takila','char_252_bibeak'],m=model('TRADING',ids),s=snap(m,ids),f=s.trading[0];
 assert.ok(Math.abs(f.multiplier-1.93)<1e-9);assert.deepEqual(f.order.probabilities,[.05,.1,.85]);assert.equal(f.order.lmd,2325);
 assert.ok(Math.abs(s.rates[ids[0]]+.90)<1e-9);assert.ok(Math.abs(s.rates[ids[1]]+.90)<1e-9);
 const one=snap(m,[ids[0]]);assert.equal(one.trading[0].multiplier,1.01);
});
test('expected trade ledger respects order storage and collection at exact cycle cap',()=>{
 const ids=['char_283_midn','char_282_catap'],m=model('TRADING',ids),plan={groups:ids.map((id,team)=>({team,room:'room',operators:[id]}))},r=simulate(m,plan);
 assert.equal(r.status,'ok');assert.equal(r.cycle.hour,24);assert.equal(r.at24.trade.estimated,true);
 assert.ok(r.at24.trade.generated.lmd>0);assert.ok(Math.abs(r.at24.trade.generated.lmd-r.at24.trade.collected.lmd)<1e-7);
 assert.equal(score(m,r).length,7);
 // Force a high rate independently of the catalog's operator selection.
 const mm=model('TRADING',ids);for(const op of mm.pool)for(const s of op.skills)if(s.room==='TRADING')s.prod=100;
 const capped=simulate(mm,plan);assert.ok(Math.abs(capped.at24.trade.generated.orders-20)<1e-7);
});
test('meeting search permits one missing specialist plus speed, excludes duplicate specialists and passive-only operators',()=>{
 const ids=['char_497_ctable','char_4017_puzzle','char_133_mm','char_445_wscoot'],m=model('MEETING',ids,{missingClues:[1]});
 const team=names=>names.map(id=>m.byId[id]);
 assert.equal(meetingTeamAllowed(team(ids.slice(0,2)),m.input.options),false);
 assert.equal(meetingTeamAllowed(team([ids[0],ids[2]]),m.input.options),true);
 assert.equal(meetingTeamAllowed(team([ids[3]]),m.input.options),false);
 const e=new Enumerator(m);let n=0,s;while(!(s=e.advance()).done)if(s.plan){n++;for(const g of s.plan.groups)assert.ok(meetingTeamAllowed(team(g.operators),m.input.options));}assert.ok(n>0);
 const invalid={groups:[{team:0,room:'room',operators:ids.slice(0,2)},{team:1,room:'room',operators:[]}]};assert.throws(()=>simulate(m,invalid),/최대 1명/);
});
test('expectation range follows independent baseline/mature ledgers, not an invented confidence interval',()=>{
 const ids=['char_252_bibeak','char_283_midn'],m=model('TRADING',ids),r=simulate(m,{groups:ids.map((id,team)=>({team,room:'room',operators:[id]}))}),t=r.at24.trade;
 assert.equal(t.confidenceLevel,null);assert.equal(t.rankingBasis,'mature');
 assert.ok(t.range.generatedLmd[0]<t.range.generatedLmd[1]);
 assert.equal(t.range.generatedLmd[0],Math.min(t.generated.lmd,t.baseline.generated.lmd));
 assert.ok(Math.abs(t.baseline.generated.lmd-t.baseline.collected.lmd)<1e-7);
 const normal=model('TRADING',['char_283_midn','char_282_catap']);const result=simulate(normal,{groups:['char_283_midn','char_282_catap'].map((id,team)=>({team,room:'room',operators:[id]}))});assert.equal(result.at24.trade.range.generatedLmd[0],result.at24.trade.range.generatedLmd[1]);
});
