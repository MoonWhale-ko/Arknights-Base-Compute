import {buildModel,simulate} from './core.mjs';
export function createEvaluationHandler(){
 let catalog=null,key=null,model=null;
 return message=>{
  if(message.type==='init'){catalog=message.catalog;return null;}
  if(message.type!=='evaluate')return null;
  const {seq,context,jobs}=message;
  try{
   if(key!==context.key){model=buildModel(catalog,context.input);model.snapshotCache=new Map();key=context.key;}
   return {seq,results:jobs.map(job=>{try{return {id:job.id,result:simulate(model,job.plan,{record:job.record})};}catch(error){return {id:job.id,error:error.message};}})};
  }catch(error){return {seq,results:jobs.map(job=>({id:job.id,error:error.message}))};}
 };
}
