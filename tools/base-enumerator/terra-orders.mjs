import {orderDistribution} from './trading.mjs';
// Published mature distributions; no invented interpolation during warm-up.
export function expectedTerraOrder(level,skills,{baseline=false}={}){
 const qualities=baseline?[]:skills.filter(s=>s.kind==='quality').map(s=>/소폭/.test(s.description)?'alpha':'beta');
 let probabilities,approximation=null;
 try{probabilities=orderDistribution(level,qualities);}catch{probabilities=orderDistribution(level);approximation='unobserved-quality-distribution';}
 const violation=Math.max(0,...skills.filter(s=>s.kind==='payout_v').map(s=>Number(s.description.match(/추가로\s*\+(\d+)/)?.[1]??0)));
 const bonus=Math.max(0,...skills.filter(s=>s.kind==='payout').map(s=>Number(s.description.match(/용문폐 수익\s*\+(\d+)/)?.[1]??0)));
 const sizes=[2,3,4],seconds=[8640,12600,16560];let gold=0,lmd=0,time=0;
 for(let i=0;i<3;i++){const p=probabilities[i],size=sizes[i],isViolation=violation>0&&size<4;gold+=p*(size+(isViolation?violation:0));lmd+=p*(500*(size+(isViolation?violation:0))+(size===4?bonus:0));time+=p*seconds[i];}
 return {probabilities,seconds:time,gold,lmd,approximation,distribution:baseline?'base':'mature',warmupHours:qualities.includes('beta')?5:qualities.length?3:0};
}
