import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

const NOW = '2026-09-14T15:00:00.000Z';

function contract(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...overrides,
  }, NOW);
}

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: eligible.includes(strategyFamily) ? 'ROUTE_APPLICABLE' : 'ROUTE_NOT_APPLICABLE', polarity: 0, detail: 'test route' }],
      policyVersion: 'router-v1',
    })),
  });
}

const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1',
  stock: null, assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const,
  buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3,
    assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2, correlationQtyCap: 2,
    liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};

test('evaluates all five canonical branches exactly once and soft UNKNOWN evidence does not veto a valid CSP', () => {
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(['THETA_Q']) });
  assert.deepEqual(result.branches.map((branch) => branch.branch), [
    'THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK', 'THETA_RECOVERY', 'THETA_CC',
  ]);
  const conventional = result.branches[0];
  assert.equal(conventional?.evaluationState, 'EVALUATED');
  assert.equal(conventional?.candidates[0]?.riskFeasible, true);
  assert.ok(conventional?.candidates[0]?.unknownEvidence.includes('EVENT_STATE_UNKNOWN'));
  assert.equal(result.selectedBranch, 'THETA_CONVENTIONAL');
  assert.equal(result.decisionAuthorityVersion, 'theta-canonical-decision-authority-v1');
  assert.equal(result.primaryAction, 'OPEN_CSP');
  assert.equal(result.selectedQuantity, 2);
  assert.equal(result.empiricalUtilityState, 'UNKNOWN_NOT_YET_CALIBRATED');
  assert.equal(result.globalWaitEarned, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.empiricalEconomicsReady, false);
});

test('hold-strike evaluates 2-5 DTE near-expiry contracts without treating missing delta as a hard veto', () => {
  const nearExpiry = contract({ optionSymbol: 'AAPL260918P00200000', occSymbol: 'AAPL260918P00200000', strike: 200,
    expiration: '2026-09-18', delta: null, gamma: null, theta: null, vega: null, rho: null, iv: null, greeksSource: null });
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [nearExpiry], routing: routing(['THETA_H']) });
  const hold = result.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE');
  assert.equal(hold?.candidateCount, 1);
  assert.equal(hold?.candidates[0]?.riskFeasible, true);
  assert.ok(hold?.candidates[0]?.unknownEvidence.includes('DELTA_UNKNOWN'));
});

test('defined-risk frontier prices both legs with the broker multiplier and keeps the branch research-only', () => {
  const shortPut = contract({ optionSymbol: 'AAPL261016P00195000', occSymbol: 'AAPL261016P00195000', strike: 195, bid: 3, ask: 3.1 });
  const longPut = contract({ optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000', strike: 190, bid: 1, ask: 1.1 });
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [shortPut, longPut], routing: routing(['THETA_D']) });
  const defined = result.branches.find((branch) => branch.branch === 'THETA_DEFINED_RISK');
  const spread = defined?.candidates.find((candidate) => candidate.legs[0]?.strike === 195 && candidate.legs[1]?.strike === 190);
  assert.equal(defined?.status, 'RESEARCH_ONLY');
  assert.equal(spread?.economics.maxProfit, 190);
  assert.equal(spread?.economics.maxLoss, 310);
  assert.equal(spread?.executionAuthorized, false);
});

test('recovery and covered-call frontiers require confirmed stock and preserve whole-chain call-away economics', () => {
  const call = contract({ optionType: 'CALL', optionSymbol: 'AAPL261016C00210000', occSymbol: 'AAPL261016C00210000',
    strike: 210, bid: 2.5, ask: 2.6, delta: 0.25 });
  const result = buildCanonicalStrategyFrontier({
    ...base, contracts: [call], routing: routing([]),
    stock: { underlying: 'AAPL', shares: 100, currentPrice: 200, brokerCostBasisPerShare: 205, wholeChainEconomicBasisPerShare: 202 },
  });
  const recovery = result.branches.find((branch) => branch.branch === 'THETA_RECOVERY');
  const cc = result.branches.find((branch) => branch.branch === 'THETA_CC');
  assert.deepEqual(new Set(recovery?.candidates.map((candidate) => candidate.action)), new Set(['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC']));
  assert.equal(cc?.candidates[0]?.economics.retainedUpside, 1_000);
  assert.equal(cc?.candidates[0]?.economics.wholeChainPnlAtCallAway, 1_050);
  assert.equal(cc?.executionAuthorized, false);
  assert.equal(result.selectedBranch, null, 'recovery and CC alternatives cannot be cross-ranked without action EV');
});

