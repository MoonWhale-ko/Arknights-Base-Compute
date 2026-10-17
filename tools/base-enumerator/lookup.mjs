#!/usr/bin/env node
import fs from 'node:fs';import readline from 'node:readline';
import {conditionKey} from './conditions.mjs';
const [results,conditions,output]=process.argv.slice(2);
if(!results||!conditions){console.error('node lookup.mjs results.ndjson my-conditions.json [matched.json]');process.exit(2);}
const catalog=JSON.parse(fs.readFileSync(new URL('./data/catalog.json',import.meta.url))),input=JSON.parse(fs.readFileSync(conditions)),key=conditionKey(catalog,input);
let match=null;for await(const line of readline.createInterface({input:fs.createReadStream(results),crlfDelay:Infinity})){if(!line.trim())continue;const row=JSON.parse(line);if(row.type==='condition-result'&&row.conditionKey===key&&row.searchComplete)match=row;}
const result=match?{found:true,result:match}:{found:false,message:'현재 버전·보유·해금·시설·운영 조건과 정확히 일치하는 완료 결과가 없습니다. 추가 계산이 필요합니다.'};
if(output)fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});else console.log(JSON.stringify(result,null,2));
