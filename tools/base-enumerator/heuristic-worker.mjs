import {cleanInput,buildModel,VERSION,simulate,score} from './core.mjs';
import {solveHeuristic} from './heuristic.mjs';
import {createTerraModel,INTEGRATED_VERSION} from './terra-model.mjs';
let catalog;
self.onmessage=async({data})=>{
 try{
  if(data.input?.layoutSearch)throw Error('전체 기지 구성이 아닌 현재 기지 구성 하나를 입력하세요.');
  catalog??=await fetch('./data/catalog.json').then(r=>{if(!r.ok)throw Error('스킬 데이터를 불러오지 못했습니다.');return r.json();});
  const useTerra=data.engine==='terra',model=useTerra?createTerraModel(catalog,data.input):buildModel(catalog,cleanInput(data.input,catalog));
  self.postMessage({type:'started',owned:model.pool.length,excluded:model.excluded.length});
  const result=solveHeuristic(model,{...data.options,onProgress:progress=>self.postMessage({type:'progress',progress})});
  if(useTerra&&result.best){const checked=simulate(model,result.best.plan,{record:true});result.best={...result.best,...checked,score:score(model,checked)};}
  self.postMessage({type:'result',result:{modelVersion:useTerra?INTEGRATED_VERSION:VERSION,fingerprint:model.catalog.fingerprint,...result,...(useTerra?{warnings:model.warnings}:{})}});
 }catch(e){self.postMessage({type:'error',message:e.message});}
};
