// Additive experiment: the factory-local-catalog-1 artifacts remain unchanged.
import {rule,unlock} from './rules.mjs';
import {VERSION,developmentStates,stable,meetingTeamAllowed,subsetAt,subsetCount,simulate,score,compare} from './core.mjs';
import {factoryCandidates} from './factory-precompute.mjs';
import {expectedOrder,TRADE_MODEL} from './trading.mjs';
export const LOCAL_FORMAT='local-facility-catalog-1';
export const LOCAL_ROOMS={TRADING:3,POWER:1,HIRE:1,MEETING:2};
const CONTEXT_ROOMS=['CONTROL','DORMITORY'];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const kinds={TRADING:['simple','quality','tradeOverride','tradePayout'],POWER:['droneOnly'],HIRE:['simple','hireDorm','hireElite'],MEETING:['simple','missing','owned','clue','ignoredClue','exchangeSpeed','ramp','solo'],CONTROL:['ccRecovery','ccProd','hireThreshold','meetingBonus','mlynar','ccFaction','globalDorm','outsideObjective','ignoredClue','globalMissing'],DORMITORY:['selfRest','allRest','singleRest','selfSingleRest','selfAllRest','fixedRest','exchange']};

export function localProfiles(catalog,room,{operatorIds}={}){
 check(kinds[room],'Unsupported room');const allowed=operatorIds?new Set(operatorIds):null;
 if(allowed)for(const id of allowed)check(catalog.characters[id],`Unknown operator: ${id}`);
 const rules=Object.fromEntries(Object.values(catalog.buffs).map(b=>[b.id,rule(b)]));
 const groups=developmentStates(catalog,{options:{development:'all-operators',ownedMin:0,ownedMax:Object.keys(catalog.characters).length}});
 const profiles=[],excluded=[];let examinedOperators=0;
 for(const g of groups){
  if(allowed&&!allowed.has(g.id))continue;examinedOperators++;const def=catalog.characters[g.id],seen=new Map;
  for(const state of g.states.filter(Boolean)){
   const skills=unlock(def,state,rules).filter(s=>s.room===room).sort((a,b)=>a.id.localeCompare(b.id));if(!skills.length)continue;
   // Meeting's passive bonus depends on elite stage even if the skill IDs match.
   const key=stable([skills.map(s=>s.id),room==='MEETING'?state.elite:null]);
   if(seen.has(key)){seen.get(key).states.push(state);continue;}
   const row={operator:g.id,identity:def.identity??g.id,name:def.name,rarity:def.rarity,groups:def.groups??[],alter:def.alter??false,maxMorale:def.maxMorale,skills:skills.map(s=>s.id),states:[state],...(room==='MEETING'?{elite:state.elite}:{})};
   seen.set(key,row);const bad=skills.filter(s=>!kinds[room].includes(s.kind));
   if(bad.length){row.unsupported=bad.map(s=>({id:s.id,name:s.name,description:s.description}));excluded.push(row);}else profiles.push(row);
  }
 }
 const used=new Set(profiles.flatMap(p=>p.skills));
 return {format:LOCAL_FORMAT,modelVersion:VERSION,fingerprint:catalog.fingerprint,tradeModel:TRADE_MODEL,room,
  mode:CONTEXT_ROOMS.includes(room)?'profiles-only':'local-combinations',maxSeats:LOCAL_ROOMS[room]??5,
  scope:'Existing supported model, all assigned workers active. Not an all-roster or full-base optimizer.',
  dependencies:room==='HIRE'?['dormLevelSum','eliteRoomCount','hireThreshold','controlCount','mlynar','exportRecovery']:room==='MEETING'?['clueExchangeActive','missingClues','globalMissing','meetingBonus','ambienceTotal','workedHours','controlCount','mlynar','exportRecovery']:room==='TRADING'?['facilityLevel','controlCount','exportRecovery']:room==='POWER'?['controlCount','mlynar','exportRecovery']:['actual global placements','active operators','rest order','morale'],
  constants:{hireBasicSpeedBuff:catalog.hire.basicSpeedBuff,workerCost:catalog.workerCost},examinedOperators,profiles,excluded,
  definitions:Object.fromEntries([...used].sort().map(id=>[id,rules[id]]))};
}
function selected(header,indices){
 check(indices.length<=header.maxSeats&&new Set(indices).size===indices.length,'Invalid profile indices');
 const ps=indices.map(i=>header.profiles[i]);check(ps.every(Boolean),'Unknown profile');
 check(new Set(ps.map(p=>p.identity)).size===ps.length,'Duplicate operator identity');return ps;
}
export function* localCombinations(header){
 check(header.mode==='local-combinations','Context profiles must not be eagerly expanded');
 yield [];const ps=header.profiles;
 function* grow(prefix,start,used,left){if(!left){yield prefix;return;}for(let i=start;i<ps.length;i++)if(!used.has(ps[i].identity)){const next=new Set(used);next.add(ps[i].identity);yield* grow([...prefix,i],i+1,next,left-1);}}
 for(let n=1;n<=header.maxSeats;n++)yield* grow([],0,new Set,n);
}
export function compileLocal(header,indices){
 check(header.mode==='local-combinations','No eager context evaluator');const ps=selected(header,indices),all=ps.map(p=>p.skills.map(id=>header.definitions[id])),buffs=all.flat();
 const out={prod:0,drains:ps.map(()=>0),roomDrain:buffs.reduce((n,s)=>n+(s.roomDrain??0),0)};
 for(let pos=0;pos<all.length;pos++)for(const s of all[pos]){
  if(['simple','missing','owned','clue','ignoredClue','droneOnly','quality','tradeOverride','tradePayout'].includes(s.kind)){out.prod+=s.prod;out.drains[pos]+=s.drain??0;}
  if(s.kind==='hireDorm'){out.prod+=s.prod;out.perDorm=(out.perDorm??0)+s.amount;out.drains[pos]+=s.drain??0;}
  if(s.kind==='hireElite'){out.prod+=s.prod;out.elite=(out.elite??0)+1;}
  if(s.kind==='exchangeSpeed'){out.exchangeProd=(out.exchangeProd??0)+s.prod;(out.exchangeDrains??=ps.map(()=>0))[pos]+=s.drain??0;}
  if(s.kind==='ramp')(out.ramps??=[]).push([pos,s.initial,s.step,s.max]);
  if(s.kind==='solo'&&ps.length===1){out.prod+=s.amount;out.drains[pos]+=s.drain??0;}
 }
 if(header.room==='TRADING'){
  const override=buffs.filter(s=>s.kind==='tradeOverride');if(override.length)out.prod=Math.max(...override.map(s=>s.amount))*Math.max(0,ps.length-1);
  out.capacityBonus=buffs.reduce((n,s)=>n+(s.tradeLimit??0),0);
  out.qualities=buffs.filter(s=>s.kind==='quality').map(s=>s.quality).sort();out.payout=Math.max(0,...buffs.filter(s=>s.kind==='tradePayout').map(s=>s.bonus));
  out.levels=[1,2,3].map(level=>{try{return {level,order:expectedOrder(level,out.qualities,out.payout),baseline:expectedOrder(level,[],out.payout)};}catch(error){return {level,unsupported:error.message};}});
 }
 if(header.room==='MEETING'){
  out.passive=ps.reduce((n,p)=>n+({4:.02,5:.04,6:.05}[p.rarity]??0)+p.elite*.08+.05,0);
  out.missing=buffs.filter(s=>s.kind==='missing').map(s=>!!s.requiresExchange);
 }
 return out;
}
export function evaluateLocal(header,indices,program,context={}){
 const ps=selected(header,indices),level=context.level??3;
 check(Number.isInteger(level)&&level>=1&&level<=3,'Invalid facility level');
 const capacity=header.room==='TRADING'?level:header.maxSeats;check(indices.length<=capacity,'Facility occupancy mismatch');
 if(context.activeIds)check(ps.every(p=>context.activeIds.includes(p.operator)),'Fatigued staffing requires the simulator');
 let prod=program.prod;
 if(context.clueExchangeActive)prod+=program.exchangeProd??0;
 for(const [pos,initial,step,max]of program.ramps??[])prod+=Math.min(max,initial+Math.floor((context.workedHours?.[ps[pos].operator]??0)+1e-8)*step);
 const cc=context.controlCount??0;check(Number.isInteger(cc)&&cc>=0&&cc<=5,'Invalid control count');
 const drain=1-cc*.05+(header.room==='TRADING'?(header.constants.workerCost[ps.length]??0)/100:0)+program.roomDrain-(context.exportRecovery??0)-(context.mlynar&&['POWER','HIRE','MEETING'].includes(header.room)?.1:0);
 const rates=Object.fromEntries(ps.map((p,pos)=>[p.operator,-(drain+program.drains[pos]+(context.clueExchangeActive?(program.exchangeDrains?.[pos]??0):0))]));
 if(header.room==='POWER')return {rates,droneRecoveryBonus:prod};
 if(header.room==='HIRE'){
  const local=(ps.length?header.constants.hireBasicSpeedBuff:0)+prod+(program.perDorm??0)*(context.dormLevelSum??0)+(program.elite??0)*Math.min(5,context.eliteRoomCount??0)*.04;
  return {rates,multiplier:Math.max(0,1+local+(context.hireThreshold&&local<.3-1e-8?.2:0))};
 }
 if(header.room==='MEETING'){
  const options={clueExchangeActive:!!context.clueExchangeActive},ops=ps.map(p=>({...p,skills:p.skills.map(id=>header.definitions[id])}));
  check(meetingTeamAllowed(ops,options),'Meeting policy requires at most one active missing-clue specialist and speed-skilled partners');
  const ambience=context.ambienceTotal??0,bonus=ambience>=4000?.15:ambience>=3000?.10:ambience>=2000?.05:0;
  const missing=context.missingClues??[];check(Array.isArray(missing)&&new Set(missing).size===missing.length&&missing.every(x=>Number.isInteger(x)&&x>=1&&x<=7),'Invalid missing clues');
  const preference=ps.length&&missing.length>0&&missing.length<7&&((program.missing??[]).some(exchange=>!exchange||context.clueExchangeActive)||context.globalMissing)?1:0;
  return {rates,multiplier:ps.length?Math.max(0,1+[.07,.09,.11][level-1]+bonus+program.passive+prod+(context.meetingBonus??0)):0,preference};
 }
 if(header.room==='TRADING'){
  const trade=program.levels[level-1];check(!trade.unsupported,trade.unsupported);
  return {rates,multiplier:ps.length?Math.max(0,1+ps.length*.01+prod):0,capacity:Math.max(0,[6,8,10][level-1]+program.capacityBonus),order:trade.order,baselineOrder:trade.baseline};
 }
 throw Error('No local evaluator for this room');
}
export function* localRecords(header,{stats={}}={}){
 check(header.mode==='local-combinations','Context profiles are stored without enumeration');
 const programs=new Map;Object.assign(stats,{combinations:0,programs:0,bySeats:Array(header.maxSeats+1).fill(0)});yield {type:'header',...header};
 for(const indices of localCombinations(header)){
  const p=compileLocal(header,indices),key=JSON.stringify(p);let id=programs.get(key);
  if(id===undefined){id=programs.size;programs.set(key,id);yield ['effect',id,p];stats.programs++;}
  yield ['combo',indices,id];stats.combinations++;stats.bySeats[indices.length]++;
 }
 yield {type:'end',...stats,complete:true};
}
export function readLocalRecords(records,{fingerprint,modelVersion=VERSION}={}){
 const table={header:null,programs:[],rows:[],end:null};
 for(const row of records){
  check(!table.end,'Records after end');
  if(row.type==='header'){check(!table.header&&row.mode==='local-combinations','Invalid header');table.header=row;}
  else if(row[0]==='effect'){check(table.header&&row[1]===table.programs.length,'Invalid program order');table.programs.push(row[2]);}
  else if(row[0]==='combo'){check(table.header&&table.programs[row[2]],'Missing program');selected(table.header,row[1]);table.rows.push([row[1],row[2]]);}
  else if(row.type==='end')table.end=row;else throw Error('Unknown record');
 }
 check(table.header?.format===LOCAL_FORMAT&&table.header.modelVersion===modelVersion,'Incompatible catalog version');
 check(fingerprint===undefined||fingerprint===table.header.fingerprint,'Stale skill data');
 check(table.end?.complete&&table.end.combinations===table.rows.length&&table.end.programs===table.programs.length,'Incomplete catalog');return table;
}
export function matchingLocalProfiles(header,catalog,progress){
 check(header.fingerprint===catalog.fingerprint&&header.modelVersion===VERSION,'Stale catalog');const available=new Set,excluded=[];
 for(const [id,state]of Object.entries(progress)){
  if(!state?.owned)continue;const def=catalog.characters[id];check(def,'Unknown operator');
  check(Number.isInteger(state.elite)&&Number.isInteger(state.level)&&state.level>=1&&def.maxLevels?.[state.elite]>=state.level,'Invalid development state');
  const ids=unlock(def,state,catalog.buffs).filter(b=>b.room===header.room).map(b=>b.id).sort();
  const equal=p=>p.operator===id&&(header.room!=='MEETING'||p.elite===state.elite)&&stable([...p.skills].sort())===stable(ids);
  const i=header.profiles.findIndex(equal);if(i>=0)available.add(i);else{const bad=header.excluded.find(equal);if(bad)excluded.push(bad);}
 }
 return {available,excluded};
}
export function selectLocalCandidates(table,catalog,progress,context={}){
 const {available,excluded}=matchingLocalProfiles(table.header,catalog,progress),rows=[],rejected=[];
 const level=context.level??3;check(Number.isInteger(level)&&level>=1&&level<=3,'Invalid facility level');
 const cap=table.header.room==='TRADING'?level:table.header.maxSeats;
 for(const [indices,programIndex]of table.rows){
  if(indices.length>cap||!indices.every(i=>available.has(i)))continue;
  try{const value=evaluateLocal(table.header,indices,table.programs[programIndex],context);rows.push({indices,operators:indices.map(i=>table.header.profiles[i].operator),identities:indices.map(i=>table.header.profiles[i].identity),programIndex,value});}
  catch(error){rejected.push({indices,reason:error.message});}
 }
 return {rows,excluded,rejected};
}

