#!/usr/bin/env node
// No server and no third-party packages. Results remain on the local machine.
import {workerResources} from './resources.mjs';import {Worker} from 'node:worker_threads';import {availableParallelism} from 'node:os';import {ValidationPool,parallelStep} from './parallel.mjs';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {Run} from './runner.mjs';
const base=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),get=(name,defaultValue)=>{const i=args.indexOf(name);return i<0?defaultValue:args[i+1];};
if(args.includes('--help')||!args.length){console.log('node cli.mjs --input demo.json --output results.ndjson [--limit 10000] [--conditions 100] [--seconds 60] [--resume] [--events] [--workers auto|1..8]\n--limit: 이번 실행에서 검사할 최대 배치 수. --conditions: 저장할 완료 조건 수. 도달 시 체크포인트를 저장합니다. 전체 완료와 구분합니다.');process.exit(0);}
const inputFile=path.resolve(get('--input',path.join(base,'demo.json'))),out=path.resolve(get('--output','results.ndjson')),checkpoint=out+'.checkpoint.json',summary=out+'.summary.json',limit=Number(get('--limit',Infinity));
if(!(limit>0))throw Error('--limit은 양수여야 합니다.');
const resources=workerResources(availableParallelism(),get('--workers','auto'),process.env.GITHUB_ACTIONS==='true'),workerCount=resources.workers;console.log(JSON.stringify({resources}));
const catalog=JSON.parse(fs.readFileSync(path.join(base,'data/catalog.json'))),raw=JSON.parse(fs.readFileSync(inputFile));let saved=null;
if(args.includes('--resume')){if(!fs.existsSync(checkpoint))throw Error('체크포인트 파일이 없습니다.');saved=JSON.parse(fs.readFileSync(checkpoint));if(!fs.existsSync(out)||fs.statSync(out).size<saved.outputBytes)throw Error('결과 파일이 누락되었거나 체크포인트보다 짧습니다.');}
else if(fs.existsSync(out)||fs.existsSync(checkpoint))throw Error('기존 결과가 있습니다. --resume 또는 다른 출력 경로를 사용하세요.');
const run=new Run(catalog,raw,saved),initialExamined=run.examined,initialCompleted=run.completed,conditionLimit=Number(get('--conditions',Infinity)),seconds=Number(get('--seconds',Infinity)),start=Date.now();if(!(conditionLimit>0&&seconds>0))throw Error('조건/시간 제한은 양수여야 합니다.');let metadata;try{metadata=run.describe();}catch(e){metadata={input:run.input,warning:e.message};}
const fd=fs.openSync(out,saved?'r+':'wx');let pool=workerCount>1?new ValidationPool(catalog,workerCount,()=>{const w=new Worker(new URL('./evaluation-node-worker.mjs',import.meta.url)),adapter={postMessage:m=>w.postMessage(m),terminate:()=>w.terminate()};w.on('message',data=>adapter.onmessage?.({data}));w.on('error',e=>adapter.onerror?.(e));return adapter;}):null;
let offset=saved?.outputBytes??0,written=0,stopping=false,last=Date.now();if(saved)fs.ftruncateSync(fd,offset);
function line(row){const buffer=Buffer.from(JSON.stringify(row)+'\n');let done=0;while(done<buffer.length)done+=fs.writeSync(fd,buffer,done,buffer.length-done,offset+done);offset+=buffer.length;}
if(!saved)line({type:'metadata',...metadata});
function save(){fs.fsyncSync(fd);const tmp=checkpoint+'.tmp';fs.writeFileSync(tmp,JSON.stringify({...run.checkpoint(),outputBytes:offset}));fs.renameSync(tmp,checkpoint);fs.writeFileSync(summary,JSON.stringify({resources,complete:run.done,examined:String(run.examined),valid:String(run.valid),scenario:String(run.scenario),scenarios:String(run.totalScenarios),best:run.best,pendingCondition:{searchComplete:false,layoutIndex:String(run.layoutIndex),scenario:String(run.scenario),best:run.scenarioBest},completed:String(run.completed),scope:metadata.scope,notes:metadata.warnings},null,2));}
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
try{
 while(!run.done&&!stopping&&Number(run.examined-initialExamined)<limit&&Number(run.completed-initialCompleted)<conditionLimit&&(Date.now()-start)/1000<seconds){if(pool&&!pool.closed){const step=await parallelStep(run,pool,args.includes('--events'),Math.min(workerCount*16,limit-Number(run.examined-initialExamined)));for(const row of step.rows){line(row);written++;}}else{const step=run.next(args.includes('--events'));if(step.row){line(step.row);written++;}}if(run.examined%100n===0n)await new Promise(r=>setTimeout(r,0));if(Date.now()-last>1000){save();last=Date.now();await new Promise(r=>setTimeout(r,0));}}
 save();console.log(JSON.stringify({resources,complete:run.done,examined:String(run.examined),valid:String(run.valid),output:out,checkpoint,summary}));
}finally{pool?.close();fs.closeSync(fd);}
