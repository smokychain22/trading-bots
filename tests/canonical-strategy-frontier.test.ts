import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { paperEntryCandidateCohort } from '../src/research/production-shadow-runtime.js';
import { projectPersistableThetaCandidates } from '../src/theta/postgres-theta-cycle-store.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';

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

test('candidate persistence leaves incomplete economics unknown instead of inventing breakeven or zero yield', () => {
  const frontier = buildCanonicalStrategyFrontier({ ...base, eventState: 'CLEAR',
    contracts: [contract()], routing: routing(['THETA_Q']) });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  const candidate = conventional.candidates[0];
  assert.ok(candidate);
  const project = (breakEven: number | null, collateral: number | null) => projectPersistableThetaCandidates({
    strategyFrontier: { ...frontier, branches: frontier.branches.map((branch) => branch.branch === 'THETA_CONVENTIONAL'
      ? { ...branch, candidates: [{ ...candidate, economics: { ...candidate.economics, breakEven, collateral } }] }
      : branch) },
    orchestration: { thetaQ: { candidates: [] }, ownership: { ownability: 0.8 } },
  } as unknown as ThetaShadowCycleResult)[0];
  const known = project(188, 19_000);
  assert.equal(known?.economics?.break_even_price, 188);
  assert.equal(known?.economics?.credit_collateral_ratio, 200 / 19_000);
  const missingBreakeven = project(null, 19_000);
  assert.equal(missingBreakeven?.economics, null);
  assert.equal(missingBreakeven?.actionFeasible, false);
  assert.equal(missingBreakeven?.quantity, 0);
  assert.ok(missingBreakeven?.reasons.some((reason) => reason.code === 'CANDIDATE_ECONOMICS_INCOMPLETE'));
  const zeroCollateral = project(188, 0);
  assert.equal(zeroCollateral?.economics, null);
  assert.equal(zeroCollateral?.actionFeasible, false);
  assert.ok(zeroCollateral?.reasons.some((reason) => reason.code === 'CANDIDATE_ECONOMICS_INCOMPLETE'));
});

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
  assert.equal(result.selectedBranch, null, 'research-only Hold-Strike cannot become the Paper selection');
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
  assert.equal(result.definedRiskLockedPlan.plan?.brokerMultiLegSupport, 'UNKNOWN');
  assert.equal(result.selectedBranch, null, 'research-only Defined Risk cannot become the Paper selection');
});

test('defined-risk plan records Level 3 MLeg support while remaining locked and non-submittable', () => {
  const shortPut = contract({ optionSymbol: 'AAPL261016P00195000', occSymbol: 'AAPL261016P00195000',
    strike: 195, bid: 3, ask: 3.1 });
  const longPut = contract({ optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    strike: 190, bid: 1, ask: 1.1 });
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [shortPut, longPut], routing: routing(['THETA_D']),
    optionsApprovedLevel: 3, optionsTradingLevel: 3 });
  assert.equal(result.definedRiskLockedPlan.plan?.brokerMultiLegSupport, 'ATOMIC_MULTI_LEG_SUPPORTED');
  assert.equal(result.definedRiskLockedPlan.plan?.runtimeMutationAdapter, 'NOT_IMPLEMENTED_RESEARCH_ONLY');
  assert.equal(result.definedRiskLockedPlan.plan?.submissionAllowed, false);
});

test('inapplicable research branches keep contract counterfactuals with router veto intact', () => {
  const shortDte = contract({ optionSymbol: 'AAPL260918P00200000', occSymbol: 'AAPL260918P00200000',
    strike: 200, expiration: '2026-09-18' });
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [shortDte], routing: routing([]) });
  const hold = result.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE');
  assert.equal(hold?.applicable, false);
  assert.equal(hold?.evaluationState, 'NOT_APPLICABLE');
  assert.equal(hold?.candidateCount, 1);
  assert.equal(hold?.candidates[0]?.riskFeasible, false);
  assert.ok(hold?.candidates[0]?.hardBlockers.includes('ROUTER_NOT_APPLICABLE'));
  assert.equal(hold?.candidates[0]?.sizing.quantity, 0);
  assert.equal(result.selectedCandidateId, null);
});

