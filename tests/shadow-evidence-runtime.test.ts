import assert from 'node:assert/strict';
import test from 'node:test';
import { asReadOnlyPaperBroker, assertShadowBrokerHasNoMutationSurface } from '../src/execution/read-only-paper-broker.js';
import type { PaperBrokerAdapter } from '../src/execution/broker.js';
import {
  buildObservationSchedule, classifyObservedLimitTouch, runCrossSymbolShadowScan, shadowSessionDecision,
  shadowRuntimeMode, type ShadowScanBoundary,
} from '../src/research/shadow-evidence-runtime.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';
import type { UnderlyingCandidateInput } from '../src/theta/universe-policy.js';

const underlying = (symbol: string): UnderlyingCandidateInput => ({ symbol, tradable:true, optionEnabled:true,
  assetDataValid:true, avgDollarVolume:1_000_000_000, currentPrice:100, hasUsableOptionChain:true,
  accountCollateralFeasible:true, ownershipAcceptable:true, unsupportedCorporateActionPending:false, eventNear:false });
const cycle = (symbol:string,candidates=1,complete=true):ThetaShadowCycleResult => ({ runId:`run-${symbol}`,
  startedAt:'2026-09-14T14:30:00Z',finishedAt:'2026-09-14T14:30:01Z',universeFunnel:{} as never,
  selectedUnderlying:symbol,underlyingRanking:[],optionChainComplete:complete,optionContractsComplete:complete,
  snapshotContentHash:null,fusionSnapshot:null,snapshotValidForNewRisk:null,provenance:'HYBRID',provenanceDetail:[],blockers:[],
  orchestration:{receipt:{} as never,ownership:null,regime:null,routing:null,thetaQ:{candidates:Array.from({length:candidates},(_,index)=>({candidateId:`${symbol}-${index}`}))} as never,
    candidateEconomics:null,aegis:null,paretoSurvivorIds:null,opportunityBook:null,shadowOpportunities:[]} });
const boundary = (items:readonly UnderlyingCandidateInput[],maxUnderlyings=10):ShadowScanBoundary => ({
  universeVersion:'u1',latticeVersion:'l1',strategyVersion:'s1',eligibleUnderlyings:items,maxUnderlyings,
  branches:['THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_RECOVERY','THETA_CC','THETA_DEFINED_RISK'],
});

test('cross-symbol scan evaluates every bounded eligible symbol in deterministic order',async()=>{
  const seen:string[]=[];
  const result=await runCrossSymbolShadowScan(boundary([underlying('MSFT'),underlying('AAPL')]),async(item)=>{
    seen.push(item.symbol); return cycle(item.symbol);
  },()=> '2026-09-14T14:30:00Z');
  assert.deepEqual(seen,['AAPL','MSFT']);
  assert.equal(result.completeness,'COMPLETE');
  assert.equal(result.symbolsCompleted,2);
  assert.equal(result.candidateCount,2);
  assert.equal(result.mode,shadowRuntimeMode);
});

test('bounded scan never claims completeness when the eligible universe exceeds its versioned bound',async()=>{
  const result=await runCrossSymbolShadowScan(boundary([underlying('A'),underlying('B')],1),async(item)=>cycle(item),()=> '2026-09-14T14:30:00Z');
  assert.equal(result.completeness,'PROVIDER_LIMITED');
  assert.deepEqual(result.missingScope,['UNDERLYING_BOUND_REACHED']);
});

test('a fully evaluated zero-candidate universe is complete evidence',async()=>{
  const result=await runCrossSymbolShadowScan(boundary([underlying('AAPL'),underlying('MSFT')]),
    async(item)=>cycle(item.symbol,0,true),()=> '2026-09-14T14:30:00Z');
  assert.equal(result.completeness,'COMPLETE');
  assert.equal(result.symbolsAttempted,2);
  assert.equal(result.symbolsCompleted,2);
  assert.equal(result.candidateCount,0);
  assert.deepEqual(result.missingScope,[]);
});

test('partial contract pagination and interrupted symbols remain explicit',async()=>{
  const partial=await runCrossSymbolShadowScan(boundary([underlying('A')]),async()=>cycle('A',1,false),()=> '2026-09-14T14:30:00Z');
  assert.equal(partial.completeness,'PARTIAL');
  const interrupted=await runCrossSymbolShadowScan(boundary([underlying('A'),underlying('B')]),async(item)=>{
    if(item.symbol==='B') throw new Error('PROVIDER_RATE_LIMITED');
    return cycle(item.symbol);
  },()=> '2026-09-14T14:30:00Z');
  assert.equal(interrupted.completeness,'INTERRUPTED');
  assert.equal(interrupted.results[1]?.errorCode,'PROVIDER_RATE_LIMITED');
});

test('shadow-only broker object has no submit, replace, cancel, exercise, or DNE function',()=>{
  const mutable={environment:'PAPER',accountKind:'MASTER_API_KEY',getAccount:async()=>({}),getPositions:async()=>[],
    getOrders:async()=>[],getOrderByClientOrderId:async()=>null,getOrder:async()=>null,getActivities:async()=>[],
    getClock:async()=>({timestamp:null,isOpen:null,nextOpen:null,nextClose:null}),getCalendar:async()=>[],
    submitOrder:async()=>{throw new Error('should never run');},replaceOrder:async()=>{throw new Error('should never run');},
    cancelOrder:async()=>{throw new Error('should never run');}} as unknown as PaperBrokerAdapter;
  const readOnly=asReadOnlyPaperBroker(mutable);
  assert.doesNotThrow(()=>assertShadowBrokerHasNoMutationSurface(readOnly));
  const runtime=readOnly as unknown as Record<string,unknown>;
  assert.equal(runtime.submitOrder,undefined);
  assert.equal(runtime.replaceOrder,undefined);
  assert.equal(runtime.cancelOrder,undefined);
});

test('observation horizons are deterministic and never imply a fill',()=>{
  const first=buildObservationSchedule({candidateId:'11111111-1111-4111-8111-111111111111',contractSymbol:'SPY261009P00500000',
    decisionTime:'2026-09-14T14:30:00Z',marketClose:'2026-09-14T20:00:00Z'});
  const second=buildObservationSchedule({candidateId:'11111111-1111-4111-8111-111111111111',contractSymbol:'SPY261009P00500000',
    decisionTime:'2026-09-14T14:30:00Z',marketClose:'2026-09-14T20:00:00Z'});
  assert.deepEqual(first,second);
  assert.deepEqual(first.map((item)=>item.horizonCode),['1M','5M','30M','EOD']);
  assert.equal(classifyObservedLimitTouch({side:'SELL',limit:2.5,bid:2.5,ask:2.6}),'LIMIT_TOUCHED');
  assert.equal(classifyObservedLimitTouch({side:'SELL',limit:null,bid:2.5,ask:2.6}),'BLOCKED_ON_DATA');
});

test('closed or unconfirmed sessions cannot create candidate evidence',()=>{
  assert.equal(shadowSessionDecision(false,true),'MARKET_CLOSED');
  assert.equal(shadowSessionDecision(true,false),'SESSION_UNCONFIRMED');
  assert.equal(shadowSessionDecision(null,true),'SESSION_UNCONFIRMED');
  assert.equal(shadowSessionDecision(true,true),'RUN');
});