test('GLOBAL_WAIT is earned only after every applicable branch is evaluated and no risk-feasible action exists', () => {
  const invalidIdentity = contract({ occSymbol: null });
  const exhausted = buildCanonicalStrategyFrontier({ ...base, contracts: [invalidIdentity], routing: routing(['THETA_Q']) });
  assert.equal(exhausted.globalWaitEarned, true);
  assert.deepEqual(exhausted.globalWaitReasons, ['ALL_APPLICABLE_BRANCHES_EVALUATED', 'NO_RISK_FEASIBLE_ACTION']);

  const incomplete = buildCanonicalStrategyFrontier({ ...base, contracts: [], routing: routing(['THETA_Q']) });
  assert.equal(incomplete.globalWaitEarned, false);
  assert.ok(incomplete.globalWaitReasons.includes('BRANCH_NOT_FULLY_EVALUATED:THETA_CONVENTIONAL'));
});

test('research quote limitations stay separate from strategy feasibility and never authorize execution',()=>{
  const recorded=contract({source:'OPTIONOMICS',feed:null});
  const result=buildCanonicalStrategyFrontier({...base,contracts:[recorded],routing:routing(['THETA_Q'])});
  const candidate=result.branches.find((branch)=>branch.branch==='THETA_CONVENTIONAL')?.candidates[0];
  assert.equal(candidate?.structurallyFeasible,true);
  assert.ok(candidate?.unknownEvidence.some((reason)=>reason.startsWith('EXECUTION_QUOTE_REQUIRED:')));
  assert.equal(result.executionAuthorized,false);
});

test('canonical authority compares independently eligible branches and does not leave THETA_Q authoritative', () => {
  const conventional = contract();
  const hold = contract({ optionSymbol: 'AAPL260918P00195000', occSymbol: 'AAPL260918P00195000',
    strike: 195, expiration: '2026-09-18', bid: 1.1, ask: 1.15, delta: null });
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [conventional, hold], routing: routing(['THETA_Q', 'THETA_H']) });
  assert.deepEqual(result.branchesConsidered, ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE']);
  assert.ok(result.selectedBranch === 'THETA_CONVENTIONAL' || result.selectedBranch === 'THETA_HOLD_STRIKE');
  assert.notEqual(result.selectedCandidateId, null);
  assert.notEqual(result.secondBestCandidateId, null);
  assert.equal(result.executionAuthorized, false);
});

test('quantity zero is authoritative GLOBAL_WAIT after complete evaluation, never forced to one', () => {
  const result = buildCanonicalStrategyFrontier({
    ...base, contracts: [contract()], routing: routing(['THETA_Q']),
    sizingPolicy: { ...base.sizingPolicy, tailRiskQtyCap: 0 },
  });
  assert.equal(result.selectedQuantity, 0);
  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.primaryAction, 'GLOBAL_WAIT');
  assert.equal(result.globalWaitEarned, true);
  assert.equal(result.nearMissCandidateId, 'THETA_CONVENTIONAL:AAPL261016P00190000');
});

test('candidate-specific AEGIS veto cannot be bypassed by a globally permissive state', () => {
  const first = contract();
  const second = contract({ optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000', strike: 185,
    bid: 1.4, ask: 1.5, delta: -0.16 });
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [first, second], routing: routing(['THETA_Q']),
    aegisNewRiskStateByCandidateId: {
      'THETA_CONVENTIONAL:AAPL261016P00190000': 'HARD_VETO',
      'THETA_CONVENTIONAL:AAPL261016P00185000': 'ALLOW_FULL',
    } });
  const conventional = result.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.equal(conventional?.candidates.find((candidate) => candidate.candidateId.endsWith('190000'))?.riskFeasible, false);
  assert.equal(result.selectedCandidateId, 'THETA_CONVENTIONAL:AAPL261016P00185000');
});

test('candidate-specific real broker capacity is preserved by canonical sizing', () => {
  const result = buildCanonicalStrategyFrontier({
    ...base,
    contracts: [contract()],
    routing: routing(['THETA_Q']),
    brokerAllowedQty: undefined,
    brokerAllowedQtyByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': 1 },
  });
  assert.equal(result.selectedQuantity, 1);
  const selected = result.branches[0]?.candidates[0];
  assert.equal(selected?.sizing.bindingConstraint, 'BROKER_ALLOWED');
});