test('Paper WAIT diagnostics exclude shadow and research counterfactuals while branch evidence retains them', () => {
  const conventional = contract();
  const hold = contract({ optionSymbol: 'AAPL260918P00195000', occSymbol: 'AAPL260918P00195000',
    strike: 195, expiration: '2026-09-18' });
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [conventional, hold],
    routing: routing(['THETA_Q', 'THETA_H']) });
  const cohort = paperEntryCandidateCohort(frontier.branches);
  assert.deepEqual(cohort.branches.map((branch) => branch.branch), ['THETA_CONVENTIONAL']);
  assert.deepEqual(cohort.candidates.map((candidate) => candidate.candidateId),
    ['THETA_CONVENTIONAL:AAPL261016P00190000']);
  assert.equal(frontier.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE')?.candidateCount, 1);
  const onlyShadow = buildCanonicalStrategyFrontier({ ...base, contracts: [hold], routing: routing(['THETA_H']) });
  assert.equal(onlyShadow.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE')?.candidateCount, 1);
  assert.equal(onlyShadow.nearMissCandidateId, null);
  assert.equal(onlyShadow.bestRejectedCandidateId, null);
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

test('GLOBAL_WAIT is earned only after the Paper branch is evaluated and no risk-feasible action exists', () => {
  const invalidIdentity = contract({ occSymbol: null });
  const exhausted = buildCanonicalStrategyFrontier({ ...base, contracts: [invalidIdentity], routing: routing(['THETA_Q']) });
  assert.equal(exhausted.globalWaitEarned, true);
  assert.deepEqual(exhausted.globalWaitReasons, ['PAPER_AUTHORIZED_BRANCH_EVALUATED', 'NO_RISK_FEASIBLE_ACTION']);

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

test('research branches remain visible but cannot win the bounded Conventional Paper selection', () => {
  const conventional = contract();
  const hold = contract({ optionSymbol: 'AAPL260918P00195000', occSymbol: 'AAPL260918P00195000',
    strike: 195, expiration: '2026-09-18', bid: 1.1, ask: 1.15, delta: null });
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [conventional, hold], routing: routing(['THETA_Q', 'THETA_H']) });
  assert.deepEqual(result.branchesConsidered, ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE']);
  assert.equal(result.selectedBranch, 'THETA_CONVENTIONAL');
  assert.notEqual(result.selectedCandidateId, null);
  assert.equal(result.secondBestCandidateId, null);
  assert.ok(result.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE')?.candidateCount === 1);
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

test('unknown AEGIS or sizing evidence is SYSTEM_HOLD, not an earned economic GLOBAL_WAIT', () => {
  for (const scenario of [
    { aegisNewRiskState: null, sizingPolicy: base.sizingPolicy, expected: 'AEGIS_UNKNOWN' },
    { aegisNewRiskState: 'ALLOW_FULL' as const, sizingPolicy: { ...base.sizingPolicy, tailRiskQtyCap: null }, expected: 'SIZING_POLICY_INCOMPLETE' },
  ]) {
    const result = buildCanonicalStrategyFrontier({ ...base, ...scenario, contracts: [contract()], routing: routing(['THETA_Q']) });
    assert.equal(result.primaryAction, 'SYSTEM_HOLD');
    assert.equal(result.globalWaitEarned, false);
    assert.equal(result.selectedQuantity, 0);
    assert.ok(result.globalWaitReasons.includes(`CANDIDATE_SIZING_EVIDENCE_UNKNOWN:${scenario.expected}`));
  }
});

test('a candidate-specific unknown AEGIS state never falls back to a permissive global state', () => {
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(['THETA_Q']),
    aegisNewRiskStateByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': null } });
  const candidate = result.branches[0]?.candidates[0];
  assert.equal(candidate?.aegisState, null);
  assert.equal(candidate?.sizing.quantity, 0);
  assert.equal(result.primaryAction, 'SYSTEM_HOLD');
});

test('AEGIS zero sizing preserves the exact binding family and reason', () => {
  const candidateId='THETA_CONVENTIONAL:AAPL261016P00190000';
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(['THETA_Q']),
    aegisNewRiskStateByCandidateId: { [candidateId]: 'HOLD_ONLY' },
    aegisBindingReasonsByCandidateId: { [candidateId]: ['SYSTEM:IV_BASELINE_ACCUMULATING'] } });
  const candidate=result.branches[0]?.candidates[0];
  assert.equal(candidate?.sizing.quantity,0);
  assert.equal(candidate?.sizing.bindingConstraint,'SYSTEM:IV_BASELINE_ACCUMULATING');
  assert.deepEqual(candidate?.sizing.reasons,['SYSTEM:IV_BASELINE_ACCUMULATING']);
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

test('a Q lattice rejection cannot win Paper selection ahead of a feasible contract', () => {
  const rejected = contract({ optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000',
    strike: 185, bid: 1.4, ask: 1.5, delta: -0.16 });
  const feasible = contract();
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [rejected, feasible],
    routing: routing(['THETA_Q']), thetaQActionFeasibleByOptionSymbol: {
      [rejected.optionSymbol]: false, [feasible.optionSymbol]: true,
    } });
  const conventional = result.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional?.candidates.find((candidate) => candidate.legs[0]?.optionSymbol === rejected.optionSymbol)
    ?.hardBlockers.includes('THETA_Q_ACTION_INFEASIBLE'));
  assert.equal(result.selectedCandidateId, `THETA_CONVENTIONAL:${feasible.optionSymbol}`);
});

test('a contract excluded from the Q lattice cannot open, but a valid Q WAIT stays WAIT', () => {
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(['THETA_Q']),
    thetaQActionFeasibleByOptionSymbol: {},
    thetaQDecision: { snapshotId: base.snapshotId, timestamp: NOW, underlying: 'AAPL', winningAction: 'WAIT',
      selectedCandidateId: null, quantity: 0 } });
  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.primaryAction, 'GLOBAL_WAIT');
  assert.ok(result.branches[0]?.candidates[0]?.hardBlockers.includes('THETA_Q_OUTSIDE_EVALUATED_LATTICE'));
  assert.ok(result.globalWaitReasons.includes('THETA_Q_ECONOMIC_WAIT'));
});

