#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {cleanInput,buildModel,VERSION} from './core.mjs';
import {readFactoryRecords} from './factory-precompute.mjs';
import {readLocalRecords,solveLocalCatalog,LOCAL_ROOMS} from './facility-precompute.mjs';

export function loadLocalTables(catalog,directory){
 const records=file=>gunzipSync(fs.readFileSync(path.join(directory,file))).toString().trim().split('\n').map(JSON.parse);
 const tables={MANUFACTURE:readFactoryRecords(records('factory-local.ndjson.gz'),{fingerprint:catalog.fingerprint})};
 for(const room of Object.keys(LOCAL_ROOMS))tables[room]=readLocalRecords(records(`local-${room.toLowerCase()}-v1.ndjson.gz`),{fingerprint:catalog.fingerprint});
 return tables;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const get=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
 if(process.argv.includes('--help'))console.log('node facility-search-cli.mjs --input ACTUAL_CONDITIONS.json --output NEW_RESULT.json [--catalog-dir .] [--seconds 5] [--limit 100000]');
 else{
  const file=get('--input',null),output=path.resolve(get('--output','local-search-result.json')),seconds=Number(get('--seconds',5)),limit=Number(get('--limit',100000));
  if(!file)throw Error('Specify one actual owned-condition JSON with --input');
  if(!Number.isFinite(seconds)||seconds<=0||seconds>300||!Number.isInteger(limit)||limit<1)throw Error('Invalid time/plan budget');
  if(fs.existsSync(output))throw Error('Output already exists; use a new output file');
  const start=performance.now(),catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),input=cleanInput(JSON.parse(fs.readFileSync(file)),catalog);
  if(input.options.development!=='current')throw Error('This command accepts current owned conditions only');
  const tables=loadLocalTables(catalog,path.resolve(get('--catalog-dir',path.dirname(fileURLToPath(import.meta.url))))),model=buildModel(catalog,input),preparationMs=performance.now()-start;
  const result=solveLocalCatalog(model,tables,{maxPlans:limit,maxMilliseconds:seconds*1000});
  const report={format:'current-roster-local-search-1',modelVersion:VERSION,fingerprint:catalog.fingerprint,preparationMs,...result,excluded:model.excluded,warnings:[...model.warnings,'Experimental catalog composition; a limited search is not an optimality proof.','Local snapshots are all-active only. Final fatigue, dorm and shift effects use the existing simulator.']};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,complete:result.complete,modelOptimalityProven:result.modelOptimalityProven,plans:result.stats?.plans,errors:result.errors,preparationMs,elapsedMs:result.elapsedMs,score:result.best?.score??null},null,2));
 }
}
