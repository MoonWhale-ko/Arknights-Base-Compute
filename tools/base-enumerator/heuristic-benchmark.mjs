#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanInput,buildModel,Enumerator,simulate,score,compare} from './core.mjs';
import {runHeuristic} from './heuristic-cli.mjs';
import {preservationHashes} from './facility-precompute-cli.mjs';
export function fullRosterExample(catalog,{teams=2,rotation='12h'}={}){
 const rooms={control:{type:'CONTROL',level:5},office:{type:'HIRE',level:3},meeting:{type:'MEETING',level:3},training:{type:'TRAINING',level:3},workshop:{type:'WORKSHOP',level:1}};
 for(let i=0;i<3;i++)rooms['power'+i]={type:'POWER',level:3};
 for(let i=0;i<2;i++)rooms['trade'+i]={type:'TRADING',level:3};
 for(let i=0;i<4;i++){rooms['factory'+i]={type:'MANUFACTURE',level:3};rooms['dorm'+i]={type:'DORMITORY',level:5,ambience:5000};}
 const products=Object.fromEntries(Array.from({length:4},(_,i)=>['factory'+i,i<2?'4':'3']));
 return {base:{rooms},products,progress:Object.fromEntries(Object.values(catalog.characters).map(op=>[op.id,{owned:true,elite:op.maxLevels.length-1,level:op.maxLevels.at(-1)}])),options:{teams,rotation,maxHours:168,rankingWindow:'24h',optimizeDormSupport:true,missingClues:[1,3]}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const i=process.argv.indexOf('--output'),output=i<0?null:process.argv[i+1];if(!output||fs.existsSync(output))throw Error('--output NEW.json을 지정하세요. 기존 파일은 덮어쓰지 않습니다.');
 const directory=path.dirname(fileURLToPath(import.meta.url)),before=preservationHashes(directory),catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),quality=JSON.parse(fs.readFileSync(new URL('./examples/quality-trading.json',import.meta.url)));
 const model=buildModel(catalog,cleanInput(quality,catalog)),iterator=new Enumerator({...model,symmetry:false});let oracle=null,plans=0;const start=performance.now();
 while(true){const s=iterator.advance();if(s.done)break;if(!s.plan)continue;plans++;const result=simulate(model,s.plan),v=score(model,result);if(v&&(!oracle||compare(v,oracle)>0))oracle=v;}
 const exhaustiveMs=performance.now()-start,small=runHeuristic(catalog,quality,{maxMilliseconds:10000,exactThreshold:0}),large=runHeuristic(catalog,fullRosterExample(catalog),{maxMilliseconds:10000,exactThreshold:0}),after=preservationHashes(directory);
 const report={format:'heuristic-measurements-1',node:process.version,platform:process.platform,fingerprint:catalog.fingerprint,
  source:{url:'https://terra-archive.net/infra',inspection:'Search mechanism inspected from a previously saved public deployment snapshot, downloaded 2026-10-16. The live page was also viewed 2026-10-19. Latest engine bundle was not retrieved; no claim of byte-for-byte or current-version parity.',snapshotFile:'planner-engine-DV9XFkhq.js',redistributedThirdPartyCode:false},
  qualityOracle:{plans,elapsedMs:exhaustiveMs,score:oracle},small:{matchesOracle:compare(small.best.score,oracle)===0,...small},
  fullRoster:{owned:Object.keys(catalog.characters).length,layout:'243; 3 power level 3, 2 trading level 3, 4 factories level 3; 4 dorms level 5/5000; office/meeting/training level 3; workshop level 1',synthetic:true,...large},
  previousFactoryFiles:{preserved:JSON.stringify(before)===JSON.stringify(after),sha256:after},warnings:['Measurements depend on the machine. A short runtime is not evidence of near-optimality.','The 415-owned example still excludes unsupported effects; it is not an all-skills game-accuracy test.','No production site deployment or remote Actions run.']};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,smallMs:small.elapsedMs,oracleMs:exhaustiveMs,matches:report.small.matchesOracle,largeMs:large.elapsedMs,stats:large.stats,preserved:report.previousFactoryFiles.preserved},null,2));
}