test('a null Q lattice after quote freshness rejection cannot become an OPEN or false missing-evidence HOLD', () => {
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(['THETA_Q']),
    thetaQDecision: { snapshotId: base.snapshotId, timestamp: NOW, underlying: 'AAPL', winningAction: 'WAIT',
      selectedCandidateId: null, quantity: 0 } });
  assert.equal(result.primaryAction, 'GLOBAL_WAIT');
  assert.equal(result.selectedQuantity, 0);
});

test('Paper-facing selection follows the economic Q winner rather than structural or lexical order', () => {
  const first = contract({ optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000',
    strike: 185, bid: 1.4, ask: 1.5, delta: -0.16 });
  const winner = contract();
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [first, winner],
    routing: routing(['THETA_Q']), thetaQActionFeasibleByOptionSymbol: {
      [first.optionSymbol]: true, [winner.optionSymbol]: true,
    }, thetaQDecision: { snapshotId: base.snapshotId, timestamp: NOW, underlying: 'AAPL', winningAction: 'OPEN_REDUCED',
      selectedCandidateId: winner.optionSymbol, quantity: 1 } });
  assert.equal(result.primaryAction, 'OPEN_CSP');
  assert.equal(result.selectedCandidateId, `THETA_CONVENTIONAL:${winner.optionSymbol}`);
  assert.equal(result.selectedQuantity, 1);
  assert.equal(result.secondBestCandidateId, null);
});

test('an economic Q WAIT cannot be promoted to an OPEN by the structural frontier', () => {
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()],
    routing: routing(['THETA_Q']), thetaQActionFeasibleByOptionSymbol: { [contract().optionSymbol]: true },
    thetaQDecision: { snapshotId: base.snapshotId, timestamp: NOW, underlying: 'AAPL', winningAction: 'WAIT',
      selectedCandidateId: null, quantity: 0 } });
  assert.equal(result.primaryAction, 'GLOBAL_WAIT');
  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.selectedQuantity, 0);
  assert.ok(result.globalWaitReasons.includes('THETA_Q_ECONOMIC_WAIT'));
});

