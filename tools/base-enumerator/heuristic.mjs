// Independent implementation of a facility-greedy, seeded, local-improvement
// search. The optional Terra adapter supplies third-party skill evaluation.
import {Enumerator,simulate,score,compare,subsetCount,stable} from './core.mjs';
import {snapshot} from './evaluator.mjs';

export const HEURISTIC_VERSION='facility-seeded-search-1';
const special=new Set(['bubble','vermeil','automation','quality','tradeOverride','tradePayout','missing','globalMissing','solo','hireThreshold','hireElite','mlynar','ccFaction','globalDorm','exchange']);
const identity=(model,id)=>model.byId[id].identity??id;
const same=(a,b)=>stable(a)===stable(b);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
function supportMerit(model,ids){
 const ss=ids.flatMap(id=>model.byId[id].skills.filter(s=>s.room==='DORMITORY'));
 return Math.max(0,...ss.filter(s=>['allRest','selfAllRest'].includes(s.kind)).map(s=>s.amount??0))*4+
  Math.max(0,...ss.filter(s=>['singleRest','selfSingleRest'].includes(s.kind)).map(s=>s.amount??0))+
  (ss.some(s=>s.kind==='exchange')?.1:0);
}
export function toPlan(model,selection){
 const rows=model.tasks.map((t,i)=>({team:t.team,room:t.room,operators:[...t.fixed,...selection[i]]}));
 return {groups:rows.filter(r=>r.team>=0),...(rows.some(r=>r.team<0)?{dormSupport:Object.fromEntries(rows.filter(r=>r.team<0).map(r=>[r.room,r.operators]))}:{})};
}
export function validSelection(model,selection){
 if(selection.length!==model.tasks.length)return false;
 const used=new Set();
 for(let i=0;i<selection.length;i++){
  const t=model.tasks[i],ids=selection[i];
  if(ids.length>t.capacity||ids.some(id=>!t.candidates.includes(id))||t.accept&&!t.accept([...t.fixed,...ids]))return false;
  for(const id of ids){const k=identity(model,id);if(used.has(k))return false;used.add(k);}
 }
 return true;
}

