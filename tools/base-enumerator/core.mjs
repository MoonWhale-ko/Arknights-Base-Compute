import {rule,unlock} from './rules.mjs';
import {expectedOrder,TRADE_MODEL} from './trading.mjs';
import {skills,snapshot} from './evaluator.mjs';
import {FacilityCandidates,officeUpperBound,candidateTableKey} from './search.mjs';
export {snapshot} from './evaluator.mjs';
export const VERSION='24h-cycle-lab-7';
const EPS=1e-8,TYPES=['MANUFACTURE','HIRE','MEETING','CONTROL','POWER','TRADING'],CATS=['F_GOLD','F_EXP','F_DIAMOND'];
export const stable=v=>JSON.stringify(sort(v));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
const requireValue=(yes,message)=>{if(!yes)throw Error(message);};
export function meetingTeamAllowed(ops,options){
 const missing=op=>op.skills.some(s=>s.room==='MEETING'&&s.kind==='missing'&&(!s.requiresExchange||options.clueExchangeActive));
 const speed=op=>op.skills.some(s=>s.room==='MEETING'&&((s.prod>0&&(!s.requiresExchange||options.clueExchangeActive)&&s.kind!=='exchangeSpeed')||s.kind==='exchangeSpeed'&&options.clueExchangeActive||s.kind==='solo'&&ops.length===1||s.kind==='ramp'));
 return ops.filter(missing).length<=1&&ops.every(op=>missing(op)||speed(op));
}
export function cleanInput(raw,catalog){
 requireValue(raw&&typeof raw==='object'&&!Array.isArray(raw),'조건 JSON이 필요합니다.');
 const progress={};for(const [id,s] of Object.entries(raw.progress??{})){
  if(s?.owned!==true)continue;requireValue(Object.hasOwn(catalog.characters,id),`데이터에 없는 오퍼레이터: ${id}`);
  const elite=Number(s.elite??0),level=Number(s.level??1),def=catalog.characters[id];
  requireValue(Number.isInteger(elite)&&elite>=0&&elite<=2&&Number.isInteger(level)&&level>=1&&level<=90,`${id}: 육성 값 오류`);
  if(def.maxLevels)requireValue(def.maxLevels[elite]&&level<=def.maxLevels[elite],`${def.name}: 현재 정예화 단계의 레벨 범위 오류`);
  progress[id]={owned:true,elite,level};
 }
 requireValue(Object.keys(progress).length||raw.options?.development==='all-operators','보유 오퍼레이터가 없습니다.');
 const rooms={};for(const [id,r] of Object.entries(raw.base?.rooms??{})){
  requireValue(/^[\w-]{1,80}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id),'시설 ID 오류');
  requireValue(Number.isInteger(r.level)&&r.level>=0&&r.level<=5,'시설 레벨 오류');
  if(!r.level)continue;requireValue([...TYPES,'DORMITORY','TRAINING','WORKSHOP','PRIVATE'].includes(r.type),'알 수 없는 시설 종류');
  requireValue(r.level<=(['CONTROL','DORMITORY'].includes(r.type)?5:3),'시설 최대 레벨 초과');
  rooms[id]={type:r.type,level:r.level};if(r.type==='DORMITORY'){
   const ambience=Number(raw.options?.ambience?.[id]??r.ambience);requireValue(Number.isFinite(ambience)&&ambience>=0&&ambience<=r.level*1000,`${id}: 숙소 인테리어 점수가 필요합니다.`);rooms[id].ambience=ambience;
  }
 }
 requireValue(Object.keys(rooms).length&&Object.keys(rooms).length<=40,'시설은 1~40개여야 합니다.');
 const products={};for(const [id,r] of Object.entries(rooms))if(r.type==='MANUFACTURE'){
  const key=String(raw.products?.[id]??'');requireValue(Object.hasOwn(catalog.recipes,key),`${id}: 생산 품목을 선택하세요.`);products[id]=key;
 }
 const o=raw.options??{},priority=[...new Set(o.priority??CATS)];requireValue(priority.length===3&&priority.every(p=>CATS.includes(p)),'생산 순위는 순금·작전기록·오리지늄 조각의 순열이어야 합니다.');
 const options={teams:o.teams??2,rotation:o.rotation??'12h',extraActions:o.extraActions===true,priority,missingClues:o.missingClues??[],clueExchangeActive:o.clueExchangeActive===true,development:o.development??'current',maxHours:o.maxHours??168,rankingWindow:o.rankingWindow??'24h',optimizeDormSupport:o.optimizeDormSupport!==false,ownedMin:o.ownedMin??0,ownedMax:o.ownedMax??Object.keys(catalog.characters).length,tradeModel:TRADE_MODEL,searchStrategy:o.searchStrategy??'bounded'};
 requireValue(['bounded','exhaustive'].includes(options.searchStrategy),'탐색 방식 오류');
 if(o.tradeModel!==undefined)requireValue(o.tradeModel===TRADE_MODEL,'지원하지 않는 무역소 계산 모델');
 requireValue([2,3].includes(options.teams)&&['first','all','12h'].includes(options.rotation),'교대 설정 오류');
 requireValue(['current','all-unlock-states','all-operators'].includes(options.development),'육성 비교 모드 오류');requireValue(['24h','cycle'].includes(options.rankingWindow),'비교 기간 오류');
 requireValue(Number.isFinite(options.maxHours)&&options.maxHours>=24&&options.maxHours<=720,'사이클 검사 상한은 24~720시간입니다.');
 requireValue(Array.isArray(options.missingClues)&&new Set(options.missingClues).size===options.missingClues.length&&options.missingClues.every(n=>Number.isInteger(n)&&n>=1&&n<=7),'미보유 단서 번호 오류');options.missingClues.sort();
 requireValue(Number.isInteger(options.ownedMin)&&Number.isInteger(options.ownedMax)&&options.ownedMin>=0&&options.ownedMax>=options.ownedMin&&options.ownedMax<=Object.keys(catalog.characters).length,'보유 인원 범위 오류');
 if(options.development==='all-operators')requireValue(!Object.values(raw.dormSupport??{}).flat().length&&!(raw.residents??[]).length&&!Object.keys(raw.candidates??{}).length,'전체 오퍼레이터 자동 비교에서는 고정 인원·후보 제한을 비워주세요.');
 const dormSupport={};for(const [room,ids] of Object.entries(raw.dormSupport??{})){
  requireValue(rooms[room]?.type==='DORMITORY'&&Array.isArray(ids)&&ids.length<=5,'숙소 고정 지원자 설정 오류');requireValue(ids.every(id=>progress[id]),'보유하지 않은 숙소 지원자');dormSupport[room]=[...ids];
 }
 const residents=(raw.residents??[]).map(r=>{requireValue(progress[r.id]&&TYPES.includes(rooms[r.room]?.type),'상주자 설정 오류');return {id:r.id,room:r.room};});
 const fixed=[...Object.values(dormSupport).flat(),...residents.map(r=>r.id)];requireValue(new Set(fixed).size===fixed.length,'고정 인원 중복');
 const candidates={};for(const [room,ids] of Object.entries(raw.candidates??{})){
  requireValue(TYPES.includes(rooms[room]?.type)&&Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.every(id=>progress[id]),'후보 제한 오류');candidates[room]=[...ids].sort();
 }
 return {base:{rooms},progress,products,options,dormSupport,residents,candidates};
}
export function developmentStates(catalog,input){
 const universal=input.options.development==='all-operators';
 const groups=(universal?Object.keys(catalog.characters):Object.keys(input.progress)).sort().map(id=>{
  if(input.options.development==='current')return {id,states:[input.progress[id]]};
  const def=catalog.characters[id],points=[...(def.maxLevels??[1,1,1]).flatMap((n,elite)=>n?[{elite,level:1}]:[]),...def.chains.flat().map(r=>({elite:r.elite,level:r.level}))],unique=new Map();
  for(const p of points.sort((a,b)=>a.elite-b.elite||a.level-b.level)){
   if(def.maxLevels&&(!def.maxLevels[p.elite]||p.level>def.maxLevels[p.elite]))continue;
   const key=p.elite+'|'+def.chains.map(c=>c.filter(r=>p.elite>r.elite||p.elite===r.elite&&p.level>=r.level).at(-1)?.id??'').join('|');if(!unique.has(key))unique.set(key,{owned:true,...p});
  }
  return {id,states:[...(universal?[null]:[]),...unique.values()]};
 });
 if(universal)groups.ownedRange=[input.options.ownedMin,input.options.ownedMax];
 return groups;
}
const scenarioTables=new WeakMap();
function scenarioTable(groups){
 if(scenarioTables.has(groups))return scenarioTables.get(groups);
 const n=groups.length,table=Array.from({length:n+1},()=>Array(n+1).fill(0n));table[n][0]=1n;
 for(let i=n-1;i>=0;i--){const absent=BigInt(groups[i].states.filter(s=>!s).length),present=BigInt(groups[i].states.filter(Boolean).length);for(let k=0;k<=n-i;k++)table[i][k]=absent*table[i+1][k]+(k?present*table[i+1][k-1]:0n);}
 scenarioTables.set(groups,table);return table;
}
export function scenarioCount(groups){if(!groups.ownedRange)return groups.reduce((n,g)=>n*BigInt(g.states.length),1n);const table=scenarioTable(groups),[min,max]=groups.ownedRange;return table[0].slice(min,max+1).reduce((a,b)=>a+b,0n);}
export function scenarioAt(groups,rank){
 requireValue(rank>=0n&&rank<scenarioCount(groups),'육성 시나리오 인덱스 범위 오류');
 const progress={};
 if(!groups.ownedRange){for(let i=groups.length-1;i>=0;i--){const g=groups[i],radix=BigInt(g.states.length),state=g.states[Number(rank%radix)];if(state)progress[g.id]=state;rank/=radix;}return progress;}
 const table=scenarioTable(groups),[min,max]=groups.ownedRange;let count=min;
 for(;count<=max;count++){if(rank<table[0][count])break;rank-=table[0][count];}
 // Group by owned count first; no random sampling or eagerly building all rosters.
 for(let i=0;i<groups.length;i++)for(const state of groups[i].states){const left=count-(state?1:0),ways=left>=0?(table[i+1][left]??0n):0n;if(rank<ways){if(state){progress[groups[i].id]=state;count--;}break;}rank-=ways;}
 return progress;
}
export function buildModel(catalog,input,progress=input.progress,{operatorFactory,workTypes=TYPES}={}){
 const buffs=Object.fromEntries(Object.values(catalog.buffs).map(b=>[b.id,rule(b)])),pool=Object.keys(progress).sort().map(id=>operatorFactory?operatorFactory(catalog.characters[id],progress[id]):({...catalog.characters[id],...progress[id],skills:unlock(catalog.characters[id],progress[id],buffs)}));
 const byId=Object.fromEntries(pool.map(o=>[o.id,o])),warnings=[],excluded=[];
 const cap=r=>r.type==='CONTROL'?r.level:r.type==='DORMITORY'?5:r.type==='MEETING'?2:['POWER','HIRE','TRAINING','WORKSHOP'].includes(r.type)?1:r.level;
 const rooms=Object.entries(input.base.rooms).map(([id,r])=>({id,...r,capacity:cap(r),recipe:r.type==='MANUFACTURE'?catalog.recipes[input.products[id]]:null}));
 const maxFactory=Math.max(0,...rooms.filter(r=>r.type==='MANUFACTURE').map(r=>r.level));
 for(const r of rooms)if(r.recipe)requireValue(r.recipe.unlockLevel<=maxFactory,'생산 품목 개방 조건 미충족');
 const canPlace=(op,r)=>op.skills.some(s=>s.room===r.type)&&!op.skills.some(s=>s.room===r.type&&s.kind==='unsupported');
 const reserved=new Set([...Object.values(input.dormSupport).flat(),...input.residents.map(r=>r.id)]),reservedKeys=new Set([...reserved].map(id=>byId[id].identity??id));requireValue(reservedKeys.size===reserved.size,'고정 인원 사이 동일 오퍼레이터 형태 중복');
 for(const r of rooms.filter(r=>TYPES.includes(r.type)))for(const op of pool){
  const bad=op.skills.filter(s=>s.room===r.type&&s.kind==='unsupported');if(bad.length)excluded.push({id:op.id,name:op.name,room:r.id,skills:bad.map(s=>({id:s.id,name:s.name,description:s.description}))});
 }
 for(const [id,ids] of Object.entries(input.dormSupport))for(const name of ids)requireValue(canPlace(byId[name],rooms.find(r=>r.id===id)),`${byId[name].name}: 숙소 지원 스킬이 없거나 미지원입니다.`);
 const work=rooms.filter(r=>workTypes.includes(r.type)),tasks=[];
 for(const r of work){const fixed=input.residents.filter(x=>x.room===r.id).map(x=>x.id);requireValue(fixed.length<=r.capacity,'상주자 정원 초과');for(const id of fixed)requireValue(canPlace(byId[id],r),'상주자 스킬 없음 또는 미지원');}
 if(input.options.optimizeDormSupport)for(const r of rooms.filter(r=>r.type==='DORMITORY')){const fixed=input.dormSupport[r.id]??[];const candidates=pool.filter(op=>!reservedKeys.has(op.identity??op.id)&&canPlace(op,r)).map(o=>o.id);tasks.push({team:-1,room:r.id,type:r.type,level:r.level,recipe:null,capacity:5-fixed.length,candidates,fixed,symmetryKey:null,identityMap:Object.fromEntries(pool.map(op=>[op.id,op.identity??op.id]))});}
 for(let t=0;t<input.options.teams;t++)for(const r of work){
  const fixed=input.residents.filter(x=>x.room===r.id).map(x=>x.id);
  const candidates=pool.filter(op=>!reservedKeys.has(op.identity??op.id)&&canPlace(op,r)&&(!input.candidates[r.id]||input.candidates[r.id].includes(op.id))).map(o=>o.id);
  tasks.push({team:t,room:r.id,type:r.type,level:r.level,recipe:r.recipe?.id??null,capacity:r.capacity-fixed.length,candidates,fixed,accept:r.type==='MEETING'?ids=>meetingTeamAllowed(ids.map(id=>byId[id]),input.options):null,symmetryKey:fixed.length?null:stable({type:r.type,level:r.level,recipe:r.recipe?.id??null,candidates}),identityMap:Object.fromEntries(pool.map(op=>[op.id,op.identity??op.id]))});
 }
 if(rooms.some(r=>r.type==='MEETING'))warnings.push('응접실 기본 속도·분위기 공식은 검토 중인 실험식입니다. 종류별 확률과 단서 자동 획득은 계산하지 않습니다.');
 if(rooms.some(r=>r.type==='TRADING'))warnings.push('무역소는 순금 거래·재료 충분·교대 시 납품을 가정한 기대 작업량 근사입니다. 품질 우대 없는 기본 분포와 충분히 누적된 분포의 두 시나리오 기대값 범위를 표시합니다. 실제 수익 보장 구간이나 신뢰구간이 아니며 초기 3/5시간의 확률 변화와 개별 주문의 교대 이월을 재현하지 않습니다. 배치 비교는 성숙 시나리오 수익 기준입니다. 고품질 분포는 3레벨의 관측된 조합만 지원합니다.');
 warnings.push('첫 24시간과 첫 교대 사이클만 검사합니다. 반복 운영의 지속 가능성과 실제 게임의 최고 효율을 보장하지 않습니다.');
 if(pool.some(op=>op.skills.some(s=>s.room==='DORMITORY'&&s.kind==='unsupported')))warnings.push('미지원 숙소 스킬을 가진 인원은 자동 휴식 배치에서도 제외합니다. 해당 인원의 회복은 계산하지 않습니다.');
 const ledger=pool.map(op=>({id:op.id,name:op.name,elite:op.elite,level:op.level,unlocked:op.skills.map(s=>({id:s.id,name:s.name,room:s.room,supported:s.kind!=='unsupported'})),locked:op.chains.flat().filter(r=>!(op.elite>r.elite||op.elite===r.elite&&op.level>=r.level)).map(r=>({id:r.id,elite:r.elite,level:r.level,name:catalog.buffs[r.id]?.name??r.id}))}));
 if(input.options.searchStrategy==='bounded')tasks.sort((a,b)=>a.team-b.team||(['HIRE','MEETING','CONTROL','MANUFACTURE','TRADING','POWER'].indexOf(a.type)-['HIRE','MEETING','CONTROL','MANUFACTURE','TRADING','POWER'].indexOf(b.type)));
 return {catalog,input,pool,byId,rooms,work,tasks,excluded,warnings,ledger,canPlace};
}
export function choose(n,k){if(k<0||k>n)return 0n;let v=1n;for(let i=1;i<=k;i++)v=v*BigInt(n-i+1)/BigInt(i);return v;}
export function subsetCount(n,cap){let nTotal=0n;for(let k=0;k<=Math.min(n,cap);k++)nTotal+=choose(n,k);return nTotal;}
export function subsetAt(ids,cap,rank){
 let k=0;while(k<=Math.min(ids.length,cap)){const n=choose(ids.length,k);if(rank<n)break;rank-=n;k++;}
 requireValue(k<=Math.min(ids.length,cap),'조합 인덱스 범위 오류');const result=[];let start=0;
 for(let left=k;left>0;left--)for(let i=start;i<=ids.length-left;i++){const n=choose(ids.length-i-1,left-1);if(rank<n){result.push(ids[i]);start=i+1;break;}rank-=n;}
 return result;
}
export class Enumerator{
 constructor(model,state){this.model=model;this.prunedByBound=BigInt(state?.prunedByBound??0);this.incumbent=null;this.tables=model.facilityTables??new Map();this.tasks=model.tasks;this.symmetry=model.symmetry!==false;this.cache=model.candidateCache??new Map();this.cacheHits=0;this.symmetryPruned=BigInt(state?.symmetryPruned??0);this.previous=this.tasks.map((t,i)=>this.tasks.slice(0,i).findLastIndex(p=>this.symmetry&&t.symmetryKey&&p.team===t.team&&p.symmetryKey===t.symmetryKey));this.key=id=>this.tasks[0]?.identityMap?.[id]??id;this.limits=this.tasks.map(t=>subsetCount(t.candidates.length,t.capacity));this.depth=state?.depth??0;this.cursor=(state?.cursor??this.tasks.map(()=>0)).map(BigInt);this.selected=state?.selected?.map(x=>[...x])??this.tasks.map(()=>[]);this.done=state?.done??false;this.nodes=BigInt(state?.nodes??0);this.visited=BigInt(state?.visited??0);this.used=new Set(this.selected.slice(0,this.depth).flat().map(this.key));}
 snapshot(){return {prunedByBound:String(this.prunedByBound),depth:this.depth,cursor:this.cursor.map(String),selected:this.selected.map(x=>[...x]),done:this.done,nodes:String(this.nodes),visited:String(this.visited),symmetryPruned:String(this.symmetryPruned)};}
 upperBound(){return this.limits.reduce((a,b)=>a*b,1n);}
 advance(maxNodes=10000){
  if(this.done)return {done:true};let steps=0;
  const back=()=>{this.depth--;if(this.depth>=0)for(const id of this.selected[this.depth])this.used.delete(this.key(id));else this.done=true;};
  while(steps++<maxNodes){
   if(this.incumbent){const best=this.incumbent();if(best){const upper=officeUpperBound(this.model,this.selected,this.depth);if(upper!==null&&upper<best[0]-1e-7){this.prunedByBound++;back();if(this.done)return {done:true};continue;}}}
   if(this.depth===this.tasks.length){const all=this.tasks.map((t,i)=>({team:t.team,room:t.room,operators:[...t.fixed,...this.selected[i]]})),groups=all.filter(t=>t.team>=0),dormSupport=Object.fromEntries(all.filter(t=>t.team<0).map(t=>[t.room,t.operators]));this.visited++;back();return {plan:{groups,...(all.some(t=>t.team<0)?{dormSupport}:{})},done:false};}
   const i=this.depth;if(this.cursor[i]>=this.limits[i]){this.cursor[i]=0n;this.selected[i]=[];back();if(this.done)return {done:true};continue;}
   const rank=this.cursor[i]++,task=this.tasks[i];let ids;if(task.type&&this.model.byId){const tableKey=task.tableKey??=candidateTableKey(task,this.model);let table=this.tables.get(tableKey);if(!table){table=new FacilityCandidates(task,this.model);if(this.tables.size>=32)this.tables.delete(this.tables.keys().next().value);this.tables.set(tableKey,table);}const hits=table.hits;ids=table.get(rank,subsetAt).operators;this.cacheHits+=table.hits-hits;}else{ids=subsetAt(task.candidates,task.capacity,rank);}this.nodes++;
   const previous=this.previous[i];if(previous>=0){let order=0;for(let team=0;team<=task.team;team++){const a=this.tasks.findIndex(t=>t.team===team&&t.room===this.tasks[previous].room),b=this.tasks.findIndex(t=>t.team===team&&t.room===task.room);const left=stable(this.selected[a]),right=stable(b===i?ids:this.selected[b]);if(left!==right){order=left<right?-1:1;break;}}if(order>0){this.symmetryPruned++;continue;}}
   if(new Set(ids.map(this.key)).size!==ids.length||ids.some(id=>this.used.has(this.key(id)))||task.accept&&!task.accept([...task.fixed,...ids]))continue;this.selected[i]=ids;for(const id of ids)this.used.add(this.key(id));this.depth++;if(this.depth<this.tasks.length)this.cursor[this.depth]=0n;
  }
  return {yield:true};
 }
}
const emptyTotals=()=>({F_GOLD:0,F_EXP:0,F_DIAMOND:0});
export function simulate(model,plan,{record=false}={}){
 const {pool,byId,work,rooms}=model,input={...model.input,dormSupport:plan.dormSupport??model.input.dormSupport},o=input.options,morale=Object.fromEntries(pool.map(p=>[p.id,p.maxMorale])),worked=Object.fromEntries(pool.map(p=>[p.id,0])),totals=emptyTotals(),collected=emptyTotals(),inventory=Object.fromEntries(work.filter(r=>r.recipe).map(r=>[r.id,{count:0,progress:0}])),events=[],tradeAssumptions=new Set(),residentIds=new Set(input.residents.map(r=>r.id));
 // Validate external plans as rigorously as generated ones.
 const supports=Object.entries(input.dormSupport),supportIds=supports.flatMap(([,ids])=>ids);requireValue(new Set(supportIds.map(id=>byId[id]?.identity??id)).size===supportIds.length,'숙소 지원자 중복');for(const [room,ids]of supports){const r=rooms.find(r=>r.id===room);requireValue(r?.type==='DORMITORY'&&ids.length<=5&&ids.every(id=>byId[id]&&model.canPlace(byId[id],r)),'숙소 지원자 스킬/정원 오류');for(const fixed of model.input.dormSupport[room]??[])requireValue(ids.includes(fixed),'고정 숙소 지원자 누락');}
 for(const [room,ids] of Object.entries(model.input.dormSupport))for(const id of ids)requireValue((input.dormSupport[room]??[]).includes(id),'고정 숙소 지원자 누락');
 const supportKeys=new Set(supportIds.map(id=>byId[id].identity??id));
 const used=new Set();requireValue(plan.groups.length===work.length*o.teams,'배치 그룹 수 오류');
 for(let t=0;t<o.teams;t++){const seen=new Set();for(const r of work){const gs=plan.groups.filter(g=>g.team===t&&g.room===r.id);requireValue(gs.length===1,'배치 시설 누락/중복');const ids=gs[0].operators;requireValue(ids.length<=r.capacity&&new Set(ids).size===ids.length,'정원/인원 중복');if(r.type==='MEETING')requireValue(meetingTeamAllowed(ids.map(id=>byId[id]).filter(Boolean),o),'응접실은 미보유 단서 담당 최대 1명과 속도 스킬 인원으로 구성해야 합니다.');for(const id of ids){requireValue(byId[id]&&model.canPlace(byId[id],r),'스킬 없는 배치 또는 미지원 배치');requireValue(!seen.has(byId[id].identity??id)&&(!used.has(byId[id].identity??id)||residentIds.has(id)),'동시/교대조 인원 중복');requireValue(!supportKeys.has(byId[id].identity??id),'숙소 지원자 근무 중복');if(residentIds.has(id))requireValue(input.residents.some(x=>x.id===id&&x.room===r.id),'상주 시설 불일치');seen.add(byId[id].identity??id);used.add(byId[id].identity??id);}for(const resident of input.residents.filter(x=>x.room===r.id))requireValue(ids.includes(resident.id),'상주자 누락');}}
 const tradeTotals={lmd:0,gold:0,orders:0},tradeCollected={lmd:0,gold:0,orders:0},tradeInventory=Object.fromEntries(work.filter(r=>r.type==='TRADING').map(r=>[r.id,{lmd:0,gold:0,orders:0}]));
 const baselineTotals={lmd:0,gold:0,orders:0},baselineCollected={lmd:0,gold:0,orders:0},baselineInventory=structuredClone(tradeInventory);
 const collectBaseline=()=>{for(const state of Object.values(baselineInventory))for(const k of ['lmd','gold','orders']){baselineCollected[k]+=state[k];state[k]=0;}};
 const collectTrade=()=>{collectBaseline();for(const s of Object.values(tradeInventory))for(const k of ['lmd','gold','orders']){tradeCollected[k]+=s[k];s[k]=0;}};
 let clock=0,team=0,shiftStart=0,completedShifts=0,placements=[],officeHours=0,meetingHours=0,preferenceHours=0,droneRecovered=0,at24=null,cycle=null,status='ok',reason='',steps=0,lastAssignments=new Map();
 const log=(type,extra={})=>{if(record)events.push({hour:clock,type,...extra});};
 function rest(previous){
  const w=work.map(r=>({room:r,ops:plan.groups.find(g=>g.team===team&&g.room===r.id).operators.map(id=>byId[id])})),busy=new Set(w.flatMap(p=>p.ops.map(x=>x.id))),reserved=new Set(Object.values(input.dormSupport).flat()),distance=new Map();
  for(let j=1;j<o.teams;j++)for(const g of plan.groups.filter(g=>g.team===(team+j)%o.teams))for(const id of g.operators)if(!distance.has(id))distance.set(id,j);
  const waiting=pool.filter(op=>!busy.has(op.id)&&!reserved.has(op.id)&&morale[op.id]<op.maxMorale-EPS&&!skills(op,'DORMITORY').some(s=>s.kind==='unsupported')).sort((a,b)=>(distance.get(a.id)??99)-(distance.get(b.id)??99)||morale[a.id]-morale[b.id]||a.id.localeCompare(b.id));
  const filled=new Set(busy),dorms=[];
  for(const r of rooms.filter(r=>r.type==='DORMITORY')){
   const ids=[...(input.dormSupport[r.id]??[])];for(const id of ids){requireValue(!filled.has(id),'宿소 지원자 중복');filled.add(id);}
   // Keep existing resting order until a bed is needed and its occupant has recovered.
   for(const op of previous?.find(p=>p.room.id===r.id)?.ops??[]){if(ids.length>=r.capacity)break;if(filled.has(op.id))continue;const need=waiting.some(v=>!filled.has(v.id)&&v.id!==op.id);if(morale[op.id]<op.maxMorale-EPS||!need){ids.push(op.id);filled.add(op.id);}}
   for(const op of waiting){if(ids.length>=r.capacity)break;if(!filled.has(op.id)){ids.push(op.id);filled.add(op.id);}}
   dorms.push({room:r,ops:ids.map(id=>byId[id])});
  }
  const placed=[...w,...dorms];
  if(model.restOptimizer&&(!previous||stable(previous.filter(p=>p.room.type==='DORMITORY').map(p=>p.ops.map(o=>o.id)))!==stable(dorms.map(p=>p.ops.map(o=>o.id)))))return model.restOptimizer(model,placed,morale,worked,{reserved,distance,waiting});
  return placed;
 }
 function enter(){placements=rest();const assignments=new Map(placements.flatMap(p=>p.ops.map(op=>[op.id,p.room.id])));for(const op of pool)if(lastAssignments.get(op.id)!==assignments.get(op.id))worked[op.id]=0;lastAssignments=assignments;log('shift',{team,rooms:placements.map(p=>({id:p.room.id,operators:p.ops.map(x=>x.id)}))});}
 function exchange(){for(const p of placements.filter(p=>p.room.type==='DORMITORY')){const target=p.ops.at(-1);if(!target)continue;const provider=p.ops.find(op=>skills(op,'DORMITORY').some(s=>s.kind==='exchange')&&morale[op.id]>=op.maxMorale-EPS);if(provider&&provider.id!==target.id&&morale[target.id]<target.maxMorale-EPS){const old=morale[target.id];morale[target.id]=morale[provider.id];morale[provider.id]=old;log('exchange',{room:p.room.id,provider:provider.id,target:target.id});}}}
 function resultPoint(){const pending=emptyTotals();for(const [id,s] of Object.entries(inventory)){const recipe=rooms.find(r=>r.id===id).recipe;pending[recipe.category]+=recipe.category==='F_EXP'?s.count/recipe.count*recipe.xp:s.count;}
  return {hour:clock,produced:{...totals},collected:{...collected},pending,inventory:structuredClone(inventory),trade:{model:model.engineVersion?'terra27-efficiency-scenarios':TRADE_MODEL,estimated:true,...(model.engineVersion?{assumptions:[...tradeAssumptions]}:{}),generated:{...tradeTotals},collected:{...tradeCollected},pending:structuredClone(tradeInventory),hourlyLmd:tradeTotals.lmd/clock,rangeKind:'baseline-versus-mature-scenario-expectations',confidenceLevel:null,rankingBasis:'mature',range:{generatedLmd:[Math.min(baselineTotals.lmd,tradeTotals.lmd),Math.max(baselineTotals.lmd,tradeTotals.lmd)],collectedLmd:[Math.min(baselineCollected.lmd,tradeCollected.lmd),Math.max(baselineCollected.lmd,tradeCollected.lmd)]},baseline:{generated:{...baselineTotals},collected:{...baselineCollected}}},officeEquivalentHours:officeHours,meetingEquivalentHours:meetingHours,missingSkillPolicyHours:preferenceHours,morale:{...morale},hourly:{office:officeHours/clock,meeting:meetingHours/clock,products:Object.fromEntries(CATS.map(k=>[k,totals[k]/clock]))},completedShifts,...(model.engineVersion?{drones:{recovered:droneRecovered,used:0,storageCapApplied:false}}:{})};}
 enter();exchange();
 while(clock<o.maxHours-EPS&&steps++<100000){
  const snap=snapshot(model,placements,morale,worked,{clock,inventory,tradeInventory});for(const f of snap.trading)if(f.approximation)tradeAssumptions.add(f.approximation);if([...residentIds].some(id=>snap.rates[id]<-EPS)){status='invalid';reason='상주자의 무소모 조건이 유지되지 않습니다.';break;}
  const rotating=placements.filter(p=>p.room.type!=='DORMITORY').flatMap(p=>p.ops).filter(op=>!residentIds.has(op.id)),depleting=rotating.filter(op=>snap.rates[op.id]<-EPS||morale[op.id]<=EPS);
  const rotate=o.rotation==='12h'?clock-shiftStart>=12-EPS:o.rotation==='first'?depleting.some(op=>morale[op.id]<=EPS):depleting.length>0&&depleting.every(op=>morale[op.id]<=EPS);
  if(rotate){
   if(clock-shiftStart<EPS){status='invalid';reason='회복 부족으로 0시간 재교대가 필요합니다.';break;}
   for(const [id,s] of Object.entries(inventory)){const recipe=rooms.find(r=>r.id===id).recipe;collected[recipe.category]+=recipe.category==='F_EXP'?s.count/recipe.count*recipe.xp:s.count;s.count=0;}
   collectTrade();completedShifts++;log('collection');if(Math.abs(clock-24)<EPS)at24=resultPoint();if(completedShifts===o.teams)cycle=resultPoint();
   if(at24&&cycle)break;team=(team+1)%o.teams;shiftStart=clock;enter();exchange();continue;
  }
  if(at24&&cycle)break;
  // If no worker can ever trigger a depletion shift, a cycle is undefined, not forced to 12h.
  const noCycle=o.rotation!=='12h'&&!depleting.length;
  let dt=Math.min(o.maxHours-clock,Math.floor(clock+EPS)+1-clock,at24?Infinity:24-clock,o.rotation==='12h'?12-(clock-shiftStart):Infinity);
  if(snap.stepHours)dt=Math.min(dt,snap.stepHours);
  if(snap.nextChangeHours>EPS)dt=Math.min(dt,snap.nextChangeHours);
  for(const [id,thresholds] of Object.entries(snap.thresholds??{}))for(const threshold of thresholds){const rate=snap.rates[id],distance=(threshold-morale[id])/rate;if(Number.isFinite(distance)&&distance>EPS)dt=Math.min(dt,distance);}
  for(const op of pool){const rate=snap.rates[op.id];if(rate< -EPS&&morale[op.id]>EPS)dt=Math.min(dt,morale[op.id]/-rate);if(rate>EPS&&morale[op.id]<op.maxMorale-EPS)dt=Math.min(dt,(op.maxMorale-morale[op.id])/rate);}
  for(const f of snap.factories){const s=inventory[f.room.id],r=f.room.recipe;if(f.multiplier>EPS&&s.count*r.weight<f.capacity-EPS)dt=Math.min(dt,(r.seconds-s.progress)/(f.multiplier*3600));}
  for(const f of snap.trading){const s=tradeInventory[f.room.id];if(f.multiplier>EPS&&s.orders<f.capacity-EPS)dt=Math.min(dt,(f.capacity-s.orders)*f.order.seconds/(f.multiplier*3600));}
  if(!(dt>EPS)&&!(Math.abs(clock-24)<EPS&&!at24)){status='invalid';reason='시간 진행이 불가능한 상태입니다.';break;}
  for(const f of snap.factories){const s=inventory[f.room.id],r=f.room.recipe;if(s.count*r.weight>=f.capacity-EPS)continue;s.progress+=dt*f.multiplier*3600;if(s.progress>=r.seconds-EPS){s.progress=Math.max(0,s.progress-r.seconds);s.count+=r.count;totals[r.category]+=r.category==='F_EXP'?r.xp:r.count;log('product',{room:f.room.id,category:r.category,amount:r.category==='F_EXP'?r.xp:r.count});}}
  for(const f of snap.trading){const s=tradeInventory[f.room.id],orders=Math.max(0,Math.min(f.capacity-s.orders,dt*f.multiplier*3600/f.order.seconds));for(const [k,v] of Object.entries({orders,gold:orders*f.order.gold,lmd:orders*f.order.lmd})){s[k]+=v;tradeTotals[k]+=v;}}
  for(const f of snap.trading){const state=baselineInventory[f.room.id],orders=Math.max(0,Math.min(f.capacity-state.orders,dt*(f.baselineMultiplier??f.multiplier)*3600/f.baselineOrder.seconds));for(const [k,v] of Object.entries({orders,gold:orders*f.baselineOrder.gold,lmd:orders*f.baselineOrder.lmd})){state[k]+=v;baselineTotals[k]+=v;}}
  if(snap.power)droneRecovered+=dt*10*Math.max(0,1+snap.power.reduce((n,f)=>n+f.bonus,0));
  officeHours+=dt*snap.offices.reduce((n,f)=>n+f.multiplier,0);meetingHours+=dt*snap.meetings.reduce((n,f)=>n+f.multiplier,0);preferenceHours+=dt*snap.meetings.reduce((n,f)=>n+f.preference,0);
  for(const op of pool)morale[op.id]=Math.max(0,Math.min(op.maxMorale,morale[op.id]+snap.rates[op.id]*dt));for(const p of placements.filter(p=>p.room.type!=='DORMITORY'))for(const op of p.ops)worked[op.id]+=dt;clock+=dt;
  if(Math.abs(clock-24)<EPS&&!at24){at24=resultPoint();log('24h');}
  if(noCycle&&at24){reason='소진 교대 사건이 없어 첫 사이클 완료 시점을 정의할 수 없습니다.';break;}
  if(o.extraActions){const next=rest(placements);if(stable(next.map(p=>p.ops.map(x=>x.id)))!==stable(placements.map(p=>p.ops.map(x=>x.id)))){placements=next;log('dormChange',{rooms:placements.filter(p=>p.room.type==='DORMITORY').map(p=>({id:p.room.id,operators:p.ops.map(x=>x.id)}))});}exchange();}
 }
 // A shift boundary coinciding with the safety cap is a real completed event.
 if(!cycle&&clock>=o.maxHours-EPS){const s=snapshot(model,placements,morale,worked,{clock,inventory,tradeInventory}),rot=placements.filter(p=>p.room.type!=='DORMITORY').flatMap(p=>p.ops).filter(op=>!residentIds.has(op.id)&&(s.rates[op.id]<-EPS||morale[op.id]<=EPS));const boundary=o.rotation==='12h'?clock-shiftStart>=12-EPS:o.rotation==='first'?rot.some(op=>morale[op.id]<=EPS):rot.length&&rot.every(op=>morale[op.id]<=EPS);if(boundary&&completedShifts+1===o.teams){for(const [id,state] of Object.entries(inventory)){const recipe=rooms.find(r=>r.id===id).recipe;collected[recipe.category]+=recipe.category==='F_EXP'?state.count/recipe.count*recipe.xp:state.count;state.count=0;}completedShifts++;if(Math.abs(clock-24)<EPS)at24=resultPoint();cycle=resultPoint();}}
 if(cycle&&clock>=o.maxHours-EPS){collectTrade();cycle=resultPoint();if(Math.abs(clock-24)<EPS)at24=resultPoint();}
 if(!at24&&Math.abs(clock-24)<EPS)at24=resultPoint();
 if(!cycle&&!reason)reason='첫 사이클이 검사 상한 내에 완료되지 않았습니다.';
 return {status,reason,at24,cycle,cycleStatus:cycle?'completed':'unresolved',endHour:clock,endMorale:morale,events:record?events:undefined};
}
export function score(model,result){const p=model.input.options.rankingWindow==='cycle'?result.cycle:result.at24;if(result.status!=='ok'||!p)return null;const v=[p.hourly.office,p.missingSkillPolicyHours/p.hour,p.hourly.meeting,...model.input.options.priority.map(k=>p.hourly.products[k])];if(model.work.some(r=>r.type==='TRADING'))v.push(p.trade.hourlyLmd);return v;}
export function compare(a,b){for(let i=0;i<a.length;i++){if(Math.abs(a[i]-b[i])>1e-8)return Math.sign(a[i]-b[i]);}return 0;}
