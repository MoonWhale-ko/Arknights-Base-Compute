import test from 'node:test';import assert from 'node:assert/strict';
import {expectedTerraOrder} from './terra-orders.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('Proviso pays for extra gold without extending the original order duration',()=>{
 const s=[{kind:'payout_v',description:'순금 납품 수가 추가로 +2'}],r=expectedTerraOrder(3,s);near(r.gold,4.5);near(r.lmd,2250);near(r.seconds,.3*8640+.5*12600+.2*16560);
 const low=expectedTerraOrder(2,s);near(low.gold,4.4);near(low.lmd,2200);
});
test('Tequila only increases ordinary four-gold orders, not Proviso violation orders',()=>{
 const r=expectedTerraOrder(3,[{kind:'payout_v',description:'추가로 +2'},{kind:'payout',description:'용문폐 수익 +500'}]);near(r.lmd,2350);near(r.gold,4.5);
});
test('quality changes gold, reward and time together; baseline preserves payout skills',()=>{
 const s=[{kind:'quality',description:'확률이 상승'},{kind:'payout',description:'용문폐 수익 +500'}],r=expectedTerraOrder(3,s),b=expectedTerraOrder(3,s,{baseline:true});
 assert.deepEqual(r.probabilities,[.05,.10,.85]);near(r.lmd,.05*1000+.1*1500+.85*2500);near(b.lmd,1550);assert.equal(r.warmupHours,5);
});
test('unobserved quality cases explicitly identify fallback',()=>{const r=expectedTerraOrder(2,[{kind:'quality',description:'소폭'}]);assert.equal(r.approximation,'unobserved-quality-distribution');assert.deepEqual(r.probabilities,[.6,.4,0]);});
