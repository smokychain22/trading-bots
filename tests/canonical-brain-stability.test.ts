import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { auditCanonicalBrainStability } from '../src/research/canonical-brain-stability.js';
import { buildT0ReplayBundle } from '../src/theta/t0-replay-bundle.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import type { CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import { parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';

const at = '2026-09-14T15:00:00.000Z';
const contract = normalizeOptionContract({ source:'ALPACA',underlying:'AAPL',optionSymbol:'AAPL261016P00190000',
  occSymbol:'AAPL261016P00190000',optionType:'PUT',strike:190,expiration:'2026-10-16',asOfDate:'2026-09-14',
  multiplier:100,underlyingBid:199.9,underlyingAsk:200.1,underlyingLast:200,underlyingTimestamp:at,
  bid:2,ask:2.1,bidSize:20,askSize:20,quoteTimestamp:at,volume:250,volumeSource:'ALPACA',
  openInterest:1200,openInterestSource:'ALPACA',delta:-0.22,greeksTimestamp:at,greeksSource:'ALPACA',
  lastTradePrice:null,lastTradeSize:null,tradeTimestamp:null,iv:null,gamma:null,theta:null,vega:null,rho:null,
  feed:'OPRA',dataQuality:'GOOD',maxQuoteAgeSecondsForExecutable:30,maxSpreadPctForExecutable:0.2 },at);
const input: CanonicalStrategyFrontierInput = {
  snapshotId:'fixture',timestamp:at,strategyVersion:'test-v1',contracts:[contract],
  routing:parseStrategyRoutingResponse({contractVersion:'theta-strategy-router-runtime-v1',snapshotId:'fixture',timestamp:at,
    policyVersion:'router-v1',results:['THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D'].map(strategyFamily=>({
      strategyFamily,eligible:strategyFamily==='THETA_Q',eligibilityState:strategyFamily==='THETA_Q'?'ELIGIBLE_CHALLENGER':'INELIGIBLE_STATE',
      reasons:[],policyVersion:'router-v1'}))}),
  stock:null,assignmentCapacityQty:2,buyingPower:100_000,brokerAllowedQty:2,aegisNewRiskState:'ALLOW_FULL',eventState:'CLEAR',
  sizingPolicy:{riskBudgetQtyCap:2,collateralQtyCap:2,concentrationQtyCap:2,assignmentCapacityQtyCap:2,tailRiskQtyCap:2,
    correlationQtyCap:2,liquidityQtyCap:2,reducedStateMultiplier:0.5},
  unmanagedBrokerPositionCount:0,unevaluatedUnderlyingCount:0,optionomicsContext:{state:'UNKNOWN'},
  thetaQCandidateEvaluationByOptionSymbol:{AAPL261016P00190000:{state:'EVALUATED_FEASIBLE',reasonCode:null}},
  thetaQDecision:{snapshotId:'fixture',timestamp:at,underlying:'AAPL',winningAction:'OPEN_FULL',
    selectedCandidateId:'AAPL261016P00190000',quantity:1},
};

test('stability audit executes canonical replay and irrelevant-context attacks without changing Q or inflating N', () => {
  const bundle = buildT0ReplayBundle(input);
  const before = JSON.stringify(bundle);
  const result = auditCanonicalBrainStability([bundle,bundle]);
  assert.equal(result.state,'PASS');
  assert.equal(result.observations[0]?.decision.action,'OPEN_CSP');
  assert.equal(result.observations[0]?.probes.length,5);
  assert.equal(result.distinctSnapshotCount,1);
  assert.equal(result.empiricalIndependentN,null);
  assert.equal(result.brokerAuthority,false);
  assert.equal(JSON.stringify(bundle),before);
  assert.equal(result.contentHash,auditCanonicalBrainStability([bundle,bundle]).contentHash);
});

test('a genuine capacity boundary is recorded as a changed-input transition without inventing hysteresis', () => {
  const before = buildT0ReplayBundle(input);
  const after = buildT0ReplayBundle({...input,buyingPower:0});
  const result = auditCanonicalBrainStability([before,after]);
  assert.equal(result.state,'PASS');
  assert.equal(result.transitions[0]?.actionChanged,true);
  assert.equal(result.transitions[0]?.sameInput,false);
  assert.equal(result.transitions[0]?.classification,'CHANGED_EVIDENCE_OR_POLICY_REQUIRES_ATTRIBUTION');
  assert.equal(result.observations[1]?.decision.quantity,0);
});

test('stability rejects missing samples and tampered historical proof rather than reblessing a hash', () => {
  assert.throws(()=>auditCanonicalBrainStability([]),/BOUNDED_SAMPLE/);
  const bundle=buildT0ReplayBundle(input);
  assert.throws(()=>auditCanonicalBrainStability([{...bundle,expectedFrontierContentHash:'0'.repeat(64)}]),/HASH_MISMATCH/);
});

test('tiny research perturbations and duplicate research concepts never oscillate the canonical action', () => {
  const bundles = [0, Number.EPSILON, -Number.EPSILON, 1e12, -1e12].map(value => buildT0ReplayBundle({
    ...input, optionomicsContext: { flow: value, gex: value, ivPercentile: value,
      duplicateResearchConcept: { flow: value, gex: value, ivPercentile: value } },
  }));
  const result = auditCanonicalBrainStability(bundles);
  assert.equal(result.state, 'PASS');
  assert.ok(result.observations.every(row => row.decision.action === 'OPEN_CSP'));
  assert.ok(result.transitions.every(row => !row.actionChanged && !row.strategyChanged && !row.quantityChanged));
});

test('temporal stability requires chronological PIT samples', () => {
  const bundle = buildT0ReplayBundle(input);
  const earlier = '2026-09-14T14:59:59.000Z';
  const earlierBundle = buildT0ReplayBundle({ ...input, timestamp: earlier, contracts: [],
    routing: { ...input.routing, timestamp: earlier }, thetaQDecision: undefined });
  assert.throws(() => auditCanonicalBrainStability([bundle, earlierBundle]), /CHRONOLOGY_INVALID/);
});

test('stability CLI consumes a persisted T0 without provider or broker requests', () => {
  const directory=mkdtempSync(join(tmpdir(),'theta-stability-'));
  try {
    const path=join(directory,'bundle.json');
    writeFileSync(path,JSON.stringify(buildT0ReplayBundle(input)));
    const child=spawnSync(process.execPath,['--import','tsx','tools/theta-brain-stability.ts',path],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
    const result=JSON.parse(child.stdout);
    assert.equal(result.currentWorkerProven,false);
    assert.equal(result.receipt.providerRequests,0);
    assert.equal(result.receipt.brokerMutations,0);
    assert.equal(result.receipt.state,'PASS');
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