// Small exact composition experiment. It preserves every supplied candidate and
// blocks identity reuse across rooms AND teams. A budget is never an optimum proof.
export function* joinLocalCandidates(lists,{maxPlans=100000,maxMilliseconds=1000,stats={}}={}){
 check(Number.isInteger(maxPlans)&&maxPlans>=1&&Number.isFinite(maxMilliseconds)&&maxMilliseconds>0,'Invalid join budget');
 Object.assign(stats,{plans:0,nodes:0,conflicts:0,complete:false,reason:null});const deadline=performance.now()+maxMilliseconds,choices=[],used=new Set;let stopped=false;
 function* walk(depth){
  if(performance.now()>deadline){stopped=true;stats.reason='time';return;}
  if(depth===lists.length){if(stats.plans>=maxPlans){stopped=true;stats.reason='plans';return;}stats.plans++;yield [...choices];return;}
  for(const row of lists[depth]){
   if(stopped)break;if(performance.now()>deadline){stopped=true;stats.reason='time';break;}stats.nodes++;check(row.identities?.length===row.operators.length,'Missing identities');
   if(new Set(row.identities).size!==row.identities.length||row.identities.some(id=>used.has(id))){stats.conflicts++;continue;}
   for(const id of row.identities)used.add(id);choices.push(row);yield* walk(depth+1);choices.pop();for(const id of row.identities)used.delete(id);
  }
 }
 yield* walk(0);stats.complete=!stopped;return {...stats};
}

