import * as engine from './terra-engine.mjs';
const EPS=1e-8;
export function linkedResources(placements,morale){
 const work=placements.filter(p=>p.room.type!=='DORMITORY'),dorm=placements.filter(p=>p.room.type==='DORMITORY'),all=placements.flatMap(p=>p.ops),base={},edges=new Map(),thresholds={};
 const add=(key,value)=>base[key]=(base[key]??0)+value;
 for(const p of placements)for(const op of p.ops){
  const acting=p.room.type==='DORMITORY'||morale[op.id]>EPS;if(!acting)continue;
  for(const s of op.terra.skills.filter(s=>s.room===p.room.type)){
   const d=s.description;
   if(s.buffId.startsWith('control_mp_cost&bd1')&&morale[op.id]<=12+EPS)add('속세의 화식',15);
   for(const m of d.matchAll(/컨디션이?\s*(\d+)\s*(?:초과|이상|이하|미만)/g))(thresholds[op.id]??=[]).push(Number(m[1]));
   for(const g of s.tokenGen){let amount=g.estimate??0;
    if(g.perDormLevel!=null)amount=p.room.level*g.perDormLevel;
    if(g.perMember)amount=g.perMember.per*Math.min(g.perMember.cap,work.flatMap(p=>p.ops).filter(o=>engine.inFaction(o.terra,g.perMember.match)).length);
    if(/숙소 내 오퍼레이터 1명당/.test(d))amount=dorm.reduce((n,p)=>n+p.ops.length,0);
    if(/해당 숙소 안에 배치된 오퍼레이터 1명당/.test(d))amount=p.ops.length;
    if(/모집 인원마다/.test(d))amount=Math.max(0,p.room.level-1)*Number(d.match(new RegExp(g.token+'\\s*\\+(\\d+)'))?.[1]??0);
    if(s.perFaction&&s.perScope==='room')amount=p.ops.filter(o=>engine.inFaction(o.terra,s.perFaction)).length;
    if(s.buffId.startsWith('control_mp_bd2'))amount=2*p.ops.filter(o=>engine.inFaction(o.terra,'아이루와 유쾌한 친구들')).length;
    if(s.buffId.startsWith('control_costToBD')){if(morale[op.id]>12+EPS)add('속세의 화식',15);else add('감지 정보',10);continue;}
    if(s.buffId.startsWith('control_mp_cost&bd2')&&morale[op.id]<=12+EPS)amount=0;
    add(g.token,amount);
   }
   if(s.convert){const c=s.convert,key=c.from+'|'+c.to;const prev=edges.get(key);if(!prev||c.amount/c.per>prev.amount/prev.per)edges.set(key,c);}
  }
 }
 const values={},visiting=new Set();
 function get(key){if(Object.hasOwn(values,key))return values[key];if(visiting.has(key))throw Error('연계 자원 변환 순환: '+key);visiting.add(key);let n=base[key]??0;for(const c of edges.values())if(c.to===key)n+=Math.floor((get(c.from)+EPS)/c.per)*c.amount;visiting.delete(key);return values[key]=n;}
 for(const key of new Set([...Object.keys(base),...Array.from(edges.values(),e=>e.to)]))get(key);
 return {tokens:values,thresholds,all};
}
const number=(d,re,fallback=0)=>Number(d.match(re)?.[1]??fallback);
export function dormRates(model,placements,morale,tokens,rates,thresholds){
 const all=placements.flatMap(p=>p.ops),extra=Math.max(0,...model.rooms.filter(r=>r.type==='HIRE').map(r=>r.level-1));
 const global=Math.max(0,...placements.filter(p=>p.room.type==='CONTROL').flatMap(p=>p.ops.filter(op=>morale[op.id]>EPS).flatMap(op=>op.terra.skills.filter(s=>s.buffId.startsWith('control_dorm_rec')).map(s=>s.value))));
 for(const p of placements.filter(p=>p.room.type==='DORMITORY')){
  const base=model.catalog.dorms[p.room.level-1].manpowerRecover/100+p.room.ambience*.0004;
  const singles=[],recoveryParts={};
  for(const target of p.ops){
   if(target.terra.skills.some(s=>s.buffId.startsWith('dorm_recExcludeOther'))){rates[target.id]=2;continue;}
   let self=0;const roomBonuses=[0],conditional=[0];
   for(const provider of p.ops)for(const s of provider.terra.skills.filter(s=>s.room==='DORMITORY')){
    const d=s.description,id=s.buffId.split('[')[0];
    if(provider.id===target.id)self+=number(d,/자신의 시간당 컨디션 회복(?: 속도)?\s*([+-][\d.]+)/);
    if(id==='dorm_recExcludeOther'||id==='dorm_exchangeAp')continue;
    const isSingle=id.startsWith('dorm_rec_single')||id==='dorm_rec_bd_n1_n3';
    if(isSingle)continue;
    if(id==='dorm_rec_toone')continue;
    let value=0;
    if(/모든 오퍼레이터|모든 인원/.test(d))value=number(d,/(?:모든 오퍼레이터의 시간당 컨디션 회복(?: 속도)?|모든 오퍼레이터 시간당 컨디션 회복|모든 인원의 시간당 컨디션 회복)\s*\+([\d.]+)/,s.value);
    if(id==='dorm_rec_oneself2')value=p.ops.length>1?.05:0;
    if(d.includes('자신을 제외한')&&provider.id===target.id)value=0;
    if(id==='dorm_rec_all&lv')value+=p.room.level*number(d,/레벨당 회복 효과 추가로\s*\+([\d.]+)/);
    if(id==='dorm_powToRecAll')value+=model.rooms.filter(r=>r.type==='POWER').length*number(d,/회복 효과 추가로\s*\+([\d.]+)/);
    if(id==='dorm_hireToRecAll')value+=extra*number(d,/추가로\s*\+([\d.]+)/);
    if(id==='dorm_rec_all&unfull')value+=p.ops.filter(o=>morale[o.id]<o.maxMorale-EPS).length*number(d,/1명당 추가로\s*\+([\d.]+)/);
    if(id==='dorm_rec_all&bd')value+=Math.floor((tokens['무성의 공명']??0)/5)*.01;
    if(id==='dorm_rec_all&profession')value=.06*Math.min(4,all.filter(o=>o.terra.subProfession==='방랑 메딕').length);
    if(id==='dorm_rec_all&group')value=.06*Math.min(4,all.filter(o=>engine.inFaction(o.terra,'쉐이')).length);
    if(id==='dorm_rec_all&tag'&&['라이오스','마르실','칠책','센시'].includes(target.name))value+=.05;
    if(id==='dorm_rec_all&single')value=0;
    if(provider.name==='시즈'&&engine.inFaction(target.terra,'글래스고')&&p.ops.some(o=>o.name==='모건'))value+=.3;
    if(id==='dorm_rec_all&tired'){
     const limit=number(d,/컨디션이\s*(\d+)\s*이하/);(thresholds[target.id]??=[]).push(limit);
     if(morale[target.id]<limit-EPS)conditional.push(number(d,/추가로\s*\+([\d.]+)/));
    }
    roomBonuses.push(value);
   }
   recoveryParts[target.id]={base:base+self+global,bonus:Math.max(...roomBonuses)+Math.max(...conditional)};
   rates[target.id]=recoveryParts[target.id].base+recoveryParts[target.id].bonus;
  }
  for(const provider of p.ops)for(const s of provider.terra.skills.filter(s=>s.room==='DORMITORY')){
   if(!s.buffId.startsWith('dorm_rec_single')&&!s.buffId.startsWith('dorm_rec_bd_n1_n3'))continue;
   const target=p.ops.find(o=>o.id!==provider.id&&morale[o.id]<o.maxMorale-EPS&&!o.terra.skills.some(s=>s.buffId.startsWith('dorm_recExcludeOther')));if(!target)continue;
   let amount=number(s.description,/(?:시간당(?: 컨디션)? 회복(?: 속도)?)\s*\+([\d.]+)/,s.value),condition=s.description.match(/대상이 (.+?)(?:일|인) 경우/);
   if(condition&&(target.name===condition[1]||condition[1].includes('오퍼레이터')&&engine.inFaction(target.terra,condition[1].replace(' 오퍼레이터',''))||condition[1].includes('몬스터 헌터')&&['몬스터 헌터','포영국 사냥 팀'].some(f=>engine.inFaction(target.terra,f))))amount+=number(s.description,/추가(?:로)?\s*\+([\d.]+)/);
   singles.push({target:target.id,amount});
  }
  if(singles.length){const top=singles.sort((a,b)=>b.amount-a.amount)[0];rates[top.target]+=top.amount;}
  if(p.ops.some(o=>o.terra.skills.some(s=>s.buffId.startsWith('dorm_rec_all&single'))))for(const target of p.ops){const part=recoveryParts[target.id];if(part&&morale[target.id]<target.maxMorale-EPS)rates[target.id]=Math.max(rates[target.id],part.base+.8);}
 }
}
