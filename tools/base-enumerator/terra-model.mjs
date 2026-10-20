import * as terra from './terra-engine.mjs';
import {cleanInput,buildModel,meetingTeamAllowed} from './core.mjs';
import {rule} from './rules.mjs';
import {terraSnapshot} from './terra-snapshot.mjs';
import {improveRest} from './terra-rest.mjs';
export const INTEGRATED_VERSION='terra27-time-simulator-2';
export {terra};
const point=s=>{const m=s.unlock.match(/정예화\s*(\d+)/);return {id:s.buffId,elite:m?Number(m[1]):0,level:m?1:Number(s.unlock.match(/\d+/)?.[0]??1)};};
export function makeTerraCatalog(base){
 const characters={},buffs={...base.buffs};
 for(const op of terra.J){const old=base.characters[op.id],maxElite=op.rarity>=4?2:op.rarity===3?1:0;
  characters[op.id]={...old,id:op.id,name:op.name,rarity:op.rarity,identity:old?.identity??op.id,groups:op.factions,maxMorale:old?.maxMorale??24,maxLevels:Array.from({length:maxElite+1},(_,e)=>terra.W(op.rarity,e)),chains:op.skills.map(s=>[...s.tiers??[],s].map(point).filter((p,i,a)=>a.findIndex(q=>q.id===p.id)===i).sort((a,b)=>a.elite-b.elite||a.level-b.level))};
  for(const s of op.skills.flatMap(s=>[...s.tiers??[],s]))buffs[s.buffId]={id:s.buffId,room:s.room,name:s.name,description:s.description,base:s.value/100};
 }
 return {...base,characters,buffs,fingerprint:base.fingerprint+'-'+INTEGRATED_VERSION+'-47bf25da6c32-17738042c7a8',reference:{...base.reference,operators:terra.J.length}};
}
function wrap(s){
 const old=rule({id:s.buffId,name:s.name,description:s.description,room:s.room,base:s.value/100}),kind=old.kind==='unsupported'?'terra':old.kind;
 return {...old,kind,prod:s.value/100||(s.tokenUse.some(u=>u.percent)?1e-6:0),terra:s,linked:!!(s.tokenGen.length||s.tokenUse.length||s.convert||s.partners.length||s.basePartners.length||s.perFaction||s.perSkillTag||s.roomPartner||s.crossBuff||s.globalAura),...(s.kind==='solo'?{kind:'solo',amount:s.value/100}:{}),...(s.room==='MEETING'&&/미보유|아직 없는/.test(s.description)?{kind:'missing',requiresExchange:s.buffId.includes('&exchange')}:{}),...(s.kind==='shared'?{kind:'exchangeSpeed'}:{})};
}
export function createTerraModel(base,raw){
 if(raw.layoutSearch)throw Error('실제 기지 구성 하나를 입력하세요.');
 const catalog=makeTerraCatalog(base),input=cleanInput(raw,catalog);
 if(input.options.development!=='current')throw Error('통합 엔진은 현재 보유·육성 상태만 계산합니다.');
 const model=buildModel(catalog,input,input.progress,{workTypes:['MANUFACTURE','TRADING','POWER','HIRE','MEETING','CONTROL','TRAINING','WORKSHOP'],operatorFactory:(def,state)=>{
  const original=terra.kt(terra.K.get(def.id),state.elite,state.level),rawSkills=original.skills.map(s=>({...s}));
  return {...def,...state,terra:{...original,elite:state.elite,level:state.level,skills:rawSkills},skills:rawSkills.map(wrap)};
 }});
 model.restOptimizer=improveRest;
 model.engineVersion=INTEGRATED_VERSION;model.snapshotEvaluator=terraSnapshot;
 model.startingSelections=linkedSeeds(model);
 model.warnings=[
  '업로드한 테라아카이브 v27의 스킬 평가식을 시간 시뮬레이터에 연결한 버전입니다. 원본 A/B 가중치는 사용하지 않습니다.',
  '사무실 → 미보유 단서 우대 → 응접실 속도 → 지정 생산물 순위 → 무역소 기대 수익 순으로 비교합니다. 종류별 단서 획득 확률은 계산하지 않습니다.',
  '무역소는 공개 관측 분포로 주문 시간·순금·용문폐 기댓값을 계산합니다. 품질 기본/성숙 시나리오 범위이며 초기 확률 곡선과 실제 수익의 보장 구간은 아닙니다. 관측 자료가 없는 조합은 기본 분포 사용을 결과에 명시합니다.',
  '연계 자원은 실제 시설 레벨·현재 배치·컨디션으로 다시 계산합니다. 재료 충분·교대 시 수거·드론 미사용을 가정합니다.',
  '제이는 실제 주문 상한·대기량을 적용하되 기대 주문 수를 사용하며, 시간 경과형 등 일부 특수 중첩은 추가 검증이 필요합니다. 숙소는 고정 지원자를 보존하고 다음 근무조의 회복을 우선하여 인원 이동·교환·순서를 제한 탐색합니다. 임의 단일 대상 회복은 배치 순서 모델이며 전역 최적성을 보장하지 않습니다. 응접실은 공개된 분위기·시설 레벨 표를 사용합니다.',
  '첫 24시간과 첫 사이클을 계산합니다. 무한 반복 운영의 지속 가능성과 전체 최적해 또는 99% 정확도를 보장하지 않습니다.'
 ];
 // Preserve the existing policy even when a probability-only skill is present.
 for(const task of model.tasks)if(task.type==='MEETING')task.accept=ids=>meetingTeamAllowed(ids.map(id=>model.byId[id]),input.options);
 return model;
}
function linkedSeeds(model){
 const result=[],owned=model.pool;
 const make=items=>{const selection=model.tasks.map(()=>[]),used=new Set();for(const {op,type} of items){if(used.has(op.identity))continue;const index=model.tasks.findIndex((t,i)=>t.team<=0&&t.type===type&&t.candidates.includes(op.id)&&selection[i].length<t.capacity);if(index<0)return;selection[index].push(op.id);used.add(op.identity);}result.push(selection);};
 for(const op of owned)for(const s of op.terra.skills){
  if(s.roomPartner){const partner=model.byId[s.roomPartner.id];if(partner)make([{op,type:s.room},{op:partner,type:s.roomPartner.room}]);}
  if(s.crossBuff){const partner=model.byId[s.crossBuff.partner];if(partner)make([{op,type:s.room},{op:partner,type:s.crossBuff.room}]);}
  for(const u of s.tokenUse.filter(u=>u.percent)){
   const producers=owned.flatMap(p=>p.terra.skills.filter(x=>x.tokenGen.some(g=>g.token===u.token)).map(x=>({op:p,type:x.room})));
   const converters=owned.flatMap(p=>p.terra.skills.filter(x=>x.convert?.to===u.token).map(x=>({op:p,type:x.room,from:x.convert.from})));
   for(const x of converters){const upstream=owned.flatMap(p=>p.terra.skills.filter(y=>y.tokenGen.some(g=>g.token===x.from)).map(y=>({op:p,type:y.room})));for(const p of upstream)make([{op,type:s.room},x,p]);}
   for(const p of producers)make([{op,type:s.room},p]);
  }
 }
 return result.slice(0,32);
}
