// Experimental reusable local combinations. Never enumerate global owned rosters.
import {rule,unlock} from './rules.mjs';
import {VERSION,developmentStates,stable} from './core.mjs';

export const FORMAT='factory-local-catalog-1';
export const CATEGORIES=['F_GOLD','F_EXP','F_DIAMOND'];
const KINDS=new Set(['simple','ramp','trades','dormLevels','training','factoryDrain','bubble','vermeil','automation']);
const ensure=(ok,message)=>{if(!ok)throw Error(message);};

export function factoryProfiles(catalog,{operatorIds}={}){
 const allowed=operatorIds?new Set(operatorIds):null;
 if(allowed)for(const id of allowed)ensure(catalog.characters[id],`Unknown operator: ${id}`);
 const buffs=Object.fromEntries(Object.values(catalog.buffs).map(b=>[b.id,rule(b)]));
 const groups=developmentStates(catalog,{progress:{},options:{development:'all-operators',ownedMin:0,ownedMax:Object.keys(catalog.characters).length}});
 const profiles=[],excluded=[];let noFactoryOperators=0,examinedOperators=0;
 for(const g of groups){
  if(allowed&&!allowed.has(g.id))continue;
  examinedOperators++;const def=catalog.characters[g.id],seen=new Map();
  for(const state of g.states.filter(Boolean)){
   const local=unlock(def,state,buffs).filter(s=>s.room==='MANUFACTURE').sort((a,b)=>a.id.localeCompare(b.id));
   if(!local.length)continue;
   const key=stable(local.map(s=>s.id));
   if(seen.has(key)){seen.get(key).states.push(state);continue;}
   const row={operator:g.id,identity:def.identity??g.id,name:def.name,skills:local.map(s=>s.id),states:[state]};
   seen.set(key,row);
   const bad=local.filter(s=>!KINDS.has(s.kind));
   if(bad.length){row.unsupported=bad.map(s=>({id:s.id,name:s.name,description:s.description}));excluded.push(row);}
   else profiles.push(row);
  }
  if(!seen.size)noFactoryOperators++;
 }
 const used=new Set(profiles.flatMap(p=>p.skills));
 return {format:FORMAT,modelVersion:VERSION,fingerprint:catalog.fingerprint,
  scope:'Supported local factory effects only; not a full-base or shift optimizer, not proof of game accuracy.',
  categories:CATEGORIES,recipes:catalog.recipes,baseCapacity:catalog.factory.phases.map(p=>p.outputCapacity),workerCost:catalog.workerCost,
  expressionFields:['productionConstant','capacityBonus','perPower','perTrading','perDormLevel','trainingCount','roomDrain','operatorDrain','ramps'],
  conditions:{seats:'0..facility level (1..3)',recipeUnlock:'maximum factory level in the entire base >= recipe.unlockLevel',activation:'all assigned operators active; otherwise use the existing simulator'},
  dependencies:['powerCount','tradingCount','dormLevelSum','trainingLevel','controlCount','controlProduction','exportRecovery','workedHours'],
  examinedOperators,noFactoryOperators,profiles,excluded,definitions:Object.fromEntries([...used].sort().map(id=>[id,buffs[id]]))};
}

// A compact expression for each product category, with external dependencies
// retained as coefficients. No assumptions about the rest of the base are baked in.
export function compileFactory(header,indices){
 ensure(indices.length<=3&&new Set(indices).size===indices.length,'Invalid profile indices');
 const ps=indices.map(i=>header.profiles[i]);ensure(ps.every(Boolean),'Unknown profile');
 ensure(new Set(ps.map(p=>p.identity)).size===ps.length,'Duplicate operator identity');
 const all=ps.map(p=>p.skills.map(id=>header.definitions[id]));
 const buffs=all.flat(),bubble=buffs.some(s=>s.kind==='bubble'),vermeil=buffs.some(s=>s.kind==='vermeil');
 const roomDrain=buffs.reduce((n,s)=>n+(s.roomDrain??0)-(s.kind==='factoryDrain'?.1:0),0);
 return CATEGORIES.map(category=>{
  let constant=0,capacity=0,power=0,trading=0,dorm=0,training=0;const drains=[],ramps=[];
  all.forEach((skills,pos)=>{
   let cap=0,drain=0;
   for(const s of skills){
    if(s.targets?.length&&!s.targets.includes(category))continue;
    if(s.kind==='simple'){constant+=s.prod;cap+=s.cap??0;drain+=s.drain??0;}
    else if(s.kind==='ramp')ramps.push([pos,s.initial,s.step,s.max]);
    else if(s.kind==='trades'&&category==='F_GOLD')trading+=s.amount;
    else if(s.kind==='dormLevels'&&category==='F_GOLD')dorm+=s.amount;
    else if(s.kind==='training')training++;
   }
   capacity+=cap;constant+=bubble?Math.max(0,cap)*(cap>16?.03:.01):vermeil?Math.max(0,cap)*.02:0;
   drains.push(drain);
  });
  const automation=buffs.filter(s=>s.kind==='automation');
  if(automation.length){constant=0;trading=0;dorm=0;training=0;ramps.length=0;power=automation.reduce((n,s)=>n+s.amount,0);}
  return [constant,capacity,power,trading,dorm,training,roomDrain,drains,ramps];
 });
}

