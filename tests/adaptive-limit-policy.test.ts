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
