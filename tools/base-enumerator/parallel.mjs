import {simulate} from './core.mjs';
export class ValidationPool{
 constructor(catalog,count,makeWorker){
  this.seq=0;this.closed=false;this.workers=[];
  try{for(let i=0;i<count;i++){
   const worker=makeWorker(),slot={worker,pending:null};this.workers.push(slot);
   worker.onmessage=({data})=>{if(slot.pending?.seq===data.seq){const pending=slot.pending;slot.pending=null;pending.resolve(data.results);}};
   worker.onerror=error=>{this.close(error instanceof Error?error:new Error(error.message??'병렬 작업 실패'));};
   worker.postMessage({type:'init',catalog});
  }}catch(error){this.close(error);throw error;}
 }
 async evaluate(jobs){
  if(this.closed)throw Error('병렬 검증기가 종료되었습니다.');
  const groups=Array.from({length:Math.min(this.workers.length,jobs.length)},()=>[]);jobs.forEach((job,i)=>groups[i%groups.length].push(job));
  const replies=await Promise.all(groups.map((group,i)=>new Promise((resolve,reject)=>{
   const slot=this.workers[i];if(slot.pending)return reject(Error('검증 작업 중복 할당'));
   const seq=++this.seq;slot.pending={seq,resolve,reject};
   try{slot.worker.postMessage({type:'evaluate',seq,context:{key:group[0].key,input:group[0].input},jobs:group.map(({id,plan,record})=>({id,plan,record}))});}catch(error){slot.pending=null;reject(error);}
  })));
  return replies.flat();
 }
 close(error=new Error('병렬 검증 중단')){if(this.closed)return;this.closed=true;for(const slot of this.workers){slot.pending?.reject(error);slot.pending=null;slot.worker.terminate();}}
}
export async function parallelStep(run,pool,record=false,maxJobs=64){
 const jobs=[],rows=[],started=performance.now();
 while(!run.done&&jobs.length<maxJobs&&performance.now()-started<45){
  const step=run.next(record,true);if(step.evaluation)jobs.push(step.evaluation);
  if(step.row){rows.push(step.row);break;}if(step.waiting)break;
 }
 if(jobs.length){
  let replies;try{replies=await pool.evaluate(jobs);}catch(error){
   // Nothing has been committed yet. Recheck the whole batch locally once.
   run.parallelFallback=error.message;pool.close();
   replies=jobs.map(job=>{try{return {id:job.id,result:simulate(run.model,job.plan,{record})};}catch(e){return {id:job.id,error:e.message};}});
  }
  // Commit in enumeration order, regardless of worker completion order.
  const byId=new Map(replies.map(x=>[x.id,x]));
  for(const job of jobs){const reply=byId.get(job.id);run.resolveEvaluation(job.id,reply?.result,reply?.error??(!reply?'검증 응답 누락':undefined));}
 }
 return {rows};
}