// This ranks construction moves only. Winners are always checked with simulate.
// It is neither an admissible bound nor a replacement for fatigue simulation.
function proxy(model,selection,teamCache){
 const plan=toPlan(model,selection),support=plan.dormSupport??model.input.dormSupport;
 const out=[0,0,0,0,0,0,...(model.work.some(r=>r.type==='TRADING')?[0]:[]),0,0];
 const teams=model.input.options.rankingWindow==='24h'?Math.min(2,model.input.options.teams):model.input.options.teams;
 for(let team=0;team<model.input.options.teams;team++){
  const placements=model.work.map(room=>({room,ops:plan.groups.find(g=>g.team===team&&g.room===room.id).operators.map(id=>model.byId[id])}));
  for(const room of model.rooms.filter(r=>r.type==='DORMITORY'))placements.push({room,ops:(support[room.id]??[]).map(id=>model.byId[id])});
  const pool=placements.flatMap(p=>p.ops),morale=Object.fromEntries(pool.map(op=>[op.id,op.maxMorale]));
  const key=JSON.stringify(placements.map(p=>[p.room.id,p.ops.map(op=>op.id)]));let snap=teamCache.get(key);
  if(!snap){snap=snapshot({...model,pool,snapshotCache:null},placements,morale,Object.fromEntries(pool.map(op=>[op.id,6])));if(teamCache.size>=1024)teamCache.delete(teamCache.keys().next().value);teamCache.set(key,snap);}
  // With a 24h ranking, a third 12h crew starts later. Build that crew as a
  // tie-break only; never let its estimate outrank the reported 24h score.
  if(team>=teams){out[out.length-1]+=[...snap.offices,...snap.meetings,...snap.factories,...snap.trading].reduce((n,r)=>n+r.multiplier,0);continue;}
  out[0]+=snap.offices.reduce((n,f)=>n+f.multiplier,0)/teams;
  out[1]+=snap.meetings.reduce((n,f)=>n+f.preference,0)/teams;
  out[2]+=snap.meetings.reduce((n,f)=>n+f.multiplier,0)/teams;
  for(const f of snap.factories){const r=f.room.recipe,index=model.input.options.priority.indexOf(r.category);
   const count=Math.min(12*f.multiplier*3600/r.seconds,Math.floor(f.capacity/(r.count*r.weight)));
   out[3+index]+=count*(r.category==='F_EXP'?r.xp:r.count)/12/teams;
  }
  if(out.length===9)out[6]+=snap.trading.reduce((n,f)=>n+Math.min(12*f.multiplier*3600/f.order.seconds,f.capacity)*f.order.lmd/12,0)/teams;
  out[out.length-2]-=pool.reduce((n,op)=>n+Math.max(0,-snap.rates[op.id]*12-op.maxMorale),0)/teams;
  out[out.length-1]+=placements.filter(p=>p.room.type==='POWER').reduce((n,p)=>n+p.ops.flatMap(op=>op.skills.filter(s=>s.room==='POWER')).reduce((v,s)=>v+(s.prod??0),0),0)/teams;
  out[out.length-1]+=placements.filter(p=>p.room.type==='CONTROL').reduce((n,p)=>n+p.ops.flatMap(op=>op.skills.filter(s=>s.room==='CONTROL')).reduce((v,s)=>v+(['ccRecovery','ccFaction','globalDorm','ccProd'].includes(s.kind)?s.amount??0:0),0),0)/teams;
  out[out.length-1]+=(snap.roleMerit??0)/teams;
 }
 out[out.length-1]+=Object.values(support).reduce((n,ids)=>n+supportMerit(model,ids),0);
 return out;
}
function heuristicWeight(model,task,id){
 const op=model.byId[id],ss=op.skills.filter(s=>s.room===task.type),prod=ss.reduce((n,s)=>n+(s.prod??0)+(s.amount??0)+(s.kind==='ramp'?s.max??0:0)+(s.cap??0)*.02,0);
 return prod+(task.type==='MEETING'?op.elite*.08+(op.rarity>=4?(op.rarity-2)*.01:0):0);
}
export function shortlist(model,task,top=40){
 const ranked=[...task.candidates].sort((a,b)=>heuristicWeight(model,task,b)-heuristicWeight(model,task,a)||a.localeCompare(b));
 const chosen=new Set(ranked.slice(0,top));
 for(const id of ranked)if(model.byId[id].skills.some(s=>s.room===task.type&&(s.linked||special.has(s.kind)||s.cap||s.tradeLimit||s.roomDrain||s.drain<0||s.kind==='allRest'||s.kind==='singleRest'||s.kind==='selfAllRest'||s.kind==='selfSingleRest')))chosen.add(id);
 return [...chosen];
}
function anchors(model,task,candidates,variant){
 const roots=[[]],families=new Set();
 for(const id of candidates){const ss=model.byId[id].skills.filter(s=>s.room===task.type);
  const keys=ss.filter(s=>special.has(s.kind)||s.linked).map(s=>s.linked?'linked:'+s.id:[s.kind,s.group??'',s.kind==='quality'?s.quality:''].join(':'));
  if(keys.some(key=>!families.has(key))){roots.push([id]);for(const key of keys)families.add(key);}
  for(const s of ss)if(s.terra?.partners?.length){const group=[id,...s.terra.partners];if(group.every(x=>candidates.includes(x)))roots.push(group);}
 }
 if(task.type==='MANUFACTURE')for(const id of candidates.filter(id=>model.byId[id].skills.some(s=>['bubble','vermeil'].includes(s.kind)))){
  const capacity=candidates.filter(x=>x!==id).sort((a,b)=>model.byId[b].skills.reduce((n,s)=>n+(s.cap??0),0)-model.byId[a].skills.reduce((n,s)=>n+(s.cap??0),0));
  roots.push([id,...capacity.slice(0,Math.max(0,task.capacity-1))]);
 }
 if(task.type==='TRADING'){
  const packageIds=candidates.filter(id=>model.byId[id].skills.some(s=>s.room==='TRADING'&&['tradeOverride','tradePayout','quality'].includes(s.kind)));
  for(let i=0;i<packageIds.length;i++)for(let j=i+1;j<packageIds.length;j++)roots.push([packageIds[i],packageIds[j]]);
 }
 // Rotate roots across starts so one popular package cannot monopolize the budget.
 return [...new Map(roots.filter(r=>r.length<=task.capacity).map(r=>[[...r].sort().join('|'),r])).values()].sort((a,b)=>variant%2?b.length-a.length:a.length-b.length);
}

