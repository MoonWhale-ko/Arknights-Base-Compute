// Fixed output files let download-artifact restore the previous checkpoint.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {Run} from './runner.mjs';
const toolRoot=path.dirname(fileURLToPath(import.meta.url));
export function prepareRemoteInput({inputFile,outputDir,resume=false,workspace=process.cwd()}){
 fs.mkdirSync(outputDir,{recursive:true});const normalized=path.join(outputDir,'compute-input.json');
 if(resume){for(const name of ['compute-input.json','results.ndjson','results.ndjson.checkpoint.json'])if(!fs.existsSync(path.join(outputDir,name)))throw Error('재개 파일 누락: '+name);return normalized;}
 const source=path.resolve(workspace,inputFile),relative=path.relative(workspace,source);
 if(relative.startsWith('..')||path.isAbsolute(relative)||!source.endsWith('.json'))throw Error('저장소 안의 JSON 조건 파일을 지정하세요.');
 const raw=JSON.parse(fs.readFileSync(source)),catalog=JSON.parse(fs.readFileSync(path.join(toolRoot,'data/catalog.json'))),run=new Run(catalog,raw);
 const safe={...run.template,...(run.layoutConfig?{layoutSearch:run.layoutConfig}:{})};fs.writeFileSync(normalized,JSON.stringify(safe,null,2)+'\n');return normalized;
}
export function remoteSettings(env){
 const minutes=Number(env.COMPUTE_MINUTES??60),workers=String(env.COMPUTE_WORKERS??'3');
 if(!Number.isInteger(minutes)||minutes<1||minutes>300)throw Error('실행 시간은 1~300분이어야 합니다.');
 if(!['auto','1','2','3','4'].includes(workers))throw Error('GitHub 동시 검증 수는 auto 또는 1~4입니다.');
 const resumeId=String(env.RESUME_RUN_ID??'');if(resumeId&&!/^\d+$/.test(resumeId))throw Error('재개 실행 번호는 숫자여야 합니다.');
 return {minutes,workers,resume:!!resumeId};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const settings=remoteSettings(process.env),outputDir=path.resolve(process.env.COMPUTE_OUTPUT??path.join(process.env.RUNNER_TEMP??process.cwd(),'infra-compute'));
 const input=prepareRemoteInput({inputFile:process.env.COMPUTE_INPUT??'tools/base-enumerator/examples/quality-trading.json',outputDir,resume:settings.resume});
 const args=[path.join(toolRoot,'cli.mjs'),'--input',input,'--output',path.join(outputDir,'results.ndjson'),'--workers',settings.workers,'--seconds',String(settings.minutes*60),...(settings.resume?['--resume']:[])];
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status??1;
}
