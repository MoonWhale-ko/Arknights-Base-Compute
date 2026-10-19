const $=id=>document.getElementById(id),node=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
let worker=null,result=null,catalog=null;
const lock=running=>{for(const id of ['file','demo','input','seconds','starts','run'])$(id).disabled=running;$('stop').disabled=!running;$('save').disabled=running||!result;};
const message=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'error':'';};
const name=id=>catalog?.characters[id]?.name??id;
const format=n=>n==null?'—':Number(n).toLocaleString('ko-KR',{maximumFractionDigits:3});
function render(data){
 const wrap=$('result');wrap.replaceChildren();
 wrap.append(node('h2',data.best?'검증한 후보 중 최고 배치':'비교 가능한 배치를 찾지 못했습니다.'));
 wrap.append(node('p',`탐색 ${(data.elapsedMs/1000).toFixed(2)}초 · 시뮬레이션 ${data.stats.simulations}회 · 구성 근사 평가 ${data.stats.proxyEvaluations}회`));
 wrap.append(node('p',data.modelOptimalityProven?'작은 사례의 지원 모델 내 전체 검사를 완료했습니다.':'일부 후보를 비교한 추천입니다. 전체 최적해를 보장하지 않습니다.'));
 if(data.best){const table=node('table',''),head=node('tr','');for(const title of ['지표','24시간','첫 사이클'])head.append(node('th',title));table.append(head);
  const a=data.best.at24,b=data.best.cycle;
  for(const row of [['완료 시각(시간)',a?.hour,b?.hour],['순금(개)',a?.produced.F_GOLD,b?.produced.F_GOLD],['작전기록(경험치)',a?.produced.F_EXP,b?.produced.F_EXP],['오리지늄 조각(개)',a?.produced.F_DIAMOND,b?.produced.F_DIAMOND],['사무실(기본 속도 상당 시간)',a?.officeEquivalentHours,b?.officeEquivalentHours],['응접실(기본 속도 상당 시간)',a?.meetingEquivalentHours,b?.meetingEquivalentHours]]){const tr=node('tr','');tr.append(node('td',row[0]),node('td',format(row[1])),node('td',format(row[2])));table.append(tr);}wrap.append(table);
  for(const [room,ids] of Object.entries(data.best.plan.dormSupport??{}))wrap.append(node('p',`숙소 지원 / ${room}: ${ids.map(name).join(', ')||'비움'}`));
  for(const g of data.best.plan.groups)wrap.append(node('p',`${g.team+1}조 / ${g.room}: ${g.operators.map(name).join(', ')||'비움'}`));
 }
 const excluded=node('details','');excluded.append(node('summary',`미지원 스킬로 제외한 시설별 후보 ${data.excluded.length}건`));
 for(const item of data.excluded)excluded.append(node('p',`${item.name} / ${item.room}: ${item.skills.map(s=>s.name).join(', ')}`));wrap.append(excluded);
 for(const warning of data.warnings)wrap.append(node('p',warning));if(data.errors.length)wrap.append(node('pre',data.errors.join('\n')));
}
$('demo').onclick=async()=>{try{const response=await fetch('./examples/quality-trading.json');if(!response.ok)throw Error('예제 로딩 실패');$('input').value=JSON.stringify(await response.json(),null,2);}catch(e){message(e.message,true);}};
$('file').onchange=async e=>{try{$('input').value=JSON.stringify(JSON.parse(await e.target.files[0].text()),null,2);}catch(e){message(e.message,true);}};
$('run').onclick=async()=>{try{
 const input=JSON.parse($('input').value),seconds=Number($('seconds').value),starts=Number($('starts').value);
 if(!(seconds>=1&&seconds<=300&&Number.isInteger(starts)&&starts>=1&&starts<=16))throw Error('계산 시간이나 시작 배치 수가 허용 범위를 벗어났습니다.');
 worker?.terminate();result=null;$('result').replaceChildren();lock(true);message('조건과 스킬을 준비하고 있습니다.');
 if(!catalog){const response=await fetch('./data/catalog.json');if(!response.ok)throw Error('스킬 데이터 로딩 실패');catalog=await response.json();}
 worker=new Worker('./heuristic-worker.mjs',{type:'module'});
 worker.onmessage=({data})=>{if(data.type==='started')message(`보유 ${data.owned}명 · 미지원 시설별 후보 ${data.excluded}건 · 탐색 중`);
  if(data.type==='progress')message(`탐색 ${(data.progress.elapsedMs/1000).toFixed(1)}초 · 시뮬레이션 ${data.progress.simulations}회`);
  if(data.type==='result'){result=data.result;render(result);worker.terminate();lock(false);message('계산 완료 · 지원 범위와 제외 목록을 함께 확인하세요.');}
  if(data.type==='error'){worker.terminate();lock(false);message(data.message,true);}};
 worker.onerror=e=>{worker.terminate();lock(false);message(e.message,true);};
 worker.postMessage({input,options:{maxMilliseconds:seconds*1000,starts}});
 }catch(e){lock(false);message(e.message,true);}};
$('stop').onclick=()=>{worker?.terminate();lock(false);message('계산을 중단했습니다. 기존 데이터는 변경하지 않았습니다.');};
$('save').onclick=()=>{if(!result)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='current-roster-recommendation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
