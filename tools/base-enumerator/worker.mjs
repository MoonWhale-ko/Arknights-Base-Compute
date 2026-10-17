import {Run} from './runner.mjs';
import {ValidationPool,parallelStep} from './parallel.mjs';
let catalog=null,run=null,paused=true,awaiting=false,record=false,pool=null,busy=false;
const load=async()=>{if(!catalog){const r=await fetch('./data/catalog.json');if(!r.ok)throw Error('스킬 자료를 읽지 못했습니다.');catalog=await r.json();}return catalog;};
async function pump(){
 if(paused||awaiting||busy||!run)return;busy=true;const rows=[],started=performance.now();
 try{
  if(pool&&!pool.closed){const step=await parallelStep(run,pool,record,pool.workers.length*16);rows.push(...step.rows);}
  else while(!run.done&&rows.length<40&&performance.now()-started<45){const s=run.next(record);if(s.row)rows.push(s.row);}
  awaiting=true;self.postMessage({type:'batch',rows,checkpoint:run.checkpoint(),progress:{workers:pool&&!pool.closed?pool.workers.length:1,parallelFallback:run.parallelFallback,examined:String(run.examined),valid:String(run.valid),scenario:String(run.scenario),scenarios:String(run.totalScenarios),done:run.done,completed:String(run.completed),layoutIndex:String(run.layoutIndex),best:run.scenarioBest??run.best}});
 }catch(error){paused=true;self.postMessage({type:'error',message:error.message});}finally{busy=false;}
}
self.onmessage=async({data})=>{try{
 if(data.type==='inspect'){const r=new Run(await load(),data.input);self.postMessage({type:'inspection',metadata:r.describe()});}
 if(data.type==='start'){
  pool?.close();pool=null;run=new Run(await load(),data.input,data.checkpoint);record=data.record===true;
  const count=Math.max(1,Math.min(8,Number(data.workers??1)));
  if(count>1&&typeof Worker!=='undefined')try{pool=new ValidationPool(catalog,count,()=>new Worker(new URL('./evaluation-worker.mjs',import.meta.url),{type:'module'}));}catch(error){run.parallelFallback=error.message;}
  paused=false;awaiting=false;self.postMessage({type:'metadata',metadata:run.describe()});await pump();
 }
 if(data.type==='ack'){awaiting=false;if(paused||run.done){if(run.done){pool?.close();pool=null;}self.postMessage({type:'stopped',complete:run.done});}else setTimeout(pump,0);}
 if(data.type==='pause'){paused=true;if(!busy&&!awaiting)self.postMessage({type:'stopped',complete:run?.done??false});}
}catch(error){paused=true;self.postMessage({type:'error',message:error.message});}};
