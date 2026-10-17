// node benchmark-search.mjs [report.json]
import fs from 'node:fs';import {Run} from './runner.mjs';import {compare,VERSION} from './core.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url)));
function execute(raw,strategy){const input=structuredClone(raw);input.options.searchStrategy=strategy;const run=new Run(catalog,input),start=performance.now();let row;while(!run.done){const s=run.next();if(s.row)row=s.row;}if(!row?.best||row.evaluationErrors)throw Error('Benchmark did not complete cleanly');return {strategy,milliseconds:performance.now()-start,simulated:Number(row.examined),boundPruned:Number(row.boundPruned),candidateCacheHits:row.candidateCacheHits,controlEffectsCacheHits:row.controlEffectsCacheHits,score:row.best.score};}
const cases=[];
for(const file of ['demo.json','examples/quality-trading.json']){
 const raw=JSON.parse(fs.readFileSync(new URL(file,import.meta.url)));execute(raw,'bounded');execute(raw,'exhaustive');
 const records={};for(const strategy of ['exhaustive','bounded']){const trials=Array.from({length:3},()=>execute(raw,strategy));records[strategy]={...trials[0],medianMilliseconds:trials.map(x=>x.milliseconds).sort((a,b)=>a-b)[1]};delete records[strategy].milliseconds;}
 if(compare(records.exhaustive.score,records.bounded.score)!==0)throw Error('Optimum mismatch');cases.push({file,...records,sameBestScore:true,reduction:1-records.bounded.simulated/records.exhaustive.simulated});
}
const report={version:VERSION,generatedAt:new Date().toISOString(),scope:'Two small fixtures; no full-roster timing or optimality claim.',cases};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