export function evaluateFactory(header,indices,program,{level,recipeId,maxFactoryLevel=level,powerCount=0,tradingCount=0,dormLevelSum=0,trainingLevel=0,controlCount=0,controlProduction=0,exportRecovery=0,workedHours={},activeIds}){
 ensure(Number.isInteger(level)&&level>=1&&level<=3&&indices.length<=level,'Facility level/occupancy mismatch');
 const recipe=header.recipes[String(recipeId)];ensure(recipe&&maxFactoryLevel>=recipe.unlockLevel,'Recipe not unlocked in this base');
 if(activeIds)ensure(indices.every(i=>activeIds.includes(header.profiles[i].operator)),'Fatigued staffing requires the existing simulator');
 const v=program[header.categories.indexOf(recipe.category)];ensure(v,'Unknown product category');
 const [constant,capacity,power,trading,dorm,training,roomDrain,drains,ramps]=v;
 let production=constant+power*powerCount+trading*tradingCount+dorm*dormLevelSum+training*Math.min(.3,Math.max(0,trainingLevel)*.1);
 for(const [pos,initial,step,max]of ramps){const id=header.profiles[indices[pos]].operator;production+=Math.min(max,initial+Math.floor((workedHours[id]??0)+1e-8)*step);}
 const baseDrain=1-controlCount*.05+(header.workerCost[indices.length]??0)/100+roomDrain-exportRecovery;
 return {multiplier:indices.length?Math.max(0,1+indices.length*.01+production+controlProduction):0,
  capacity:Math.max(0,header.baseCapacity[level-1]+capacity),rates:Object.fromEntries(indices.map((i,pos)=>[header.profiles[i].operator,-(baseDrain+drains[pos])]))};
}

export function* profileCombinations(header,maxSeats=3){
 ensure(Number.isInteger(maxSeats)&&maxSeats>=0&&maxSeats<=3,'Invalid seat limit');
 yield [];const ps=header.profiles;
 function* extend(prefix,start,identities,left){
  if(!left){yield prefix;return;}
  for(let i=start;i<ps.length;i++){
   if(identities.has(ps[i].identity))continue;
   const next=new Set(identities);next.add(ps[i].identity);yield* extend([...prefix,i],i+1,next,left-1);
  }
 }
 for(let seats=1;seats<=maxSeats;seats++)yield* extend([],0,new Set(),seats);
}

export function* factoryRecords(header,{maxSeats=3,stats={}}={}){
 const effects=new Map;Object.assign(stats,{combinations:0,programs:0,bySeats:[0,0,0,0]});
 yield {type:'header',...header};
 for(const indices of profileCombinations(header,maxSeats)){
  const program=compileFactory(header,indices),key=JSON.stringify(program);let index=effects.get(key);
  if(index===undefined){index=effects.size;effects.set(key,index);yield ['effect',index,program];stats.programs++;}
  yield ['combo',indices,index];stats.combinations++;stats.bySeats[indices.length]++;
 }
 yield {type:'end',...stats,complete:true};
}

export function readFactoryRecords(records,{fingerprint,modelVersion=VERSION}={}){
 const table={header:null,programs:[],rows:[],end:null};
 for(const row of records){
  if(row.type==='header'){ensure(!table.header,'Duplicate header');table.header=row;}
  else if(row[0]==='effect'){ensure(table.header&&row[1]===table.programs.length,'Invalid effect order');table.programs.push(row[2]);}
  else if(row[0]==='combo'){ensure(table.programs[row[2]],'Missing effect');table.rows.push([row[1],row[2]]);}
  else if(row.type==='end')table.end=row;
  else throw Error('Unknown catalog record');
 }
 ensure(table.header?.format===FORMAT&&table.header.modelVersion===modelVersion,'Incompatible factory catalog');
 ensure(fingerprint===undefined||table.header.fingerprint===fingerprint,'Stale skill data');
 ensure(table.end?.complete&&table.end.combinations===table.rows.length,'Incomplete factory catalog');
 return table;
}

export function matchingFactoryProfiles(header,catalog,progress){
 ensure(header.fingerprint===catalog.fingerprint,'Stale skill data');
 const available=new Set,excluded=[];
 for(const [id,state]of Object.entries(progress)){
  if(!state?.owned)continue;ensure(catalog.characters[id],'Unknown owned operator');
  const def=catalog.characters[id];ensure(Number.isInteger(state.elite)&&Number.isInteger(state.level)&&state.level>=1&&def.maxLevels?.[state.elite]>=state.level,'Invalid development state');
  const ids=unlock(catalog.characters[id],state,catalog.buffs).filter(b=>b.room==='MANUFACTURE').map(b=>b.id).sort();
  const equal=p=>p.operator===id&&stable([...p.skills].sort())===stable(ids);
  const index=header.profiles.findIndex(equal);if(index>=0)available.add(index);
  else{const bad=header.excluded.find(equal);if(bad)excluded.push(bad);}
 }
 return {available,excluded};
}

export function* factoryCandidates(table,catalog,progress,{level,recipeId,maxFactoryLevel=level}){
 ensure(Number.isInteger(level)&&level>=1&&level<=3,'Invalid factory level');
 const recipe=table.header.recipes[String(recipeId)];ensure(recipe&&maxFactoryLevel>=recipe.unlockLevel,'Recipe not unlocked in this base');
 const {available}=matchingFactoryProfiles(table.header,catalog,progress);
 for(const [indices,programIndex]of table.rows)if(indices.length<=level&&indices.every(i=>available.has(i)))yield {indices,program:table.programs[programIndex],operators:indices.map(i=>table.header.profiles[i].operator)};
}
