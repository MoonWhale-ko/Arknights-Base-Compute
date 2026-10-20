#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanInput,buildModel,VERSION,simulate,score} from './core.mjs';
import {solveHeuristic} from './heuristic.mjs';
import {createTerraModel,INTEGRATED_VERSION} from './terra-model.mjs';

export function runHeuristic(catalog,raw,options={}){
 if(raw.layoutSearch)throw Error('기지 구성 하나와 현재 보유 상태를 입력하세요. 전체 시설 구성 열거는 지원하지 않습니다.');
 const start=performance.now(),model=options.engine==='terra'?createTerraModel(catalog,raw):buildModel(catalog,cleanInput(raw,catalog)),preparationMs=performance.now()-start;
 const result=solveHeuristic(model,options);
 if(options.engine==='terra'&&result.best){const checked=simulate(model,result.best.plan,{record:true});result.best={...result.best,...checked,score:score(model,checked)};}
 return {modelVersion:options.engine==='terra'?INTEGRATED_VERSION:VERSION,fingerprint:model.catalog.fingerprint,preparationMs,...result,...options.engine==='terra'?{warnings:model.warnings}: {}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const value=(flag,fallback)=>{const i=process.argv.indexOf(flag);return i<0?fallback:process.argv[i+1];};
 if(process.argv.includes('--help'))console.log('node heuristic-cli.mjs --input CURRENT.json --output NEW.json [--engine terra|legacy] [--seconds 10] [--evaluations 10000] [--starts 2] [--rounds 8] [--top 40] [--exact-threshold 10000]');
 else{
  const inputFile=value('--input',null),output=value('--output',null);
  if(!inputFile||!output)throw Error('--input 및 --output을 지정하세요.');
  if(fs.existsSync(output))throw Error('기존 파일은 덮어쓰지 않습니다. 새 출력 파일을 지정하세요.');
  const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),raw=JSON.parse(fs.readFileSync(inputFile));
  const engine=value('--engine','terra');if(!['terra','legacy'].includes(engine))throw Error('엔진은 terra 또는 legacy를 선택하세요.');
  const report=runHeuristic(catalog,raw,{engine,maxMilliseconds:Number(value('--seconds',10))*1000,maxEvaluations:Number(value('--evaluations',10000)),starts:Number(value('--starts',2)),rounds:Number(value('--rounds',8)),topCandidates:Number(value('--top',40)),exactThreshold:Number(value('--exact-threshold',10000))});
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,elapsedMs:report.elapsedMs,preparationMs:report.preparationMs,stopReason:report.stopReason,stats:report.stats,score:report.best?.score??null,modelOptimalityProven:report.modelOptimalityProven,excluded:report.excluded.length},null,2));
 }
}
