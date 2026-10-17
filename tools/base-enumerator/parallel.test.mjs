import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {Worker} from 'node:worker_threads';
import {Run} from './runner.mjs';import {ValidationPool,parallelStep} from './parallel.mjs';import {simulate,compare} from './core.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),demo=JSON.parse(fs.readFileSync(new URL('./demo.json',import.meta.url))),trade=JSON.parse(fs.readFileSync(new URL('./examples/quality-trading.json',import.meta.url)));
const nodeWorker=()=>{const w=new Worker(new URL('./evaluation-node-worker.mjs',import.meta.url));const adapter={postMessage:m=>w.postMessage(m),terminate:()=>w.terminate()};w.on('message',data=>adapter.onmessage?.({data}));w.on('error',e=>adapter.onerror?.(e));return adapter;};
async function finish(raw,count,resume=false){let run=new Run(catalog,raw),rows=[],turn=0;const pool=count>1?new ValidationPool(catalog,count,nodeWorker):null;try{while(!run.done){if(pool){rows.push(...(await parallelStep(run,pool,false,16)).rows);}else{const s=run.next();if(s.row)rows.push(s.row);}if(resume&&++turn===2){run=new Run(catalog,raw,JSON.parse(JSON.stringify(run.checkpoint())));}}return {rows,run};}finally{pool?.close();}}
test('real worker threads return the same optimum, ledgers and one result per condition',async()=>{
 const reference=await finish(trade,1),parallel=await finish(trade,2),resumed=await finish(trade,2,true);
 assert.equal(parallel.rows.length,1);assert.equal(parallel.rows[0].evaluationErrors,0);assert.equal(compare(reference.rows[0].best.score,parallel.rows[0].best.score),0);
 assert.deepEqual(parallel.rows[0].best.at24.trade.range,reference.rows[0].best.at24.trade.range);assert.deepEqual(parallel.rows[0].best.score,resumed.rows[0].best.score);
 assert.equal(parallel.run.pendingEvaluations.size,0);
});
test('in-flight evaluations block finalization and checkpoint, duplicates are rejected',()=>{
 const raw=structuredClone(demo);raw.options.searchStrategy='exhaustive';const run=new Run(catalog,raw);const jobs=[];let step;
 for(let n=0;n<1000;n++){step=run.next(false,true);if(step.evaluation)jobs.push(step.evaluation);if(step.waiting)break;}
 assert.equal(step.waiting,true);assert.equal(run.completed,0n);assert.throws(()=>run.checkpoint(),/완료 후/);
 for(const job of [...jobs].reverse())run.resolveEvaluation(job.id,simulate(run.model,job.plan));
 assert.throws(()=>run.resolveEvaluation(jobs[0].id,{}),/중복/);assert.equal(run.next().row.type,'condition-result');assert.doesNotThrow(()=>run.checkpoint());
});
test('worker failure falls back without losing or double-counting queued plans',async()=>{
 const raw=structuredClone(demo);raw.options.searchStrategy='exhaustive';const run=new Run(catalog,raw);const broken={evaluate:async()=>{throw Error('test worker unavailable');},close(){}};
 await parallelStep(run,broken,false,64);while(!run.done)run.next();assert.equal(run.examined,21n);assert.equal(run.valid,21n);assert.equal(run.errors,0);assert.equal(run.parallelFallback,'test worker unavailable');
});
test('bundled nested evaluator worker compiles and processes the actual catalog',()=>{
 const page=fs.readFileSync(new URL('./standalone.html',import.meta.url),'utf8'),source=JSON.parse(page.match(/const WORKER_SOURCE=(.*);\n/)[1]).replaceAll('<\\/script','</script'),evalSource=JSON.parse(source.match(/const EVALUATION_WORKER_SOURCE=(.*);\n/)[1]);
 const messages=[],sandbox={structuredClone,self:{postMessage:m=>messages.push(m)}};vm.createContext(sandbox);new vm.Script(evalSource).runInContext(sandbox);
 const run=new Run(catalog,demo);let job;while(!job)job=run.next(false,true).evaluation;
 sandbox.self.onmessage({data:{type:'init',catalog}});sandbox.self.onmessage({data:{type:'evaluate',seq:1,context:{key:job.key,input:job.input},jobs:[job]}});assert.equal(messages[0].results[0].result.status,'ok');
});
