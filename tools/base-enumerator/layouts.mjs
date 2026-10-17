// Position-free, resumable facility/product generation. Construction history is
// intentionally not inferred from a final configuration.
const layoutStable=v=>JSON.stringify(v);
function layoutAssert(ok,message){if(!ok)throw Error(message);}
function layoutRange(v,min,max,label){const a=v??[min,max];layoutAssert(Array.isArray(a)&&a.length===2&&a.every(Number.isInteger)&&a[0]>=min&&a[1]<=max&&a[0]<=a[1],label+' 범위 오류');return [...a];}
function layoutMultisets(values,min,max){const out=[];function add(start,seq){if(seq.length>=min)out.push([...seq]);if(seq.length===max)return;for(let i=start;i<values.length;i++){seq.push(values[i]);add(i,seq);seq.pop();}}add(0,[]);return out;}
export function cleanLayoutSearch(raw,catalog){
 if(!raw||raw.enabled===false)return null;
 const levels=[...new Set(raw.controlLevels??[1,2,3,4,5])].sort((a,b)=>a-b),powers=[...new Set(raw.powerCounts??[1,2,3])].sort();
 layoutAssert(levels.length&&levels.every(n=>Number.isInteger(n)&&n>=1&&n<=5),'제어센터 범위 오류');layoutAssert(powers.length&&powers.every(n=>[1,2,3].includes(n)),'발전소 개수 오류');
 const recipes=[...new Set((raw.recipes??Object.keys(catalog.recipes)).map(String))].sort();layoutAssert(recipes.length&&recipes.every(id=>Object.hasOwn(catalog.recipes,id)),'제조 품목 오류');
 const ambience=raw.ambience??'max';layoutAssert(ambience==='max'||Number.isInteger(ambience)&&ambience>=0&&ambience<=5000,'인테리어는 max 또는 0~5000 정수입니다.');
 return {enabled:true,controlLevels:levels,powerCounts:powers,factoryCount:layoutRange(raw.factoryCount,0,5,'제조소'),tradingCount:layoutRange(raw.tradingCount,0,5,'무역소'),dormCount:layoutRange(raw.dormCount,0,4,'숙소'),recipes,allSupportBuilt:raw.allSupportBuilt===true,ambience};
}
export function validateLayout(catalog,input){
 const rules=catalog.buildingRules,rooms=Object.values(input.base.rooms).filter(r=>r.level>0),ccs=rooms.filter(r=>r.type==='CONTROL');layoutAssert(ccs.length===1,'제어센터 1개가 필요합니다.');const cc=ccs[0].level,max=cc<3?1:cc===3?2:3;
 const of=t=>rooms.filter(r=>r.type===t),outputs=rooms.filter(r=>['MANUFACTURE','TRADING','POWER'].includes(r.type));
 layoutAssert(outputs.length<=(cc<3?3:cc===3?6:9),'생산시설 칸 초과');layoutAssert(of('POWER').length>=1&&of('POWER').length<=(cc<3?1:3),'발전소는 현재 제어센터에서 가능한 1~3개여야 합니다.');
 for(const type of ['MANUFACTURE','TRADING'])layoutAssert(of(type).length<=(cc<3?1:5),'생산시설 종류별 개수 초과');
 for(const r of outputs)layoutAssert(r.level<=max,'제어센터 대비 생산시설 레벨 초과');
 for(const [type,minCC]of [['WORKSHOP',1],['MEETING',2],['HIRE',3],['TRAINING',4]]){const rs=of(type);layoutAssert(rs.length<=1&&(!rs.length||cc>=minCC&&rs[0].level<=max),type+' 개방/레벨 조건 오류');}
 layoutAssert(!(of('MEETING').length||of('HIRE').length)||of('WORKSHOP').length,'응접실·사무실의 선행 가공소가 필요합니다.');layoutAssert(!of('TRAINING').length||of('HIRE').length,'훈련실의 선행 사무실이 필요합니다.');
 layoutAssert(of('DORMITORY').length<=(cc<3?1:cc-1)&&of('DORMITORY').every(r=>r.level<=cc),'숙소 개수/레벨 초과');
 const maxFactory=Math.max(0,...of('MANUFACTURE').map(r=>r.level));for(const [id,r]of Object.entries(input.base.rooms))if(r.type==='MANUFACTURE'){const recipe=catalog.recipes[input.products[id]];layoutAssert(recipe&&recipe.unlockLevel<=maxFactory,'제조 품목 미개방');}
 let supply=0,demand=0;for(const r of rooms){const e=rules.rooms[r.type]?.phases[r.level-1]?.electricity;layoutAssert(Number.isFinite(e),'전력 자료가 없는 시설입니다.');if(e>0)supply+=e;else demand-=e;}
 layoutAssert(demand<=supply,'전체 시설의 소비 전력이 공급 전력을 초과합니다.');return {supply,demand,remaining:supply-demand,constructionHistoryChecked:false};
}
export class LayoutStream{
 constructor(catalog,config,state){this.catalog=catalog;this.config=config;this.depth=state?.depth??0;this.cursor=state?.cursor??Array(7).fill(0);this.selected=state?.selected??Array(7).fill(null);this.done=state?.done??false;this.generated=BigInt(state?.generated??0);this.nodes=BigInt(state?.nodes??0);this.lists=[];this.memo=new Map();}
 snapshot(){return {depth:this.depth,cursor:[...this.cursor],selected:structuredClone(this.selected),done:this.done,generated:String(this.generated),nodes:String(this.nodes)};}
 cached(key,fn){if(this.memo.has(key))return this.memo.get(key);const v=fn();if(this.memo.size>=80)this.memo.delete(this.memo.keys().next().value);this.memo.set(key,v);return v;}
 choices(depth){
  const c=this.config,[cc,power,trades,factories,products,dorms]=this.selected,max=cc<3?1:cc===3?2:3,levels=Array.from({length:max},(_,i)=>i+1),slots=cc<3?3:cc===3?6:9;
  if(depth===0)return c.controlLevels;
  if(depth===1)return this.cached('p'+cc,()=>layoutMultisets(levels,1,cc<3?1:3).filter(v=>c.powerCounts.includes(v.length)));
  if(depth===2)return this.cached('t'+cc+':'+power.length,()=>layoutMultisets(levels,c.tradingCount[0],Math.min(c.tradingCount[1],cc<3?1:5,slots-power.length)));
  if(depth===3)return this.cached('f'+cc+':'+power.length+':'+trades.length,()=>layoutMultisets(levels,c.factoryCount[0],Math.min(c.factoryCount[1],cc<3?1:5,slots-power.length-trades.length)));
  const energy=(type,seq)=>seq.reduce((n,l)=>n+this.catalog.buildingRules.rooms[type].phases[l-1].electricity,0),net=energy('POWER',power)+energy('TRADING',trades)+energy('MANUFACTURE',factories);
  if(net<0)return [];
  if(depth===4)return this.cached('r'+factories.join(','),()=>{const available=c.recipes.filter(id=>this.catalog.recipes[id].unlockLevel<=Math.max(0,...factories));let out=[[]];for(const level of levels){const count=factories.filter(n=>n===level).length,parts=layoutMultisets(available,count,count);out=out.flatMap(prefix=>parts.map(part=>[...prefix,...part.map(recipe=>({level,recipe}))]));}return out;});
  if(depth===5)return this.cached('d'+cc+':'+net,()=>layoutMultisets(Array.from({length:cc},(_,i)=>i+1),c.dormCount[0],Math.min(c.dormCount[1],cc<3?1:cc-1)).filter(v=>net+energy('DORMITORY',v)>=0));
  const remainder=net+energy('DORMITORY',dorms);
  return this.cached('s'+cc+':'+remainder,()=>{const types=['WORKSHOP','MEETING','HIRE','TRAINING'],gates=[1,2,3,4],out=[];function add(i,values){if(i===4){const [w,m,h,t]=values;if((m||h)&&!w||t&&!h)return;let load=0;for(let k=0;k<4;k++)if(values[k])load-=this.catalog.buildingRules.rooms[types[k]].phases[values[k]-1].electricity;if(load<=remainder)out.push([...values]);return;}const opts=cc<gates[i]?[0]:c.allSupportBuilt?levels:[0,...levels];for(const n of opts)add.call(this,i+1,[...values,n]);}add.call(this,0,[]);return out;});
 }
 input(){const [cc,power,trades,,factories,dorms,support]=this.selected,rooms={control:{type:'CONTROL',level:cc}},products={};for(const [type,seq]of [['POWER',power],['TRADING',trades],['DORMITORY',dorms]])seq.forEach((level,i)=>{rooms[type.toLowerCase()+'_'+i]={type,level,...(type==='DORMITORY'?{ambience:this.config.ambience==='max'?level*1000:Math.min(level*1000,this.config.ambience)}:{})};});factories.forEach((f,i)=>{const id='manufacture_'+i;rooms[id]={type:'MANUFACTURE',level:f.level};products[id]=f.recipe;});['WORKSHOP','MEETING','HIRE','TRAINING'].forEach((type,i)=>{if(support[i])rooms[type.toLowerCase()]={type,level:support[i]};});return {base:{rooms},products};}
 advance(budget=2000){if(this.done)return {done:true};let n=0;const back=()=>{this.depth--;if(this.depth<0)this.done=true;};while(n++<budget){if(this.depth===7){const value=this.input();this.generated++;back();return {value};}const d=this.depth;if(!this.lists[d])this.lists[d]=this.choices(d);if(this.cursor[d]>=this.lists[d].length){this.cursor[d]=0;this.lists[d]=null;back();if(this.done)return {done:true};continue;}this.selected[d]=this.lists[d][this.cursor[d]++];this.nodes++;this.depth++;if(this.depth<7){this.cursor[this.depth]=0;this.lists[this.depth]=null;}}return {yield:true};}
}
