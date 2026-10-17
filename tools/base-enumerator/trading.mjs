// Expected-work approximation, not a random-order or startup simulation.
// Distributions: https://prts.wiki/w/罗德岛基建/贸易站 (observations, 2026-10-16).
// Quality observations cover level 3 only, after 3h (alpha) / 5h (beta).
export const TRADE_MODEL='baseline-mature-scenarios-v2';
export function orderDistribution(level,qualities=[]){
 if(!qualities.length)return level===1?[1,0,0]:level===2?[.6,.4,0]:[.3,.5,.2];
 if(level!==3)throw Error('고품질 주문 분포는 3레벨 무역소에서만 지원합니다.');
 const a=qualities.filter(q=>q==='alpha').length,b=qualities.filter(q=>q==='beta').length;
 if(a+b!==qualities.length)throw Error('알 수 없는 주문 품질 효과');
 if(a===1&&b===0)return [.15,.30,.55];
 if(a===2&&b===0)return [.13,.22,.65];
 if(b===1&&a<=1)return [.05,.10,.85];
 throw Error('관측 자료가 없는 고품질 주문 중첩 조합입니다.');
}
export function expectedOrder(level,qualities=[],bonus=0){
 const probabilities=orderDistribution(level,qualities),sizes=[2,3,4],seconds=[8640,12600,16560];
 return {probabilities,seconds:probabilities.reduce((n,p,i)=>n+p*seconds[i],0),gold:probabilities.reduce((n,p,i)=>n+p*sizes[i],0),lmd:probabilities.reduce((n,p,i)=>n+p*(500*sizes[i]+(i===2?bonus:0)),0)};
}