test('missing research-only H candidates do not turn a complete Q WAIT into SYSTEM_HOLD', () => {
  const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()],
    routing: routing(['THETA_Q', 'THETA_H']), thetaQActionFeasibleByOptionSymbol: { [contract().optionSymbol]: true },
    thetaQDecision: { snapshotId: base.snapshotId, timestamp: NOW, underlying: 'AAPL', winningAction: 'WAIT',
      selectedCandidateId: null, quantity: 0 } });
  assert.equal(result.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE')?.evaluationState,
    'BLOCKED_MISSING_INPUT');
  assert.equal(result.primaryAction, 'GLOBAL_WAIT');
  assert.ok(result.globalWaitReasons.includes('PAPER_AUTHORIZED_BRANCH_EVALUATED'));
  assert.ok(result.globalWaitReasons.includes('THETA_Q_ECONOMIC_WAIT'));
});

test('a mismatched Q receipt or infeasible economic winner fails closed', () => {
  for (const decision of [
    { snapshotId: 'another-snapshot', timestamp: NOW, underlying: 'AAPL', winningAction: 'OPEN_FULL' as const,
      selectedCandidateId: contract().optionSymbol, quantity: 1 },
    { snapshotId: base.snapshotId, timestamp: '2026-09-14T15:01:00.000Z', underlying: 'AAPL',
      winningAction: 'OPEN_FULL' as const, selectedCandidateId: contract().optionSymbol, quantity: 1 },
    { snapshotId: base.snapshotId, timestamp: NOW, underlying: 'AAPL', winningAction: 'OPEN_FULL' as const,
      selectedCandidateId: 'AAPL261016P00180000', quantity: 1 },
  ]) {
    const result = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(['THETA_Q']),
      thetaQActionFeasibleByOptionSymbol: { [contract().optionSymbol]: true }, thetaQDecision: decision });
    assert.equal(result.primaryAction, 'SYSTEM_HOLD');
    assert.equal(result.selectedCandidateId, null);
    assert.equal(result.selectedQuantity, 0);
  }
});

test('missing downside cushion cannot give a premium-rich CSP false Pareto dominance', () => {
  const unknownDownside = contract({ optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    bid: 4, ask: 4.1, underlyingBid: null, underlyingAsk: null, underlyingLast: null });
  const knownDownside = contract({ optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000',
    strike: 185, bid: 1.5, ask: 1.6 });
  const result = buildCanonicalStrategyFrontier({ ...base,
    contracts: [unknownDownside, knownDownside], routing: routing(['THETA_Q']) });
  const candidates = result.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL')?.candidates ?? [];
  assert.equal(candidates.length, 2);
  assert.equal(candidates.find((candidate) => candidate.candidateId.endsWith('185000'))?.dominatedBy.length, 0);
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

test('covered-call call-away PnL remains unknown when premium is unknown', () => {
  const call = contract({ optionType: 'CALL', optionSymbol: 'AAPL261016C00210000', occSymbol: 'AAPL261016C00210000',
    strike: 210, bid: null, ask: 1.25, delta: 0.25 });
  const result = buildCanonicalStrategyFrontier({
    ...base, contracts: [call], routing: routing([]),
    stock: { underlying: 'AAPL', shares: 100, currentPrice: 200, brokerCostBasisPerShare: 205, wholeChainEconomicBasisPerShare: 202 },
  });
  const candidate = result.branches.find((branch) => branch.branch === 'THETA_CC')?.candidates[0];
  assert.equal(candidate?.economics.wholeChainPnlAtCallAway, null);
});

test('unknown stock quantity keeps recovery and covered-call branches visible but blocked', () => {
  const call = contract({ optionType: 'CALL', optionSymbol: 'AAPL261016C00210000', occSymbol: 'AAPL261016C00210000',
    strike: 210, delta: 0.25 });
  const result = buildCanonicalStrategyFrontier({
    ...base, contracts: [call], routing: routing([]),
    stock: { underlying: 'AAPL', shares: null, currentPrice: 200, brokerCostBasisPerShare: 205, wholeChainEconomicBasisPerShare: 202 },
  });
  for (const branchName of ['THETA_RECOVERY', 'THETA_CC'] as const) {
    const branch = result.branches.find((item) => item.branch === branchName);
    assert.equal(branch?.applicable, true);
    assert.ok(branch?.candidates.some((candidate) => candidate.hardBlockers.includes('STOCK_QUANTITY_UNKNOWN')));
    assert.equal(branch?.candidates.some((candidate) => candidate.executionAuthorized), false);
  }
});
