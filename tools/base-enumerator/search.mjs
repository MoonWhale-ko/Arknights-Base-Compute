// Search helpers deliberately do not approximate or replace the simulator.
export class FacilityCandidates{
 constructor(task,model){this.task=task;this.model=model;this.records=new Map();this.hits=0;this.misses=0;}
 get(rank,unrank){
  const key=String(rank);if(this.records.has(key)){this.hits++;return this.records.get(key);}
  this.misses++;const operators=unrank(this.task.candidates,this.task.capacity,rank),ids=[...this.task.fixed,...operators];
  const effects=ids.flatMap(id=>(this.model.byId[id]?.skills??[]).filter(s=>s.room===this.task.type).map(s=>({operator:id,id:s.id,kind:s.kind,production:s.prod,capacity:s.cap,drain:s.drain,amount:s.amount,definition:s})));
  const record={operators,ids,effects};
  // Lazily materialize the table: never allocate C(400,5) upfront.
  if(this.records.size>=2048)this.records.delete(this.records.keys().next().value);this.records.set(key,record);return record;
 }
}
export function candidateTableKey(task,model){
 return JSON.stringify([model.catalog.fingerprint,task.type,task.level,task.recipe,task.capacity,task.candidates,task.fixed,[...task.candidates,...task.fixed].map(id=>[id,(model.byId[id]?.skills??[]).map(s=>s.id)])]);
}
// Proven upper bound for the CURRENT supported office model only. Ignores
// fatigue, exclusivity and room occupancy conflicts, making it optimistic.
// Unknown effects return null: a missing bound must never delete a branch.
export function officeUpperBound(model,selected,depth){
 const options=model.input.options;
 if(options.rotation!=='12h')return null;
 const offices=model.work.filter(r=>r.type==='HIRE');if(!offices.length)return 0;
 const dormLevels=model.rooms.filter(r=>r.type==='DORMITORY').reduce((n,r)=>n+r.level,0);
 const ccKinds=new Set(['ccRecovery','ccProd','hireThreshold','meetingBonus','mlynar','ccFaction','globalDorm','outsideObjective','ignoredClue','globalMissing']);
 const controls=model.tasks.filter(t=>t.type==='CONTROL');
 for(const t of controls)for(const id of [...t.fixed,...t.candidates])if(model.byId[id].skills.some(s=>s.room==='CONTROL'&&!ccKinds.has(s.kind)))return null;
 const threshold=controls.some(t=>[...t.fixed,...t.candidates].some(id=>model.byId[id].skills.some(s=>s.kind==='hireThreshold')))?.2:0;
 const bonus=id=>{
  let n=0;for(const s of model.byId[id]?.skills??[]){if(s.room!=='HIRE')continue;
   if(!['simple','hireDorm','hireElite'].includes(s.kind))return null;
   const value=s.prod+(s.kind==='hireDorm'?dormLevels*s.amount:s.kind==='hireElite'?.2:0);if(!Number.isFinite(value))return null;n+=Math.max(0,value);
  }return n;
 };
 let upper=0;const teams=options.rankingWindow==='24h'?Math.min(2,options.teams):options.teams;
 for(let team=0;team<teams;team++)for(const room of offices){
  const i=model.tasks.findIndex(t=>t.team===team&&t.room===room.id),task=model.tasks[i];if(!task)return null;
  let local=0,occupied=false;
  if(i<depth){const ids=[...task.fixed,...selected[i]];occupied=ids.length>0;for(const id of ids){const n=bonus(id);if(n===null)return null;local+=n;}}
  else{
   const values=[...task.fixed,...task.candidates].map(bonus);if(values.some(n=>n===null))return null;
   local=Math.max(0,...values);occupied=task.fixed.length+task.candidates.length>0;
  }
  upper+=(1+(occupied?model.catalog.hire.basicSpeedBuff:0)+local+threshold)/teams;
 }
 return upper;
}