// Connect reused catalogs to the existing final simulator. Only ONE user's
// current roster is accepted. Control/dorm combinations remain lazy and bounded.
export function solveLocalCatalog(model,tables,{maxPlans=100000,maxMilliseconds=1000}={}){
 check(model.input.options.development==='current','Specify one actual owned roster; all-roster enumeration is disabled here');
 check(Number.isInteger(maxPlans)&&maxPlans>=1&&Number.isFinite(maxMilliseconds)&&maxMilliseconds>0,'Invalid search budget');
 const start=performance.now(),deadline=start+maxMilliseconds,selection={rejectedLocal:0},options=model.input.options;
 const lists=model.tasks.map(task=>{
  const fixed=new Set(task.fixed),allowed=new Set([...task.fixed,...task.candidates]);
  const adapt=operators=>({operators,identities:operators.filter(id=>!fixed.has(id)).map(id=>model.byId[id].identity??id)});
  if(['CONTROL','DORMITORY'].includes(task.type))return {[Symbol.iterator]:function*(){
   const total=subsetCount(task.candidates.length,task.capacity);
   for(let rank=0n;rank<total;rank++){
    if(performance.now()>deadline)throw Error('LOCAL_PREPARATION_BUDGET');
    const ids=subsetAt(task.candidates,task.capacity,rank);yield adapt([...task.fixed,...ids]);
   }
  }};
  const table=tables[task.type];check(table,'Missing local catalog: '+task.type);check(table.header.modelVersion===VERSION&&table.header.fingerprint===model.catalog.fingerprint,'Stale local catalog');
  let candidates;
  if(task.type==='MANUFACTURE')candidates=[...factoryCandidates(table,model.catalog,model.input.progress,{level:task.level,recipeId:task.recipe,maxFactoryLevel:Math.max(...model.work.filter(r=>r.type==='MANUFACTURE').map(r=>r.level))})];
  else{
   const result=selectLocalCandidates(table,model.catalog,model.input.progress,{level:task.level,clueExchangeActive:options.clueExchangeActive,missingClues:options.missingClues});
   candidates=result.rows;selection.rejectedLocal+=result.rejected.length;
  }
  return candidates.filter(row=>row.operators.length<=task.capacity+task.fixed.length&&row.operators.every(id=>allowed.has(id))&&task.fixed.every(id=>row.operators.includes(id))).map(row=>adapt(row.operators));
 });
 let best=null,errors=0,lastError=null;const stats={};
 if(performance.now()>=deadline)return {complete:false,reason:'preparation-time',best,errors,selection,elapsedMs:performance.now()-start};
 try{
  for(const choices of joinLocalCandidates(lists,{maxPlans,maxMilliseconds:Math.max(.001,deadline-performance.now()),stats})){
   const assignments=model.tasks.map((task,i)=>({team:task.team,room:task.room,operators:choices[i].operators}));
   const plan={groups:assignments.filter(g=>g.team>=0),...(assignments.some(g=>g.team<0)?{dormSupport:Object.fromEntries(assignments.filter(g=>g.team<0).map(g=>[g.room,g.operators]))}:{})};
   try{const result=simulate(model,plan),value=score(model,result);if(value&&(!best||compare(value,best.score)>0))best={plan,score:value,at24:result.at24,cycle:result.cycle,cycleStatus:result.cycleStatus};}
   catch(error){errors++;lastError=error.message;}
  }
 }catch(error){if(error.message!=='LOCAL_PREPARATION_BUDGET')throw error;stats.complete=false;stats.reason='time';}
 return {complete:stats.complete===true,modelOptimalityProven:stats.complete===true&&errors===0&&selection.rejectedLocal===0&&best!==null,gameOptimalityProven:false,reason:stats.reason,best,errors,lastError,selection,stats,elapsedMs:performance.now()-start};
}
