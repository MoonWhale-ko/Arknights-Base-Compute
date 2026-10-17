import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {workerResources} from './resources.mjs';import {prepareRemoteInput,remoteSettings} from './actions-run.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),demo=JSON.parse(fs.readFileSync(path.join(root,'demo.json')));
test('4-vCPU runner reserves one CPU by default and explicit 4-worker comparison remains possible',()=>{
 assert.equal(workerResources(4,'auto',true).workers,3);assert.equal(workerResources(4,'4',true).workers,4);
 assert.equal(workerResources(4,'8',true).workers,4);assert.equal(workerResources(2,'3',true).workers,2);assert.equal(workerResources(1,'auto',true).workers,1);
 assert.equal(workerResources(16,'8',false).workers,8);assert.throws(()=>workerResources(4,'0',true));
});
test('remote run settings reject unsafe run IDs and excessive execution budgets',()=>{
 assert.deepEqual(remoteSettings({}),{minutes:60,workers:'3',resume:false});
 for(const env of [{COMPUTE_MINUTES:'301'},{COMPUTE_MINUTES:'0'},{COMPUTE_WORKERS:'8'},{RESUME_RUN_ID:'12;echo hi'}])assert.throws(()=>remoteSettings(env));
 assert.equal(remoteSettings({RESUME_RUN_ID:'12345'}).resume,true);
});
test('remote input is normalized, strips account fields, and cannot read outside workspace',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'infra-input-'));try{
  const raw={...demo,email:'must-not-be-persisted',uid:'private'};fs.writeFileSync(path.join(dir,'conditions.json'),JSON.stringify(raw));
  const file=prepareRemoteInput({inputFile:'conditions.json',outputDir:path.join(dir,'output'),workspace:dir}),text=fs.readFileSync(file,'utf8');assert.ok(!text.includes('must-not-be-persisted'));assert.ok(!text.includes('private'));
  assert.throws(()=>prepareRemoteInput({inputFile:'../outside.json',outputDir:path.join(dir,'other'),workspace:dir}),/저장소 안/);
  assert.throws(()=>prepareRemoteInput({inputFile:'',outputDir:path.join(dir,'output'),resume:true,workspace:dir}),/재개 파일 누락/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('CLI checkpoints resume across worker counts with no duplicate completed records',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'infra-resume-'));try{
  const out=path.join(dir,'results.ndjson'),baseArgs=[path.join(root,'cli.mjs'),'--input',path.join(root,'demo.json'),'--output',out];
  const first=spawnSync(process.execPath,[...baseArgs,'--workers','1','--limit','5'],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  const second=spawnSync(process.execPath,[...baseArgs,'--workers','3','--resume'],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);
  const rows=fs.readFileSync(out,'utf8').trim().split('\n').map(JSON.parse),results=rows.filter(x=>x.type==='condition-result');assert.equal(results.length,1);assert.equal(results[0].evaluationErrors,0);assert.equal(results[0].searchComplete,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
