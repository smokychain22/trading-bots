import assert from 'node:assert/strict';
import test from 'node:test';
import { decideAdaptiveLimit, type AdaptiveLimitPolicy } from '../src/execution/adaptive-limit-policy.js';
import { executionOptionQuoteContractVersion, type ExecutionOptionQuote } from '../src/execution/execution-option-quote.js';

const q: ExecutionOptionQuote = { contractVersion: executionOptionQuoteContractVersion, contractId:'c',providerContractId:'p',
  bid:1,ask:1.2,bidSize:10,askSize:30,providerTimestamp:null,receivedAtUtc:'2026-09-14T14:00:00Z',
  receivedAtMonotonic:1,sequence:null,provider:'TEST',sourceSemantics:'TRUSTED_TWO_SIDED_ORDER_PRICING',
  connectionState:'CONNECTED',subscriptionState:'ACTIVE',provenance:{} };
const policy:AdaptiveLimitPolicy={waitIntervalMs:5000,maxAttempts:3,concessionFractions:[0,0.5,1],tickSize:0.01};

test('seller starts at ask and concedes toward bid without breaching its floor',()=>{
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:q,attempt:0,previousLimit:null,economicBoundary:1.05,economicsRemainPositive:true,policy}).limitPrice,1.2);
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:q,attempt:1,previousLimit:1.2,economicBoundary:1.05,economicsRemainPositive:true,policy}).limitPrice,1.1);
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:q,attempt:2,previousLimit:1.1,economicBoundary:1.05,economicsRemainPositive:true,policy}).limitPrice,1.05);
});

test('buy-to-close uses reverse semantics and respects maximum debit',()=>{
  const result=decideAdaptiveLimit({side:'BUY',quote:q,attempt:1,previousLimit:1,economicBoundary:1.12,economicsRemainPositive:true,policy});
  assert.equal(result.action,'REPLACE'); assert.equal(result.limitPrice,1.1);
});

test('microprice is optional and no policy chases after economics disappear or attempts end',()=>{
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:q,attempt:0,previousLimit:null,economicBoundary:1,economicsRemainPositive:true,policy}).microprice,1.05);
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:{...q,bidSize:null},attempt:0,previousLimit:null,economicBoundary:1,economicsRemainPositive:true,policy}).microprice,null);
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:q,attempt:1,previousLimit:1.2,economicBoundary:1,economicsRemainPositive:false,policy}).reason,'ECONOMICS_DISAPPEARED');
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:q,attempt:3,previousLimit:1.1,economicBoundary:1,economicsRemainPositive:true,policy}).reason,'MAX_ATTEMPTS_REACHED');
});

test('an economic boundary outside the market cancels rather than posting an indefinite chase',()=>{
  assert.equal(decideAdaptiveLimit({side:'SELL',quote:q,attempt:0,previousLimit:null,economicBoundary:1.21,economicsRemainPositive:true,policy}).reason,'ECONOMIC_BOUNDARY_UNREACHABLE');
  assert.equal(decideAdaptiveLimit({side:'BUY',quote:q,attempt:0,previousLimit:null,economicBoundary:.99,economicsRemainPositive:true,policy}).reason,'ECONOMIC_BOUNDARY_UNREACHABLE');
});

test('regression: a sub-tick SELL quote cannot be rounded up above the ask - it cancels instead of producing an out-of-BBO limit',()=>{
  const sub={...q,bid:0.5025,ask:0.5075};
  for(const attempt of [0,1,2]){
    const result=decideAdaptiveLimit({side:'SELL',quote:sub,attempt,previousLimit:null,economicBoundary:0.5025,economicsRemainPositive:true,policy});
    assert.equal(result.action,'CANCEL'); assert.equal(result.limitPrice,null); assert.equal(result.reason,'ECONOMIC_BOUNDARY_UNREACHABLE');
  }
  const locked=decideAdaptiveLimit({side:'SELL',quote:{...q,bid:10.005,ask:10.005},attempt:0,previousLimit:null,economicBoundary:10.005,economicsRemainPositive:true,policy});
  assert.equal(locked.action,'CANCEL');
});

// P2-11: every policy-decidable quote yields a typed PLACE / REPLACE / CANCEL, never an exception, and every placed limit is
// inside the quoted BBO and on the right side of the economic boundary.
test('P2-11 boundary matrix: typed result, limit inside BBO, boundary respected, for both sides and every attempt',()=>{
  const quotes:readonly [string,number,number][]=[['bid == ask',10,10],['sub-tick bid/ask',0.5025,0.5075],['one-tick spread',10,10.01],
    ['zero bid',0,0.02],['very small price',0.0101,0.0103],['normal price',189.97,190.03],['wide spread',1,1.5],['locked sub-tick',10.005,10.005],
    ['tick-aligned penny',1.23,1.24]];
  for(const [label,bid,ask] of quotes){
    for(const side of ['BUY','SELL'] as const){
      for(const attempt of [0,1,2]){
        for(const boundary of [bid,(bid+ask)/2,ask,ask+1,Math.max(0.0001,bid-1)]){
          const result=decideAdaptiveLimit({side,quote:{...q,bid,ask},attempt,previousLimit:null,economicBoundary:boundary,economicsRemainPositive:true,policy});
          assert.ok(['PLACE','REPLACE','CANCEL'].includes(result.action),`${label} ${side} ${attempt} ${boundary}`);
          if(result.action==='CANCEL'){assert.equal(result.limitPrice,null);continue;}
          const limit=result.limitPrice as number;
          assert.ok(limit>0,`${label}: positive limit`);
          assert.ok(limit>=bid-1e-9&&limit<=ask+1e-9,`${label} ${side}: ${limit} inside [${bid},${ask}]`);
          if(side==='SELL')assert.ok(limit>=boundary-1e-9,`${label} SELL ${limit} >= floor ${boundary}`);
          else assert.ok(limit<=boundary+1e-9,`${label} BUY ${limit} <= ceiling ${boundary}`);
        }
      }
    }
  }
});

test('P2-11 named cases: bid==ask places at the locked price; floor == ask places at ask; ask below floor cancels; rounded BUY below bid cancels',()=>{
  const place=(side:'BUY'|'SELL',bid:number,ask:number,boundary:number,attempt=0)=>decideAdaptiveLimit({side,quote:{...q,bid,ask},attempt,previousLimit:null,economicBoundary:boundary,economicsRemainPositive:true,policy});
  assert.equal(place('SELL',10,10,10).limitPrice,10);
  assert.equal(place('BUY',10,10,10).limitPrice,10);
  assert.equal(place('SELL',189.97,190.03,190.03).limitPrice,190.03,'floor == ask');
  assert.equal(place('SELL',189.97,190.03,190.04).reason,'ECONOMIC_BOUNDARY_UNREACHABLE','ask below the floor');
  assert.equal(place('SELL',189.97,190.03,189.5).limitPrice,190.03,'floor between: starts at the favourable ask');
  assert.equal(place('SELL',189.97,190.03,190,2).limitPrice,190,'final concession stops at the floor, not the bid');
  assert.equal(place('BUY',0,0.02,0.02).limitPrice,0.01,'zero bid buy-to-close uses one tick');
  assert.equal(place('SELL',0,0.02,0.01).action,'CANCEL','a SELL never prices against a zero bid');
  const subTickBuy=place('BUY',0.5025,0.5075,0.51);
  assert.equal(subTickBuy.action,'CANCEL'); assert.equal(subTickBuy.reason,'LIMIT_OUTSIDE_QUOTED_BBO');
  assert.equal(place('BUY',10,10.01,10.01,2).limitPrice,10.01);
});
