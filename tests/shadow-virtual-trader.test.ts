import assert from 'node:assert/strict';
import test from 'node:test';
import { applyShadowCspOpening, classifyConservativeShadowFill, selectShadowOpeningCandidate,
  type ShadowOpeningCandidate } from '../src/research/shadow-virtual-trader.js';

const candidate=(overrides:Partial<ShadowOpeningCandidate>={}):ShadowOpeningCandidate=>({
  candidateId:'candidate-a',decisionId:'decision-a',fusionSnapshotId:'snapshot-a',optionContractId:'contract-a',
  contractSymbol:'AAPL261016P00200000',underlying:'AAPL',optionType:'PUT',strike:200,expiration:'2026-10-16',multiplier:100,
  rank:1,quantity:1,ownershipScore:0.8,bid:2.4,ask:2.5,bidSize:10,askSize:10,quoteTimestamp:'2026-09-14T14:30:00Z',
  quoteQuality:'GOOD',decisionTime:'2026-09-14T14:30:01Z',strategyVersion:'s1',riskVersion:'r1',featureVersion:'f1',
  costModelVersion:'c1',executionModelVersion:'e1',...overrides,
});

test('shadow selection is deterministic, research-only, and never authorizes execution',()=>{
  const selected=selectShadowOpeningCandidate([candidate({candidateId:'b',contractSymbol:'B',ownershipScore:0.5}),candidate()]);
  assert.equal(selected.candidate?.candidateId,'candidate-a');
  assert.equal(selected.empiricalEvReady,false);
  assert.equal(selected.executionAuthorized,false);
  assert.ok(selected.reasonCodes.includes('EMPIRICAL_EV_UNKNOWN'));
});

test('shadow selection rejects calls, zero quantity, invalid BBO, and stale quotes',()=>{
  const selected=selectShadowOpeningCandidate([
    candidate({optionType:'CALL'}),candidate({quantity:0}),candidate({bid:3,ask:2}),candidate({quoteQuality:'STALE'}),
  ]);
  assert.equal(selected.candidate,null);
  assert.deepEqual(selected.reasonCodes,['SHADOW_WAIT_NO_STRUCTURALLY_FEASIBLE_CANDIDATE']);
});

test('a simple touch never becomes a shadow fill because queue priority is unknown',()=>{
  assert.deepEqual(classifyConservativeShadowFill({side:'SELL',requestedQuantity:2,limit:2.5,bid:2.5,ask:2.6,bidSize:20,askSize:10,finalObservation:false}),{
    state:'UNKNOWN_EXECUTABILITY',filledQuantity:null,remainingQuantity:2,fillPrice:null,reasonCode:'LIMIT_TOUCHED_QUEUE_UNKNOWN',
  });
});

test('later price-through plus displayed size supports full and partial shadow fills at the limit',()=>{
  const full=classifyConservativeShadowFill({side:'SELL',requestedQuantity:2,limit:2.5,bid:2.51,ask:2.6,bidSize:2,askSize:10,finalObservation:false});
  assert.deepEqual(full,{state:'FILLED_SHADOW',filledQuantity:2,remainingQuantity:0,fillPrice:2.5,reasonCode:'LATER_PRICE_THROUGH_WITH_DISPLAYED_SIZE'});
  const partial=classifyConservativeShadowFill({side:'SELL',requestedQuantity:3,limit:2.5,bid:2.51,ask:2.6,bidSize:1,askSize:10,finalObservation:false});
  assert.deepEqual(partial,{state:'PARTIAL_SHADOW',filledQuantity:1,remainingQuantity:2,fillPrice:2.5,reasonCode:'LATER_PRICE_THROUGH_PARTIAL_DISPLAYED_SIZE'});
});

test('missing size remains unknown and final no-cross expires unfilled',()=>{
  assert.equal(classifyConservativeShadowFill({side:'SELL',requestedQuantity:1,limit:2.5,bid:2.51,ask:2.6,bidSize:null,askSize:10,finalObservation:false}).state,'UNKNOWN_EXECUTABILITY');
  assert.equal(classifyConservativeShadowFill({side:'SELL',requestedQuantity:1,limit:2.5,bid:2.4,ask:2.5,bidSize:10,askSize:10,finalObservation:true}).state,'EXPIRED_UNFILLED');
});

test('CSP accounting respects multiplier, collateral, spread mark, and known costs',()=>{
  const next=applyShadowCspOpening({prior:{cash:100_000,equity:100_000,reservedCollateral:0,buyingPower:100_000,
    realizedPnl:0,unrealizedPnl:0,openOptionContracts:0},quantity:2,strike:200,multiplier:100,fillPrice:2.5,markAsk:2.6,modeledCost:3.4});
  assert.equal(next.cash,100_496.6);
  assert.equal(next.reservedCollateral,40_000);
  assert.equal(next.buyingPower,60_000);
  assert.ok(Math.abs(next.equity-99_976.6)<1e-9);
  assert.equal(next.realizedPnl,-3.4);
  assert.ok(Math.abs(next.unrealizedPnl+20)<1e-9);
});

test('CSP accounting refuses collateral beyond virtual buying power and unknown costs',()=>{
  const base={cash:10_000,equity:10_000,reservedCollateral:0,buyingPower:10_000,realizedPnl:0,unrealizedPnl:0,openOptionContracts:0};
  assert.throws(()=>applyShadowCspOpening({prior:base,quantity:1,strike:200,multiplier:100,fillPrice:2,markAsk:2.1,modeledCost:1}),/COLLATERAL/);
  assert.throws(()=>applyShadowCspOpening({prior:{...base,buyingPower:30_000},quantity:1,strike:200,multiplier:100,fillPrice:2,markAsk:2.1,modeledCost:Number.NaN}),/COST_MODEL/);
});