export function solveHeuristic(model,{maxMilliseconds=10000,maxEvaluations=10000,starts=2,rounds=8,topCandidates=40,exactThreshold=10000,onProgress=()=>{}}={}){
 requireValue(model.input.options.development==='current','현재 보유·육성 조건만 지원합니다. 전체 보유 조건 열거는 실행하지 않습니다.');
 for(const [name,value,min,max] of [['maxMilliseconds',maxMilliseconds,1,300000],['maxEvaluations',maxEvaluations,1,1000000],['starts',starts,1,16],['rounds',rounds,0,30],['topCandidates',topCandidates,1,400],['exactThreshold',exactThreshold,0,100000]])requireValue(Number.isFinite(value)&&value>=min&&value<=max&&(name==='maxMilliseconds'||Number.isInteger(value)),`${name}: 범위 오류`);
 const begin=performance.now(),end=begin+maxMilliseconds,stats={simulations:0,proxyEvaluations:0,invalidPlans:0,evaluationErrors:0,cacheHits:0,startsCompleted:0,improvementRounds:0,acceptedMoves:0},errors=[],seenErrors=new Set();
 model.controlEffectsCache??=new Map();
 const empty=model.tasks.map(()=>[]),cache=new Map(),proxyCache=new Map(),teamCache=new Map();let best=null,bestSelection=null,bestTie=null,stopped=null;
 const timedOut=()=>{if(performance.now()>=end){stopped='time-budget';return true;}return false;};
 const stoppedEvaluation=()=>timedOut()||(stats.simulations>=maxEvaluations&&(stopped='evaluation-budget'));
 const notify=phase=>onProgress({phase,elapsedMs:performance.now()-begin,...stats,bestScore:best?.score??null});
 const evaluate=selection=>{
  if(stoppedEvaluation())return null;
  const key=stable(selection);if(cache.has(key)){stats.cacheHits++;return cache.get(key);}
  if(!validSelection(model,selection))return null;
  stats.simulations++;let value=null;
  try{const plan=toPlan(model,selection),result=simulate(model,plan),v=score(model,result);
   if(v){value={plan,score:v,...result};const tie=estimate(selection),delta=best?compare(v,best.score):1;
    if(delta>0||delta===0&&tie&&(!bestTie||compare(tie,bestTie)>0)){best=value;bestTie=tie;bestSelection=selection.map(ids=>[...ids]);}}
   else stats.invalidPlans++;
  }catch(e){stats.evaluationErrors++;if(!seenErrors.has(e.message)){seenErrors.add(e.message);errors.push(e.message);}}
  if(cache.size>=2048)cache.delete(cache.keys().next().value);cache.set(key,value);return value;
 };
 const estimate=selection=>{
  if(timedOut()||!validSelection(model,selection))return null;
  const key=stable(selection);if(proxyCache.has(key))return proxyCache.get(key);
  stats.proxyEvaluations++;let value=null;try{value=proxy(model,selection,teamCache);}catch{/* Unsupported quality/level combination is not a candidate. */}
  if(proxyCache.size>=1024)proxyCache.delete(proxyCache.keys().next().value);proxyCache.set(key,value);return value;
 };
 const candidates=model.tasks.map(t=>shortlist(model,t,topCandidates));
 const upper=model.tasks.reduce((n,t)=>n*subsetCount(t.candidates.length,t.capacity),1n);
 let complete=false;
 // Small-instance oracle is explicit and bounded; large rosters never enter it.
 if(upper<=BigInt(exactThreshold)){
  const iterator=new Enumerator({...model,symmetry:false});
  while(!stoppedEvaluation()){
   const next=iterator.advance(100);if(next.done){complete=true;break;}if(!next.plan)continue;
   const selection=model.tasks.map(t=>{const ids=t.team<0?next.plan.dormSupport[t.room]:next.plan.groups.find(g=>g.team===t.team&&g.room===t.room).operators;return ids.filter(id=>!t.fixed.includes(id));});
   evaluate(selection);
  }
  notify('small-exact-finished');
 }else{
  evaluate(empty);
  const construct=(selection,index,variant)=>{
   const task=model.tasks[index],available=candidates[index].filter(id=>!selection.some((ids,i)=>i!==index&&ids.some(x=>identity(model,x)===identity(model,id))));
   let chosen=selection[index],chosenScore=estimate(selection);
   const roots=anchors(model,task,available,variant);
   for(const root of roots){
    if(timedOut())break;let ids=[...root],trial=selection.map((s,i)=>i===index?ids:s),value=estimate(trial);if(!value)continue;
    // Grow only when the actual composition proxy improves, preserving solo teams.
    for(let seat=ids.length;seat<task.capacity;seat++){
     let move=null,moveValue=value;
     for(const id of available){if(timedOut())break;if(ids.includes(id))continue;
      const next=[...ids,id],test=estimate(selection.map((s,i)=>i===index?next:s));
      if(test&&compare(test,moveValue)>0){move=next;moveValue=test;}
     }
     if(!move)break;ids=move;value=moveValue;
    }
    if(!chosenScore||compare(value,chosenScore)>0){chosen=[...ids];chosenScore=value;}
   }
   selection[index]=chosen;
  };
  let improvementOrder=[];
  for(let variant=0;variant<starts&&!stoppedEvaluation();variant++){
   let selection=variant&&bestSelection?bestSelection.map(ids=>[...ids]):empty.map(()=>[]);
   if(variant&&variant%2===1)selection=empty.map(()=>[]);
   if(variant&&model.startingSelections?.length)selection=model.startingSelections[(variant-1)%model.startingSelections.length].map(ids=>[...ids]);
   const types=variant%2?['CONTROL','HIRE','MEETING','MANUFACTURE','TRADING','POWER','TRAINING','WORKSHOP','DORMITORY']:['HIRE','MEETING','CONTROL','MANUFACTURE','TRADING','POWER','TRAINING','WORKSHOP','DORMITORY'];
   const order=model.tasks.map((_,i)=>i).sort((a,b)=>types.indexOf(model.tasks[a].type)-types.indexOf(model.tasks[b].type)||(variant%3===2?model.tasks[b].team-model.tasks[a].team:model.tasks[a].team-model.tasks[b].team)||a-b);
   if(!variant)improvementOrder=order;
   for(const index of order){if(stoppedEvaluation())break;construct(selection,index,variant);evaluate(selection);}
   if(!timedOut()){evaluate(selection);stats.startsCompleted++;notify('constructed');}
  }
  let selection=bestSelection?.map(ids=>[...ids]);
   for(let round=0;round<rounds&&!stoppedEvaluation()&&bestSelection;round++){
    const before=bestSelection.map(ids=>[...ids]);let improved=false;
    // Rebuild one facility, then allow two-facility exchanges to escape greedy traps.
    for(const index of improvementOrder){
     if(stoppedEvaluation())break;
     const trial=selection.map(ids=>[...ids]);construct(trial,index,round);evaluate(trial);
     const old=[...selection[index]],moves=[];
     for(let seat=-1;seat<old.length&&!stoppedEvaluation();seat++){
      const targets=[null,...candidates[index]];
      for(const incoming of targets){
       if(stoppedEvaluation())break;if(seat<0&&(incoming===null||old.length>=model.tasks[index].capacity))continue;
       if(incoming!==null&&old.includes(incoming))continue;
       const move=selection.map(ids=>[...ids]),outgoing=seat<0?null:old[seat];
       if(seat>=0)move[index].splice(seat,1);
       if(incoming!==null){
        const source=move.findIndex((ids,i)=>i!==index&&ids.some(id=>identity(model,id)===identity(model,incoming)));
        if(source>=0){const pos=move[source].findIndex(id=>identity(model,id)===identity(model,incoming));
         // Different forms share identity, but are never silently substituted.
         if(move[source][pos]!==incoming)continue;
         move[source].splice(pos,1);if(outgoing!==null&&model.tasks[source].candidates.includes(outgoing))move[source].push(outgoing);
        }
        move[index].push(incoming);
       }
       const value=estimate(move);if(value){moves.push({move,value});moves.sort((a,b)=>compare(b.value,a.value));if(moves.length>6)moves.pop();}
      }
     }
     for(const {move} of moves){if(stoppedEvaluation())break;evaluate(move);}
     if(!same(bestSelection,selection)){selection=bestSelection.map(ids=>[...ids]);improved=true;stats.acceptedMoves++;}
    }
    stats.improvementRounds++;notify('improving');if(!improved||same(before,bestSelection))break;
   }
 }
 return {format:HEURISTIC_VERSION,algorithm:'bounded-multistart-facility-greedy-and-exchange',best,
  complete:complete,modelOptimalityProven:complete&&stats.evaluationErrors===0,gameOptimalityProven:false,
  stopReason:stopped??(complete?'small-exact-complete':'heuristic-finished'),elapsedMs:performance.now()-begin,stats,errors,
  search:{starts,rounds,topCandidates,exactThreshold,unfilteredCombinationUpperBound:String(upper),shortlistSizes:candidates.map((ids,i)=>({team:model.tasks[i].team,room:model.tasks[i].room,available:model.tasks[i].candidates.length,retained:ids.length})),proxyIsUpperBound:false},
  excluded:model.excluded,warnings:[...model.warnings,'테라아카이브의 공개 탐색 구조를 참고해 독립 구현한 실험판입니다. 원본 엔진과 결과가 동일하다는 보장은 없습니다.','제한 탐색은 전체 최적해나 99% 정확도를 보장하지 않습니다. 미지원 스킬은 기존 모델과 동일하게 제외합니다.','시작점 구성에는 근사 점수를 사용하고, 보고하는 배치는 기존 컨디션·숙소·교대 시뮬레이터로 재계산합니다.']};
}
