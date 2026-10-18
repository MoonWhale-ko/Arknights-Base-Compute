#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {factoryProfiles,factoryRecords,readFactoryRecords,matchingFactoryProfiles,factoryCandidates} from './factory-precompute.mjs';

export async function writeFactoryCatalog(catalog,output,{operatorIds,maxSeats=3}={}){
 const start=performance.now(),header=factoryProfiles(catalog,{operatorIds}),stats={},hash=createHash('sha256');
 let rawBytes=0,records=0;fs.mkdirSync(path.dirname(output),{recursive:true});
 const temporary=output+'.tmp';
 const encode=new Transform({writableObjectMode:true,transform(row,encoding,done){
  const data=Buffer.from(JSON.stringify(row)+'\n');rawBytes+=data.length;records++;hash.update(data);done(null,data);
 }});
 try{await pipeline(Readable.from(factoryRecords(header,{maxSeats,stats})),encode,createGzip({level:6}),fs.createWriteStream(temporary));fs.renameSync(temporary,output);}
 catch(error){fs.rmSync(temporary,{force:true});throw error;}
 const seconds=(performance.now()-start)/1000;
 const report={format:header.format,modelVersion:header.modelVersion,fingerprint:header.fingerprint,complete:true,
  scope:header.scope,operatorsExamined:header.examinedOperators,supportedOperators:new Set(header.profiles.map(p=>p.operator)).size,
  supportedProfiles:header.profiles.length,unsupportedProfiles:header.excluded.length,unsupportedOperators:new Set(header.excluded.map(p=>p.operator)).size,
  noFactoryOperators:header.noFactoryOperators,...stats,records,rawBytes,gzipBytes:fs.statSync(output).size,seconds,
  combinationsPerSecond:stats.combinations/seconds,peakProcessRssMiB:process.resourceUsage().maxRSS/1024,
  rawSha256:hash.digest('hex'),nodeVersion:process.version,platform:process.platform,arch:process.arch,
  externalDependencies:header.dependencies,allOwnedRostersEnumerated:false,fullBaseOptimizer:false,
  warnings:['Matches only the existing supported local factory model; game accuracy is not established.',
   'No top-N operator pruning; identities and local skill unlock requirements are preserved.',
   'Full-base linkage, fatigue, dorms, shifts and 24h/cycle results still require final simulation.',
   'Timing is for this machine and this limited scope, not a full-base runtime prediction.']};
 fs.writeFileSync(output+'.metrics.json',JSON.stringify(report,null,2)+'\n');return report;
}
export function probeFactoryCatalog(catalog,output){
 const start=performance.now(),data=gunzipSync(fs.readFileSync(output)).toString();
 const table=readFactoryRecords(data.trim().split('\n').map(JSON.parse),{fingerprint:catalog.fingerprint}),loadMs=performance.now()-start;
 const progress=Object.fromEntries(Object.values(catalog.characters).map(o=>[o.id,{owned:true,elite:o.maxLevels.length-1,level:o.maxLevels.at(-1)}]));
 const t=performance.now(),matches=matchingFactoryProfiles(table.header,catalog,progress);let count=0;
 for(const row of factoryCandidates(table,catalog,progress,{level:3,recipeId:'4'}))count++;
 const probe={loadMs,filterMs:performance.now()-t,availableProfiles:matches.available.size,excludedOperators:matches.excluded.length,candidates:count};
 const report=JSON.parse(fs.readFileSync(output+'.metrics.json'));report.fullOwnedMaxUnlockProbe=probe;fs.writeFileSync(output+'.metrics.json',JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const get=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
 if(process.argv.includes('--help')){console.log('node factory-precompute-cli.mjs --output outputs/factory-local.ndjson.gz [--max-seats 3] [--probe]');}
 else{
  const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url)));
  const output=path.resolve(get('--output','outputs/factory-local.ndjson.gz'));
  let report=await writeFactoryCatalog(catalog,output,{maxSeats:Number(get('--max-seats',3))});
  if(process.argv.includes('--probe'))report=probeFactoryCatalog(catalog,output);
  console.log(JSON.stringify(report,null,2));
 }
}
