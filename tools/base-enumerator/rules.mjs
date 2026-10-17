// Deliberately explicit: a recognized description is not proof of correct gameplay.
// Unknown effects exclude that operator from that working facility, with a visible reason.
const num=(d,re,n=0)=>Number(d.match(re)?.[1]??n);
export function rule(b){
 const h=b.id.split('[')[0],d=b.description,s={...b,kind:'unsupported',prod:b.base??0,cap:0,drain:0};
 const simple=()=>({...s,kind:'simple',cap:num(d,/창고 용량 상한\s*([+-][\d.]+)/),drain:num(d,/시간당 컨디션 소모\s*([+-][\d.]+)/)});
 if(b.room==='MANUFACTURE'){
  if(['manu_prod_spd','manu_prod_spd&limit','manu_prod_limit&cost','manu_formula_cost','manu_formula_limit','manu_prod_spd&limit&cost','manu_formula_spd','manu_formula_spd&limit&cost','manu_formula_spd&cost'].includes(h))return simple();
  if(h==='manu_prod_spd&power')return {...s,kind:'automation',amount:num(d,/생산력\s*\+([\d.]+)%/)/100};
  if(h==='manu_prod_spd_variable')return {...s,kind:'vermeil'};
  if(h==='manu_prod_spd_variable3')return {...s,kind:'bubble'};
  if(h==='manu_prod_spd_addition')return {...s,kind:'ramp',initial:b.base,step:num(d,/시간당\s*\+([\d.]+)%/)/100,max:num(d,/최대\s*\+([\d.]+)%/)/100};
  if(h==='manu_prod_spd&trade')return {...s,kind:'trades',amount:num(d,/생산력\s*\+([\d.]+)%/)/100};
  if(h==='manu_formula_spd&dorm&lv')return {...s,kind:'dormLevels',amount:.01};
  if(h==='manu_prod_spd_train&lv')return {...s,kind:'training'};
  if(h==='manu_cost')return {...s,kind:'factoryDrain',amount:.1};
  // Waai Fu and morale-drop semantics remain excluded until independently verified.
 }
 if(b.room==='HIRE'){
  if(['hire_spd','hire_spd_cost','hire_spd_cost&char'].includes(h)&&!d.includes('만약'))return simple();
  if(h==='hire_spd_dorm&lv')return {...simple(),kind:'hireDorm',amount:b.id.endsWith('[010]')?.02:.01};
  if(h==='hire_spd_tag')return {...simple(),kind:'hireElite'};
  if(['hire_spd&clue','hire_spd_cost&clue'].includes(h)&&!d.includes('모집 인원'))return simple();
 }
 if(b.room==='MEETING'){
  if(['meet_spd','meet_spd&cost'].includes(h))return simple();
  if(h==='meet_spd_notOwned')return {...simple(),kind:'missing'};
  if(h==='meet_spd_notOwned&exchange')return {...simple(),kind:'missing',requiresExchange:true};
  if(h==='meet_spd&exchange')return {...simple(),kind:'exchangeSpeed'};
  if(['meet_flag','meet_team&char'].includes(h))return {...simple(),kind:'ignoredClue'};
  if(h==='meet_spd_Owned')return {...simple(),kind:'owned'};
  if(h==='meet_team'||h==='meet_spd&team'){
   const clue=[['라인 랩',1],['펭귄 로지스틱스',2],['블랙스틸',3],['우르수스',4],['글래스고',5],['카란',6],['로도스',7]].find(([n])=>d.includes(n))?.[1];
   return clue?{...simple(),kind:'clue',clue}:d.includes('더 쉽게')?s:simple();
  }
  if(h==='meet_spd_condChar'||h==='meet_spd&cost_condChar')return {...simple(),kind:'solo',amount:num(d,/속도\s*\+?([\d.]+)%/)/100};
  if(h==='meet_spd_hast')return {...s,kind:'ramp',initial:.2,step:.02,max:.3};
 }
 if(b.room==='CONTROL'){
  if(h==='control_clue_cost&faction'&&d.includes('미보유'))return {...simple(),kind:'globalMissing',drain:0,otherDrain:num(d,/시간당 컨디션 소모\s*\+([\d.]+)/)};
  if(['control_clue_cost','control_clue_faction'].includes(h))return {...simple(),kind:'ignoredClue',drain:0,roomDrain:num(d,/모든 오퍼레이터의 시간당 컨디션 소모\s*\+([\d.]+)/)};
  if(h==='control_mp_cost')return {...s,kind:'ccRecovery',amount:.05};
  if(h==='control_prod_spd')return {...s,kind:'ccProd',amount:.02};
  if(h==='control_hire_spd')return {...s,kind:'hireThreshold'};
  if(h==='control_upMeetingSpeed')return {...s,kind:'meetingBonus',amount:num(d,/속도\s*\+([\d.]+)%/)/100};
  if(h==='control_mp_lonely')return {...s,kind:'mlynar'};
  if(h==='control_mp_cost&faction'){
   const group=[['레인보우 팀','rainbow'],['얼터네이트','alter'],['용문근위국','lgd'],['우르수스 학생자치단','student'],['쉐라그','karlan']].find(([n])=>d.includes(n))?.[1];
   if(group)return {...s,kind:'ccFaction',group,amount:.05};
  }
  if(h==='control_dorm_rec')return {...s,kind:'globalDorm',amount:.05};
  if(h==='control_tra_spd')return {...s,kind:'outsideObjective'};
  if(h==='control_tra&prod')return s; // unknown IDs must not be inferred by their spelling
 }
 if(b.room==='POWER'&&h.startsWith('power_rec_')){
  if(/마다|함께|배치되어|작업 플랫폼|동시/.test(d))return s;
  return {...simple(),kind:'droneOnly'};
 }
 if(b.room==='TRADING'){
  if(['trade_ord_spd','trade_ord_spd&limit','trade_ord_limit&cost','trade_ord_spd&cost'].includes(h))return {...simple(),tradeLimit:num(d,/오더 (?:수 )?상한\s*([+-][\d.]+)/)};
  if(h==='trade_ord_wt&cost')return {...simple(),kind:'quality',quality:d.includes('소폭')?'alpha':'beta'};
  if(h==='trade_ord_vodfox')return {...simple(),kind:'tradeOverride',drain:0,amount:.45,roomDrain:num(d,/모든 인원의 시간당 컨디션 소모\s*\+([\d.]+)/)};
  if(h==='trade_ord_long')return {...simple(),kind:'tradePayout',bonus:num(d,/용문폐 수익\s*\+([\d.]+)/)};
 }
 if(b.room==='DORMITORY'){
  const a=num(d,/회복(?: 속도)?\s*\+([\d.]+)/);
  if(h==='dorm_rec_oneself')return {...s,kind:'selfRest',amount:a};
  if(h==='dorm_rec_all')return {...s,kind:'allRest',amount:a};
  if(h==='dorm_rec_single')return {...s,kind:'singleRest',amount:a};
  if(h==='dorm_rec_single&oneself')return {...s,kind:'selfSingleRest',self:num(d,/자신의 시간당 컨디션 회복\s*\+([\d.]+)/),amount:a};
  if(h==='dorm_rec_all&oneself')return {...s,kind:'selfAllRest',self:num(d,/자신의 시간당 컨디션 회복\s*\+([\d.]+)/),amount:num(d,/(?:모든 오퍼레이터의 시간당 컨디션 회복|모든 오퍼레이터의 시간당 회복)\s*\+([\d.]+)/),excludesSelf:d.includes('자신을 제외한')};
  if(h==='dorm_recExcludeOther')return {...s,kind:'fixedRest',amount:2};
  if(h==='dorm_exchangeAp')return {...s,kind:'exchange'};
 }
 return s;
}
export function unlock(def,state,buffs){return def.chains.flatMap(c=>{const row=c.filter(r=>state.elite>r.elite||state.elite===r.elite&&state.level>=r.level).at(-1);return row&&buffs[row.id]?[buffs[row.id]]:[];});}
export const group=(o,g)=>g==='alter'?o.alter:o.groups?.includes(g);
