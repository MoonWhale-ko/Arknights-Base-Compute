import {cleanInput,buildModel,VERSION} from './core.mjs';
import {solveHeuristic} from './heuristic.mjs';
let catalog;
self.onmessage=async({data})=>{
 try{
  if(data.input?.layoutSearch)throw Error('전체 기지 구성이 아닌 현재 기지 구성 하나를 입력하세요.');
  catalog??=await fetch('./data/catalog.json').then(r=>{if(!r.ok)throw Error('스킬 데이터를 불러오지 못했습니다.');return r.json();});
  const input=cleanInput(data.input,catalog),model=buildModel(catalog,input);
  self.postMessage({type:'started',owned:model.pool.length,excluded:model.excluded.length});
  const result=solveHeuristic(model,{...data.options,onProgress:progress=>self.postMessage({type:'progress',progress})});
  self.postMessage({type:'result',result:{modelVersion:VERSION,fingerprint:catalog.fingerprint,...result}});
 }catch(e){self.postMessage({type:'error',message:e.message});}
};
