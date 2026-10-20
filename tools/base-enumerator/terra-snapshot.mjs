import * as engine from './terra-engine.mjs';
import {expectedTerraOrder} from './terra-orders.mjs';
import {linkedResources,dormRates} from './terra-state.mjs';
const EPS=1e-8,working=['MANUFACTURE','TRADING','POWER','HIRE','MEETING'];
function configure(model){
 const count={},keys=new Map(),cells=[],levels={};
 for(const r of model.rooms){const i=count[r.type]??0;count[r.type]=i+1;const key=r.type==='DORMITORY'?'DORM-'+i:['CONTROL','HIRE','MEETING','TRAINING','WORKSHOP'].includes(r.type)?r.type:r.type+'-'+i;
  keys.set(r.id,key);cells.push({key,room:r.type,label:r.id,...r.recipe?{product:r.recipe.category==='F_GOLD'?'gold':r.recipe.category==='F_EXP'?'exp':'originium'}:{}});levels[key]=r.level;
 }
 engine.configureActualRooms(cells,levels);return keys;
}
function relevant(op,type,product){return engine.roomSkills(op,type,product);}
function gated(s,op,peers,roomOf){return (!s.partners.length||s.partners.every(id=>peers.some(o=>o.id===id)))&&(!s.reqFaction||peers.some(o=>o.id!==op.id&&engine.inFaction(o,s.reqFaction)))&&(!s.roomPartner||roomOf.get(s.roomPartner.id)===s.roomPartner.room);}
export function terraSnapshot(model,placements,morale,worked={},simulation={}){
 const keys=configure(model),{tokens,thresholds}=linkedResources(placements,morale),roomOf=new Map(),cellOf=new Map(),factionCounts={},presentIds=new Set();
 for(const p of placements)for(const op of p.ops){roomOf.set(op.id,p.room.type);cellOf.set(op.id,keys.get(p.room.id));presentIds.add(op.id);for(const f of op.terra.factions??[op.terra.faction])factionCounts[f]=(factionCounts[f]??0)+1;}
 const effective=new Map();let nextChangeHours=Infinity;
 for(const p of placements)for(const op of p.ops){const active=p.room.type==='DORMITORY'||morale[op.id]>EPS;
  const skills=active?op.terra.skills.map(s=>{let value=s.value;if(s.growHourly){value=Math.min(s.growHourly.cap,s.growHourly.first+s.growHourly.rate*Math.floor((worked[op.id]??0)+EPS));nextChangeHours=Math.min(nextChangeHours,Math.floor((worked[op.id]??0)+EPS)+1-(worked[op.id]??0));}
   const copy={...s,value,growHourly:undefined};
   if(s.buffId.startsWith('manu_prod_spd_reduce')){const drop=Math.max(0,op.maxMorale-morale[op.id]);copy.value=30-Math.floor((drop+EPS)/4)*5;(thresholds[op.id]??=[]).push(...[4,8,12,16,20].map(n=>op.maxMorale-n));}
   if(s.buffId.startsWith('manu_prod_spd_addition&cost')){const active=op.maxMorale-morale[op.id]>=12-EPS;if(!active){copy.value=0;copy.cap=0;}(thresholds[op.id]??=[]).push(op.maxMorale-12);}
   if(s.buffId.startsWith('control_hire_spd_all'))copy.kind='ctrl_hire';
   if(p.room.type==='MANUFACTURE'&&p.ops.some(o=>o.terra.skills.some(x=>x.buffId.startsWith('manu_skill_change')))&&s.families?.some(x=>['라인테크','피누스 실베스트리스'].includes(x)))copy.families=['표준화'];
   if(s.goldLine){const bonus=p.ops.some(o=>o.terra.skills.some(x=>x.buffId.startsWith('trade_ord_line_durin')))?Math.min(4,placements.flatMap(q=>q.ops).filter(o=>o.terra.race==='두린').length):0;copy.goldLine={...s.goldLine,base:s.goldLine.base+Math.floor(bonus/s.goldLine.per)*s.goldLine.add};}
   if(s.buffId.startsWith('trade_ord_limit&trade&lv'))copy.cap=(s.cap??1)*p.room.level;
   if(s.buffId.startsWith('hire_spd_cost&extra'))copy.value=s.value*Math.max(0,p.room.level-1);
   if(s.room==='POWER'&&s.reqFaction){copy.value=placements.filter(q=>q.room.type==='POWER').flatMap(q=>q.ops).some(o=>o.id!==op.id&&engine.inFaction(o.terra,s.reqFaction))?copy.value:0;copy.reqFaction=null;}
   if(s.room==='MEETING'&&s.buffId==='meet_spd&bd[999]'){copy.missingPartners=s.partners;copy.partners=[];}
   if(s.room==='MEETING'&&s.buffId.startsWith('meet_spd_notOwned_P')){copy.roomPartner=null;if(roomOf.get(s.roomPartner?.id)!==s.roomPartner?.room)copy.value=0;}
   if(s.room==='MEETING'&&s.condBonus&&s.moraleDrain>0){const c=s.condBonus,ok=c.faction?p.ops.some(o=>o.id!==op.id&&engine.inFaction(o.terra,c.faction)):(c.ids??[]).some(id=>p.ops.some(o=>o.id===id));if(!ok)copy.moraleDrain=0;}
   if(s.kind==='shared'&&!model.input.options.clueExchangeActive)copy.value=0;
   if(s.gatePlatforms){const others=placements.filter(q=>q.room.type==='POWER'&&q.room.id!==p.room.id).flatMap(q=>q.ops);if(!others.some(o=>o.rarity===1))copy.value=0;copy.gatePlatforms=null;}
   if(s.buffId.startsWith('control_mp_expand_double')){copy.roomPartner=null;copy.recoverAura={...s.recoverAura,value:.1+(roomOf.get('char_4134_cetsyr')==='CONTROL'?.1:0)};}
   return copy;
  }):[];
  effective.set(op.id,{...op.terra,elite:op.elite,skills});
 }
 const at=(p,activeOnly=true)=>p.ops.filter(op=>!activeOnly||p.room.type==='DORMITORY'||morale[op.id]>EPS).map(op=>effective.get(op.id));
 const controls=placements.filter(p=>p.room.type==='CONTROL').flatMap(p=>at(p)),controlOccupants=placements.filter(p=>p.room.type==='CONTROL').reduce((n,p)=>n+p.ops.length,0);
 const powerPlacements=placements.filter(p=>p.room.type==='POWER'),platforms=powerPlacements.flatMap(p=>p.ops.filter(o=>o.rarity===1)),plantBoost=powerPlacements.flatMap(p=>at(p).flatMap(o=>o.skills.filter(s=>s.kind==='plantbonus'&&!platforms.some(x=>!p.ops.some(y=>y.id===x.id))).map(s=>s.value)));
 const context={tokenPoints:tokens,factionCounts,presentIds,roomOf,cellOf,plants:powerPlacements.length+Math.max(0,...plantBoost)+(controls.some(o=>o.skills.some(s=>s.buffId.startsWith('control_pow_bot')))&&roomOf.get('char_285_medic2')==='POWER'?2:0),product:undefined};
 const officeClueBonus=placements.filter(p=>p.room.type==='HIRE').reduce((n,p)=>n+at(p).flatMap(o=>o.skills.filter(s=>s.buffId.startsWith('hire_spd&clue'))).reduce((v,s)=>v+Math.max(0,p.room.level-1)*Number(s.description.match(/단서 수집 속도가 추가로 \+(\d+)%/)?.[1]??0),0),0);
 const ambient=engine.controlAuras(controls,context),rates=Object.fromEntries(model.pool.map(o=>[o.id,0])),factories=[],offices=[],meetings=[],trading=[],power=[];
 const mlynar=controls.some(o=>o.id==='char_4064_mlynar'),exportRecovery=mlynar?controls.flatMap(o=>o.skills.filter(s=>s.room==='CONTROL'&&s.recoverRoom===.05)).length*.05:0;
 for(const p of placements){const r=p.room;if(r.type==='DORMITORY')continue;
  const peers=at(p),ctx={...context,ambient,product:r.recipe?.category==='F_GOLD'?'gold':r.recipe?.category==='F_EXP'?'exp':r.recipe?'originium':undefined};
  const matched=peers.flatMap(o=>relevant(o,r.type,ctx.product).filter(s=>gated(s,o,peers,roomOf)).map(s=>({op:o,skill:s}))),all=matched.map(x=>x.skill);
  const effects=peers.map(o=>{const e=engine.operatorEffect(o,r.type,peers,ctx);for(const x of e.crossIn){const provider=effective.get(x.from);if(!provider?.skills.some(s=>s.room===x.fromRoom&&s.crossBuff?.partner===o.id&&s.crossBuff?.room===r.type))e.efficiency-=x.value;}return e;});
  // Remove the source engine's representative Jaye constants before using
  // this room's actual capacity and current expected pending-order count.
  const jayeIndex=peers.findIndex(o=>relevant(o,r.type,ctx.product).some(s=>s.capConv?.t==='diff'));
  if(r.type==='TRADING'&&jayeIndex>=0){
   const e=effects[jayeIndex],own=all.filter(s=>s.buffId.startsWith('trade_ord_limit_count')),rate=all.find(s=>s.capConv?.t==='diff').capConv.rate;
   e.capConv=e.capConv.filter(x=>x.conv.t!=='diff');
   e.efficiency-=own.reduce((n,s)=>n+s.value,0);e.cap-=own.reduce((n,s)=>n+(s.cap??0),0);
   const others=engine.combineOutput(effects,peers),negativeAura=Math.min(0,engine.facilityAura(r.type,peers,ambient,others,ctx.product));
   const startingCapacity=[6,8,10][r.level-1]+effects.reduce((n,x)=>n+x.cap,0)+engine.capacityAura(r.type,ambient,peers);
   const lost=own.length?Math.min(Math.max(0,startingCapacity-1),Math.floor(Math.max(0,others+negativeAura)/10+EPS)):0;
   e.cap-=lost;
   const capacity=Math.max(1,startingCapacity-lost),pending=simulation.tradeInventory?.[r.id]?.orders??0;
   e.efficiency+=rate*Math.max(0,capacity-(own.length?0:pending));
  }
  const plain=engine.combineOutput(effects,peers),conversion=engine.capacityConversion(effects,r.type,ambient,peers),aura=engine.facilityAura(r.type,peers,ambient,plain,ctx.product),capacityBonus=effects.reduce((n,e)=>n+e.cap,0)+engine.capacityAura(r.type,ambient,peers);
  let added=all.reduce((n,s)=>n+(s.drainRoom??0),0),recovery=all.reduce((n,s)=>n+(s.recoverRoom??0)+(s.recoverRoomPer?s.recoverRoomPer.value*peers.filter(o=>engine.inFaction(o,s.recoverRoomPer.faction)).length:0),0);
  if(r.type==='CONTROL')recovery+=.05*Math.max(0,p.ops.length-1);
  for(const op of p.ops){const own=matched.filter(x=>x.op.id===op.id).map(x=>x.skill);let ownDrain=own.reduce((n,s)=>n+(s.moraleDrain??0),0);
   if(own.some(s=>s.buffId.startsWith('control_mp_bd&trade')))ownDrain=Math.floor((tokens['열정']??0)/8)*.01;
   ownDrain-=own.filter(s=>s.buffId.startsWith('control_clue_cost&faction')).reduce((n,s)=>n+s.moraleDrain,0);
   ownDrain+=matched.filter(x=>x.op.id!==op.id&&x.skill.buffId.startsWith('control_clue_cost&faction')).reduce((n,x)=>n+x.skill.moraleDrain,0);
   if(all.some(s=>s.selfDrainNegate==='*'||s.selfDrainNegate==='@self'&&matched.some(x=>x.skill===s&&x.op.id===op.id)||s.selfDrainNegate&&!['*','@self'].includes(s.selfDrainNegate)&&engine.inFaction(op.terra,s.selfDrainNegate))&&ownDrain>0)ownDrain=0;
   const auraRecovery=Math.max(0,...ambient.filter(a=>a.kind==='drain_recover'&&a.aura&&a.rooms.includes(r.type)).map(a=>a.value));
   const direct=working.includes(r.type)?controlOccupants*.05+exportRecovery:0;
   let drain=(r.type==='WORKSHOP'?0:1)+(['MANUFACTURE','TRADING'].includes(r.type)?(model.catalog.workerCost[p.ops.length]??0)/100:0)+Math.max(0,ownDrain)+added-recovery-direct-Math.max(Math.max(0,-ownDrain),auraRecovery);
   rates[op.id]=-drain;
  }
  if(r.type==='MANUFACTURE')factories.push({room:r,multiplier:p.ops.length?Math.max(0,1+p.ops.length*.01+(plain+conversion+aura)/100):0,capacity:Math.max(0,model.catalog.factory.phases[r.level-1].outputCapacity+capacityBonus)});
  if(r.type==='HIRE')offices.push({room:r,multiplier:Math.max(0,1+(peers.length?5:0)/100+(plain+aura)/100)});
  if(r.type==='MEETING'){
   const passive=peers.reduce((n,o)=>n+({4:7,5:9,6:10}[o.rarity]??5)+(o.elite??0)*8,0),missing=all.some(s=>/미보유|아직 없는/.test(s.description)&&(!s.missingPartners||s.missingPartners.every(id=>peers.some(o=>o.id===id)))&&(!s.buffId.includes('&exchange')||model.input.options.clueExchangeActive))||controls.some(o=>o.skills.some(s=>s.buffId.startsWith('control_clue_cost&faction')&&s.description.includes('미보유')));
   const ambience=model.rooms.filter(r=>r.type==='DORMITORY').reduce((n,r)=>n+r.ambience,0),ambienceBonus=ambience>=4000?.15:ambience>=3000?.10:ambience>=2000?.05:0;
   meetings.push({room:r,multiplier:p.ops.length?Math.max(0,1+[.07,.09,.11][r.level-1]+ambienceBonus+(passive+plain+aura+officeClueBonus)/100):0,preference:peers.length&&missing&&model.input.options.missingClues.length>0&&model.input.options.missingClues.length<7?1:0});
  }
  if(r.type==='POWER')power.push({room:r,bonus:plain/100});
  if(r.type==='TRADING'){
   const baseline=expectedTerraOrder(r.level,all,{baseline:true}),mature=expectedTerraOrder(r.level,all),baseSpeed=Math.max(0,1+peers.length*.01+(plain+conversion+aura)/100);
   let speed=baseSpeed;
   const pepe=all.some(s=>s.buffId.startsWith('trade_ord_pepe')),closure=all.some(s=>s.buffId.startsWith('trade_ord_closure')),twoGold=all.some(s=>s.buffId.startsWith('trade_ord_spd&wt'));
   const fixedOrder=pepe||closure||twoGold;
   const estimated=pepe?{seconds:16200,gold:0,lmd:1000,probabilities:null}:closure||twoGold?{seconds:8640,gold:2,lmd:closure?1200:1000,probabilities:[1,0,0]}:mature;
   if(fixedOrder)speed=pepe?1:Math.max(0,baseSpeed);
   trading.push({room:r,order:estimated,baselineOrder:fixedOrder?estimated:baseline,capacity:Math.max(0,[6,8,10][r.level-1]+capacityBonus),multiplier:peers.length?speed:0,baselineMultiplier:peers.length?(pepe?1:Math.max(0,baseSpeed)):0,approximation:fixedOrder?'fixed-order-expected-work':mature.approximation??'mature-distribution-expected-work'});
  }
 }
 dormRates(model,placements,morale,tokens,rates,thresholds);
 return {rates,factories,offices,meetings,trading,power,tokens,thresholds,nextChangeHours,roleMerit:Object.values(tokens).reduce((a,b)=>a+b,0)*.001,stepHours:trading.some(f=>placements.find(p=>p.room.id===f.room.id)?.ops.some(op=>op.terra.skills.some(s=>s.capConv?.t==='diff')))?1/12:undefined};
}
