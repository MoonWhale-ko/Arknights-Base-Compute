import {VERSION,stable,cleanInput,buildModel,Enumerator,developmentStates,scenarioAt,scenarioCount,simulate,score,compare} from './core.mjs';
import {cleanLayoutSearch,LayoutStream,validateLayout} from './layouts.mjs';
import {conditionKey} from './conditions.mjs';
export class Run{
 constructor(catalog,raw,saved){
  this.catalog=catalog;this.layoutConfig=cleanLayoutSearch(raw.layoutSearch,catalog);
  if(this.layoutConfig&&(Object.values(raw.dormSupport??{}).flat().length||(raw.residents??[]).length||Object.keys(raw.candidates??{}).length))throw Error('시설 자동 생성에서는 특정 방의 고정 인원·후보 제한을 비워주세요.');
  const seed=this.layoutConfig?{...raw,base:{rooms:{control:{type:'CONTROL',level:1},power:{type:'POWER',level:1}}},products:{}}:raw;
  this.template=cleanInput(seed,catalog);this.input=structuredClone(this.template);this.signature=stable({version:VERSION,catalog:catalog.fingerprint,input:this.template,layoutSearch:this.layoutConfig});
  if(saved&&saved.signature!==this.signature)throw Error('입력 조건·계산기 버전·스킬 데이터가 달라 이어서 실행할 수 없습니다.');
  this.groups=developmentStates(catalog,this.template);this.totalScenarios=scenarioCount(this.groups);this.scenario=BigInt(saved?.scenario??0);this.examined=BigInt(saved?.examined??0);this.valid=BigInt(saved?.valid??0);this.completed=BigInt(saved?.completed??0);this.layoutIndex=BigInt(saved?.layoutIndex??0);
  this.best=saved?.best??null;this.scenarioBest=saved?.scenarioBest??null;this.conditionExamined=BigInt(saved?.conditionExamined??0);this.conditionValid=BigInt(saved?.conditionValid??0);this.errors=saved?.errors??0;this.lastError=saved?.lastError??null;this.enumState=saved?.enumerator??null;this.model=null;this.enumerator=null;this.done=saved?.done??false;this.candidateCache=new Map();this.facilityTables=new Map();this.pendingEvaluations=new Map();
  this.layoutStream=this.layoutConfig?new LayoutStream(catalog,this.layoutConfig,saved?.layoutStream):null;this.activeLayout=saved?.activeLayout??null;this.needLayout=saved?.needLayout??Boolean(this.layoutStream);
  if(this.activeLayout)this.input=cleanInput({...this.template,...this.activeLayout},catalog);
 }
 checkpoint(){if(this.pendingEvaluations.size)throw Error('검증 작업 완료 후 체크포인트를 저장하세요.');return {version:VERSION,signature:this.signature,scenario:String(this.scenario),examined:String(this.examined),valid:String(this.valid),completed:String(this.completed),layoutIndex:String(this.layoutIndex),best:this.best,scenarioBest:this.scenarioBest,conditionExamined:String(this.conditionExamined),conditionValid:String(this.conditionValid),errors:this.errors,lastError:this.lastError,enumerator:this.enumerator?.snapshot()??this.enumState,done:this.done,activeLayout:this.activeLayout,needLayout:this.needLayout,layoutStream:this.layoutStream?.snapshot()??null};}
 describe(){
  if(this.needLayout&&!this.done)this.next();if(!this.model&&!this.done&&!this.needLayout)this.setup();
  return {version:VERSION,scope:'위치 통합 시설 구성 + 보유·해금 조건별 최고 배치 한 건. 지원 스킬·숙소 지원자 조합·정해진 휴식 정책 범위.',currentScenario:String(this.scenario),scenarios:String(this.totalScenarios),layoutMode:this.layoutConfig?'generated':'fixed',layoutIndex:String(this.layoutIndex),completed:String(this.completed),layoutSearch:this.layoutConfig,combinationUpperBound:this.enumerator?String(this.enumerator.upperBound()):null,upperBoundNote:'현재 조건의 중복 인원·동일 방 대칭 제거 전 상한입니다. 전체 조건의 총 개수나 진행률 분모가 아닙니다.',excluded:this.model?.excluded??[],ledger:this.model?.ledger??[],warnings:[...(this.model?.warnings??[]),'시설 검사는 현재 레벨·정원·선행시설·전력 기준입니다. 승급/철거 이력을 통한 도달 가능성은 검증하지 않았습니다.'],input:this.input,catalog:this.catalog.fingerprint,reference:this.catalog.reference,storage:'condition-best-only'};
 }
 setup(){
  if(this.scenario>=this.totalScenarios){if(this.layoutStream){this.needLayout=true;this.scenario=0n;}else this.done=true;return;}
  const progress=scenarioAt(this.groups,this.scenario),input={...this.input,progress};this.power=validateLayout(this.catalog,input);this.model=buildModel(this.catalog,input,progress);this.model.candidateCache=this.candidateCache;this.model.snapshotCache=new Map();this.model.facilityTables=this.facilityTables;this.enumerator=new Enumerator(this.model,this.enumState);if(input.options.searchStrategy==='bounded')this.enumerator.incumbent=()=>this.scenarioBest?.score;this.enumState=null;this.key=conditionKey(this.catalog,input);
 }
 resetCondition(){this.scenario++;this.model=null;this.enumerator=null;this.enumState=null;this.scenarioBest=null;this.conditionExamined=0n;this.conditionValid=0n;this.errors=0;this.lastError=null;if(this.scenario>=this.totalScenarios){if(this.layoutStream){this.needLayout=true;this.scenario=0n;}else this.done=true;}}
 next(record=false,defer=false){
  if(this.done)return {done:true};
  if(this.needLayout){const step=this.layoutStream.advance();if(step.done){this.done=true;return {done:true};}if(step.yield)return {yield:true};this.activeLayout=step.value;this.input=cleanInput({...this.template,...step.value},this.catalog);this.layoutIndex++;this.needLayout=false;return {yield:true};}
  if(!this.model){try{this.setup();}catch(error){const progress=scenarioAt(this.groups,this.scenario),row={type:'condition-rejected',scenario:String(this.scenario),layoutIndex:String(this.layoutIndex),input:{...this.input,progress},message:error.message,searchComplete:false};this.resetCondition();return {row};}if(!this.model)return {yield:true};}
  const step=this.enumerator.advance(3000);if(step.yield)return {yield:true};
  if(step.done){
   if(this.pendingEvaluations.size)return {waiting:true};
   const row={type:'condition-result',version:VERSION,catalog:this.catalog.fingerprint,conditionKey:this.key,condition:{...this.input,progress:scenarioAt(this.groups,this.scenario)},scenario:String(this.scenario),layoutIndex:String(this.layoutIndex),ownedCount:this.model.pool.length,searchComplete:true,modelOptimalityProven:this.errors===0&&this.scenarioBest!==null,gameOptimalityProven:false,constructionHistoryChecked:false,power:this.power,examined:String(this.conditionExamined),valid:String(this.conditionValid),symmetryPruned:String(this.enumerator.symmetryPruned),boundPruned:String(this.enumerator.prunedByBound),searchStrategy:this.input.options.searchStrategy,snapshotCacheHits:this.model.snapshotHits??0,controlEffectsCacheHits:this.model.controlEffectsHits??0,candidateCacheHits:this.enumerator.cacheHits,evaluationErrors:this.errors,lastError:this.lastError,excluded:this.model.excluded,warnings:this.model.warnings,best:this.scenarioBest};
   this.completed++;this.resetCondition();return {row};
  }
  this.examined++;this.conditionExamined++;
  const job={id:String(this.examined),key:this.key,input:this.model.input,plan:step.plan,record};this.pendingEvaluations.set(job.id,job);
  if(defer)return {evaluation:job};
  try{this.resolveEvaluation(job.id,simulate(this.model,job.plan,{record}));}catch(error){if(this.pendingEvaluations.has(job.id))this.resolveEvaluation(job.id,null,error.message);else throw error;}
  return {yield:true};
 }
 resolveEvaluation(id,result,error){
  const job=this.pendingEvaluations.get(id);if(!job)throw Error('중복되거나 알 수 없는 검증 작업');this.pendingEvaluations.delete(id);
  if(error){this.errors++;this.lastError=error;return;}
  const value=score(this.model,result);if(!value)return;this.valid++;this.conditionValid++;
  const candidate={caseId:id,scenario:String(this.scenario),layoutIndex:String(this.layoutIndex),development:this.model.pool.map(o=>({id:o.id,elite:o.elite,level:o.level})),score:value,plan:job.plan,at24:result.at24,cycle:result.cycle,cycleStatus:result.cycleStatus,reason:result.reason,...(job.record?{events:result.events}:{})};
  const better=previous=>!previous||compare(value,previous.score)>0||compare(value,previous.score)===0&&BigInt(id)<BigInt(previous.caseId);
  if(better(this.scenarioBest))this.scenarioBest=candidate;
  if(better(this.best))this.best=candidate;
 }
}
