import {group} from './rules.mjs';
import {expectedOrder} from './trading.mjs';
const EVAL_EPS=1e-8;
export const skills=(o,type)=>o.skills.filter(s=>s.room===type),active=(o,m)=>m[o.id]>EVAL_EPS;
export function snapshot(model,placements,morale,worked,context){
 if(model.snapshotEvaluator)return model.snapshotEvaluator(model,placements,morale,worked,context);
 if(!model.snapshotCache)return calculateSnapshot(model,placements,morale,worked);
 const key=JSON.stringify(placements.map(p=>[p.room.id,p.ops.map(o=>[o.id,morale[o.id],worked[o.id]??0]) ]));
 if(model.snapshotCache.has(key)){model.snapshotHits=(model.snapshotHits??0)+1;return model.snapshotCache.get(key);}
 const value=calculateSnapshot(model,placements,morale,worked);if(model.snapshotCache.size>=512)model.snapshotCache.delete(model.snapshotCache.keys().next().value);model.snapshotCache.set(key,value);return value;
}
// Reuse the same control effects across different factory/trading placements.
// Keep operator IDs and active flags in the key: equal auras do not free people.
function controlEffects(model,control,ccActive){
 const cache=model.controlEffectsCache??=new Map(),key=JSON.stringify([control.map(o=>o.id),ccActive.map(o=>o.id)]);
 if(cache.has(key)){model.controlEffectsHits=(model.controlEffectsHits??0)+1;return cache.get(key);}
 const cc=ccActive.flatMap(o=>skills(o,'CONTROL')),ccRecovery=cc.reduce((n,s)=>n+(s.kind==='ccRecovery'?s.amount:s.kind==='ccFaction'?control.filter(o=>group(o,s.group)).length*s.amount:0),0),ccProd=Math.max(0,...cc.filter(s=>s.kind==='ccProd').map(s=>s.amount)),mlynar=cc.some(s=>s.kind==='mlynar'),exportRecovery=mlynar?cc.filter(s=>s.kind==='ccRecovery').length*.05:0;
 const result={cc,ccRecovery,ccProd,mlynar,exportRecovery};if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
function calculateSnapshot(model,placements,morale,worked){
 const {catalog,pool,rooms}=model,at=t=>placements.filter(p=>p.room.type===t),control=at('CONTROL').flatMap(p=>p.ops),ccActive=control.filter(o=>active(o,morale)),all=placements.flatMap(p=>p.ops),rates=Object.fromEntries(pool.map(o=>[o.id,0])),factories=[],offices=[],meetings=[],trading=[];
 const {cc,ccRecovery,ccProd,mlynar,exportRecovery}=controlEffects(model,control,ccActive);
 const dormLevels=rooms.filter(r=>r.type==='DORMITORY').reduce((n,r)=>n+r.level,0),power=rooms.filter(r=>r.type==='POWER').length,trades=rooms.filter(r=>r.type==='TRADING').length;
 for(const p of placements){
  const r=p.room;if(r.type==='DORMITORY')continue;const acting=p.ops.filter(o=>active(o,morale)),buffs=acting.flatMap(o=>skills(o,r.type)),values=[];
  const roomDrain=buffs.filter(s=>s.kind==='factoryDrain').length*.1;
  const addedDrain=buffs.reduce((n,s)=>n+(s.roomDrain??0),0);
  for(const op of p.ops){
   let prod=0,cap=0,drain=1-control.length*.05+(['MANUFACTURE','TRADING'].includes(r.type)?(catalog.workerCost[p.ops.length]??0)/100:0)-roomDrain+addedDrain;
   if(r.type==='CONTROL')drain+=ccActive.filter(o=>o.id!==op.id).flatMap(o=>skills(o,'CONTROL')).reduce((n,s)=>n+(s.otherDrain??0),0);
   if(r.type==='CONTROL')drain-=ccRecovery;else{drain-=exportRecovery;if(mlynar&&['POWER','HIRE','MEETING'].includes(r.type))drain-=.1;}
   if(active(op,morale))for(const s of skills(op,r.type)){
    if(r.type==='MANUFACTURE'&&s.targets?.length&&!s.targets.includes(r.recipe.category))continue;
    if(['simple','missing','owned','clue','droneOnly','ignoredClue','globalMissing','quality','tradeOverride','tradePayout'].includes(s.kind)){prod+=s.prod;cap+=s.cap??0;drain+=s.drain??0;}
    if(s.kind==='exchangeSpeed'&&model.input.options.clueExchangeActive){prod+=s.prod;drain+=s.drain??0;}
    if(s.kind==='ramp')prod+=Math.min(s.max,s.initial+Math.floor((worked[op.id]??0)+EVAL_EPS)*s.step);
    if(s.kind==='trades')prod+=r.recipe?.category==='F_GOLD'?trades*s.amount:0;
    if(s.kind==='dormLevels')prod+=r.recipe?.category==='F_GOLD'?dormLevels*s.amount:0;
    if(s.kind==='training')prod+=Math.min(.3,Math.max(0,...rooms.filter(x=>x.type==='TRAINING').map(x=>x.level))*.1);
    if(s.kind==='hireDorm'){prod+=s.prod+dormLevels*s.amount;drain+=s.drain;}
    if(s.kind==='hireElite')prod+=s.prod+Math.min(5,placements.filter(q=>q.ops.some(o=>group(o,'elite'))).length)*.04;
    if(s.kind==='solo'&&p.ops.length===1){prod+=s.amount;drain+=s.drain;}
   }
   values.push({id:op.id,prod,cap});rates[op.id]=-drain;
  }
  if(r.type==='MANUFACTURE'){
   const bubble=buffs.some(s=>s.kind==='bubble'),vermeil=buffs.some(s=>s.kind==='vermeil');
   let prod=values.reduce((n,v)=>n+v.prod+(bubble?Math.max(0,v.cap)*(v.cap>16?.03:.01):vermeil?Math.max(0,v.cap)*.02:0),0);
   const automations=buffs.filter(s=>s.kind==='automation');if(automations.length)prod=automations.reduce((n,s)=>n+power*s.amount,0);
   factories.push({room:r,multiplier:p.ops.length?Math.max(0,1+p.ops.length*.01+prod+ccProd):0,capacity:Math.max(0,catalog.factory.phases[r.level-1].outputCapacity+values.reduce((n,v)=>n+v.cap,0))});
  }
  if(r.type==='HIRE'){
   const local=(p.ops.length?catalog.hire.basicSpeedBuff:0)+values.reduce((n,v)=>n+v.prod,0),bonus=cc.some(s=>s.kind==='hireThreshold')&&local<.3-EVAL_EPS?.2:0;
   offices.push({room:r,multiplier:Math.max(0,1+local+bonus)});
  }
  if(r.type==='MEETING'){
   // Retained as explicitly experimental until KR room/ambience measurements are validated.
   const passive=p.ops.reduce((n,o)=>n+({4:.02,5:.04,6:.05}[o.rarity]??0)+o.elite*.08+(active(o,morale)?.05:0),0),ambience=rooms.filter(r=>r.type==='DORMITORY').reduce((n,r)=>n+r.ambience,0),ambienceBonus=ambience>=4000?.15:ambience>=3000?.10:ambience>=2000?.05:0,global=Math.max(0,...cc.filter(s=>s.kind==='meetingBonus').map(s=>s.amount));
   const missing=model.input.options.missingClues,positive=buffs.some(s=>s.kind==='missing'&&(!s.requiresExchange||model.input.options.clueExchangeActive))||cc.some(s=>s.kind==='globalMissing');
   meetings.push({room:r,multiplier:p.ops.length?Math.max(0,1+([.07,.09,.11][r.level-1]??0)+ambienceBonus+passive+values.reduce((n,v)=>n+v.prod,0)+global):0,preference:acting.length&&missing.length>0&&missing.length<7?Number(positive):0});
  }
  if(r.type==='TRADING'){
   const override=buffs.filter(s=>s.kind==='tradeOverride'),quality=buffs.filter(s=>s.kind==='quality').map(s=>s.quality),bonus=Math.max(0,...buffs.filter(s=>s.kind==='tradePayout').map(s=>s.bonus));
   const prod=override.length?Math.max(...override.map(s=>s.amount))*Math.max(0,acting.length-1):values.reduce((n,v)=>n+v.prod,0);
   const order=expectedOrder(r.level,quality,bonus),capacity=[6,8,10][r.level-1]+buffs.reduce((n,s)=>n+(s.tradeLimit??0),0);
   trading.push({room:r,order,baselineOrder:expectedOrder(r.level,[],bonus),capacity:Math.max(0,capacity),multiplier:acting.length?Math.max(0,1+acting.length*.01+prod):0});
  }
 }
 const globalDorm=Math.max(0,...cc.filter(s=>s.kind==='globalDorm').map(s=>s.amount));
 for(const p of at('DORMITORY')){
  const base=catalog.dorms[p.room.level-1].manpowerRecover/100+p.room.ambience*.0004,all=p.ops;
  const singles=all.flatMap(o=>skills(o,'DORMITORY').filter(s=>['singleRest','selfSingleRest'].includes(s.kind)).map(s=>({op:o,amount:s.amount})));
  for(const op of all){
   const own=skills(op,'DORMITORY');if(own.some(s=>s.kind==='fixedRest')){rates[op.id]=2;continue;}
   const self=own.reduce((n,s)=>n+(s.kind==='selfRest'?s.amount:['selfAllRest','selfSingleRest'].includes(s.kind)?s.self:0),0);
   const bonuses=all.flatMap(o=>skills(o,'DORMITORY').filter(s=>s.kind==='allRest'||s.kind==='selfAllRest'&&(!s.excludesSelf||o.id!==op.id)).map(s=>s.amount));
   rates[op.id]=base+self+Math.max(0,...bonuses)+globalDorm;
  }
  const eligible=singles.map(s=>({...s,target:all.find(o=>o.id!==s.op.id&&morale[o.id]<o.maxMorale-EVAL_EPS&&!skills(o,'DORMITORY').some(s=>s.kind==='fixedRest'))})).filter(s=>s.target).sort((a,b)=>b.amount-a.amount||a.op.id.localeCompare(b.op.id));
  if(eligible.length)rates[eligible[0].target.id]+=eligible[0].amount;
 }
 return {rates,factories,offices,meetings,trading};
}
