#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {localProfiles,localRecords,readLocalRecords,selectLocalCandidates,LOCAL_ROOMS} from './facility-precompute.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
export const OLD_FACTORY_FILES=['factory-precompute.mjs','factory-precompute-cli.mjs','factory-precompute.test.mjs','factory-local.ndjson.gz','factory-local.ndjson.gz.metrics.json','FACTORY-PRECOMPUTE.md'];
export function preservationHashes(directory){return Object.fromEntries(OLD_FACTORY_FILES.map(name=>{const file=path.join(directory,name);return [name,fs.existsSync(file)?sha(fs.readFileSync(file)):null];}));}
async function writeGzipRows(file,rows){
 if(fs.existsSync(file))throw Error('Output already exists; select a new output directory: '+file);
 let rawBytes=0,records=0;const hash=createHash('sha256'),temporary=file+'.tmp';
 const encode=new Transform({writableObjectMode:true,transform(row,encoding,done){const data=Buffer.from(JSON.stringify(row)+'\n');rawBytes+=data.length;records++;hash.update(data);done(null,data);}});
 try{await pipeline(Readable.from(rows),encode,createGzip({level:6}),fs.createWriteStream(temporary,{flags:'wx'}));fs.renameSync(temporary,file);}
 catch(error){fs.rmSync(temporary,{force:true});throw error;}
 return {rawBytes,gzipBytes:fs.statSync(file).size,records,rawSha256:hash.digest('hex'),gzipSha256:sha(fs.readFileSync(file))};
}
export async function writeLocalCatalog(catalog,room,file,{operatorIds}={}){
 const start=performance.now(),header=localProfiles(catalog,room,{operatorIds}),stats={};fs.mkdirSync(path.dirname(file),{recursive:true});
 const sizes=await writeGzipRows(file,localRecords(header,{stats})),seconds=(performance.now()-start)/1000;
 const loadStart=performance.now(),table=readLocalRecords(gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').map(JSON.parse),{fingerprint:catalog.fingerprint}),loadMs=performance.now()-loadStart;
 const progress=Object.fromEntries(Object.values(catalog.characters).map(o=>[o.id,{owned:true,elite:o.maxLevels.length-1,level:o.maxLevels.at(-1)}]));
 const filterStart=performance.now(),probe=selectLocalCandidates(table,catalog,progress,{level:3,clueExchangeActive:false,missingClues:[1,3]});
 return {room,file:path.basename(file),mode:header.mode,operatorsExamined:header.examinedOperators,supportedOperators:new Set(header.profiles.map(p=>p.operator)).size,supportedProfiles:header.profiles.length,unsupportedProfiles:header.excluded.length,unsupportedOperators:new Set(header.excluded.map(p=>p.operator)).size,...stats,...sizes,seconds,loadMs,probe:{filterMs:performance.now()-filterStart,candidates:probe.rows.length,rejectedCombinations:probe.rejected.length,excludedOperators:probe.excluded.length,assumption:'All owned, maximum development, level 3, exchange inactive, missing clues 1/3.'},dependencies:header.dependencies};
}
export async function writeExpansion(catalog,directory,{operatorIds,preserveDirectory=path.dirname(fileURLToPath(import.meta.url))}={}){
 fs.mkdirSync(directory,{recursive:true});const before=preservationHashes(preserveDirectory),start=performance.now(),facilities=[];
 // No remote dispatch, whole-roster enumeration, or five-seat expansion.
 for(const room of Object.keys(LOCAL_ROOMS))facilities.push(await writeLocalCatalog(catalog,room,path.join(directory,`local-${room.toLowerCase()}-v1.ndjson.gz`),{operatorIds}));
 const contexts=['CONTROL','DORMITORY'].map(room=>localProfiles(catalog,room,{operatorIds}));
 const contextFile=path.join(directory,'local-context-profiles-v1.ndjson.gz'),contextSizes=await writeGzipRows(contextFile,contexts);
 const after=preservationHashes(preserveDirectory),preserved=JSON.stringify(before)===JSON.stringify(after);
 if(!preserved)throw Error('Previous factory files changed unexpectedly');
 const report={format:'facility-expansion-experiment-1',fingerprint:catalog.fingerprint,modelVersion:contexts[0].modelVersion,complete:true,scope:'Four local candidate catalogs; control/dorm profiles only. Global solver is a small bounded composition experiment, not deployed.',facilities,contextProfiles:{file:path.basename(contextFile),...contextSizes,rooms:contexts.map(h=>({room:h.room,mode:h.mode,supportedProfiles:h.profiles.length,supportedOperators:new Set(h.profiles.map(p=>p.operator)).size,unsupportedProfiles:h.excluded.length,fullFiveSeatEnumeration:false}))},seconds:(performance.now()-start)/1000,peakProcessRssMiB:process.resourceUsage().maxRSS/1024,nodeVersion:process.version,platform:process.platform,previousFactoryFiles:{preserved,sha256:before},warnings:['No previously unsupported skills are newly implemented by this experiment.','Trade uses the existing baseline/mature scenario expectations, not confidence bounds.','Meeting speed/ambience remains the existing experimental formula; no clue probability estimates.','Power output stores recovery skill bonuses, not a full 24h drone production ledger.','Full-base correctness, repeated-shift sustainability and practical global runtime remain unverified.','No site deployment or long-running remote compute was started.']};
 const reportFile=path.join(directory,'LOCAL-CATALOG-EXPANSION.json');if(fs.existsSync(reportFile))throw Error('Report already exists');fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const i=process.argv.indexOf('--output-dir');const directory=path.resolve(i<0?'local-catalog-v1':process.argv[i+1]);
 if(process.argv.includes('--help'))console.log('node facility-precompute-cli.mjs --output-dir NEW_DIRECTORY');
 else{const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url)));console.log(JSON.stringify(await writeExpansion(catalog,directory),null,2));}
}
