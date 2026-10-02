import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { buildGlobalWaitEvidenceFromFrontier } from '../src/theta/decision-evidence.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { classifySizingZero, deriveAntiParalysisFindings } from '../src/theta/runtime-behavior-diagnostic.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { completeConventionalFrontierEvaluationCoverage } from '../src/theta/theta-shadow-cycle.js';

// SIZE-ZERO-LABEL-01 / CAPZERO-LABEL: a shortlist-bound candidate PROVEN account-policy incompatible is labelled
// ACCOUNT_POLICY_INCOMPATIBILITY (quantity 0, protection unchanged), never 'evaluation incomplete'.

const NOW = '2026-09-14T15:00:00.000Z';
const contract = () => normalizeOptionContract({
  source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
  optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
  underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
  bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
  quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
  openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
  rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
}, NOW);
const routing = () => parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: (['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as StrategyFamily[]).map((strategyFamily) => ({
    strategyFamily, eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'R', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
});
const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', stock: null, assignmentCapacityQty: null,
  aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 100_000 as number | null, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3,
    tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'UNKNOWN' } as const,
};
const shortlistBound = (extra: Record<string, unknown>) => buildCanonicalStrategyFrontier({
  ...base, aegisNewRiskStateByCandidateId: {}, contracts: [contract()], routing: routing(),
  thetaQCandidateEvaluationByOptionSymbol: { [contract().optionSymbol]: {
    state: 'NOT_EVALUATED_SHORTLIST_BOUND' as const, reasonCode: 'NOT_SELECTED_FOR_FINALIST_REFRESH', ...extra } },
} as never);
const candidateOf = (frontier: ReturnType<typeof buildCanonicalStrategyFrontier>) => {
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(candidate);
  return candidate;
};

test('proven account-policy incompatibility is labelled as such, keeps quantity 0 and the SYSTEM_HOLD protection', () => {
  const proven = shortlistBound({ accountPolicyIncompatibility: { state: 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE', bindingPolicies: ['TICKER_CONCENTRATION'] } });
  const candidate = candidateOf(proven);
  assert.ok(candidate.hardBlockers.includes('ACCOUNT_POLICY_INCOMPATIBILITY'));
  assert.ok(!candidate.hardBlockers.includes('THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'));
  assert.equal(candidate.sizing.quantity, 0);
  assert.equal(proven.selectedQuantity, 0);
  assert.equal(proven.executionAuthorized, false);
  assert.equal(proven.primaryAction, 'SYSTEM_HOLD', 'protection is not loosened: Q/AEGIS never evaluated it');
  assert.equal(proven.globalWaitEarned, false);
  assert.equal(proven.paperEvaluationCoverage?.incompleteReasonCounts.ACCOUNT_POLICY_INCOMPATIBILITY, 1);
  assert.equal(proven.paperEvaluationCoverage?.incompleteReasonCounts.NOT_EVALUATED_SHORTLIST_BOUND, undefined);
  assert.equal(classifySizingZero(candidate), 'ACCOUNT_CAPACITY_ZERO');
  const wait = buildGlobalWaitEvidenceFromFrontier({ frontier: proven, eligibleUnderlyingCount: 1, underlyingsEvaluated: 1,
    existingPositionManagementEvaluated: true, recoveryOpportunitiesEvaluated: true, coveredCallOpportunitiesEvaluated: true,
    redeploymentAlternativesEvaluated: true });
  // AEGIS never ran for this candidate, so the wait stays honestly DATA_INSUFFICIENT (never RISK_VETO / earned WAIT); the proven
  // blocker still maps to the capacity hard gate used for PORTFOLIO_CAPACITY when AEGIS-state evidence is present.
  assert.equal(wait.reason, 'DATA_INSUFFICIENT');
  assert.notEqual(wait.reason, 'RISK_VETO');
});

test('without proof the old honest label stays (missing input is named, not guessed)', () => {
  const unproven = shortlistBound({});
  const candidate = candidateOf(unproven);
  assert.ok(candidate.hardBlockers.includes('THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'));
  assert.ok(!candidate.hardBlockers.includes('ACCOUNT_POLICY_INCOMPATIBILITY'));
  assert.equal(unproven.paperEvaluationCoverage?.incompleteReasonCounts.NOT_EVALUATED_SHORTLIST_BOUND, 1);
  assert.equal(classifySizingZero(candidate), 'Q_REJECTED_UPSTREAM');
});

test('coverage completion consults the proof callback only for non-finalist puts in the lattice', () => {
  const rows = [
    { optionSymbol: 'A', optionType: 'PUT' as const, dte: 30 }, { optionSymbol: 'B', optionType: 'PUT' as const, dte: 30 },
    { optionSymbol: 'C', optionType: 'CALL' as const, dte: 30 }, { optionSymbol: 'D', optionType: 'PUT' as const, dte: 3 },
  ];
  const asked: string[] = [];
  const out = completeConventionalFrontierEvaluationCoverage(rows, new Set(['B']), {}, { dteMin: 7, dteMax: 60 }, (symbol) => {
    asked.push(symbol);
    return { state: 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE', bindingPolicies: ['ASSIGNMENT_CAPACITY'] };
  });
  assert.deepEqual(asked, ['A']);
  assert.deepEqual(Object.keys(out), ['A']);
  assert.equal(out.A?.accountPolicyIncompatibility?.state, 'STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE');
  const noProof = completeConventionalFrontierEvaluationCoverage(rows, new Set(['B']), {}, { dteMin: 7, dteMax: 60 }, () => null);
  assert.equal(noProof.A?.accountPolicyIncompatibility, undefined);
  const legacy = completeConventionalFrontierEvaluationCoverage(rows, new Set(['B']), {}, { dteMin: 7, dteMax: 60 });
  assert.deepEqual(legacy.A, { state: 'NOT_EVALUATED_SHORTLIST_BOUND', reasonCode: 'NOT_SELECTED_FOR_FINALIST_REFRESH' });
});

test('a population dominated by proven account incompatibility is not reported as decision-logic paralysis', () => {
  const marker = [['ACCOUNT_POLICY_INCOMPATIBILITY'], ['ACCOUNT_POLICY_INCOMPATIBILITY'], ['ACCOUNT_POLICY_INCOMPATIBILITY']];
  assert.deepEqual(deriveAntiParalysisFindings({ candidateHardBlockers: marker, strategyReachability: [] }), []);
});

test('AEGIS-assessed risk-capacity zero uses the same capacity label in sizing, diagnostic and WAIT reason (never RISK_VETO)', () => {
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(),
    riskCapacityQtyByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': 0 } } as never);
  const candidate = candidateOf(frontier);
  assert.equal(candidate.sizing.quantity, 0);
  assert.equal(candidate.sizing.bindingConstraint, 'AEGIS_RISK_CAPACITY');
  assert.equal(classifySizingZero(candidate), 'ACCOUNT_CAPACITY_ZERO');
  const wait = buildGlobalWaitEvidenceFromFrontier({ frontier, eligibleUnderlyingCount: 1, underlyingsEvaluated: 1,
    existingPositionManagementEvaluated: true, recoveryOpportunitiesEvaluated: true, coveredCallOpportunitiesEvaluated: true,
    redeploymentAlternativesEvaluated: true });
  assert.equal(wait.reason, 'PORTFOLIO_CAPACITY');
  const unknown = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(),
    riskCapacityQtyByCandidateId: { 'THETA_CONVENTIONAL:AAPL261016P00190000': null } } as never);
  assert.ok(candidateOf(unknown).unknownEvidence.includes('AEGIS_RISK_CAPACITY_UNKNOWN'));
  assert.equal(classifySizingZero(candidateOf(unknown)), 'AEGIS_REQUIRED_UNKNOWN');
  assert.equal(buildGlobalWaitEvidenceFromFrontier({ frontier: unknown, eligibleUnderlyingCount: 1, underlyingsEvaluated: 1,
    existingPositionManagementEvaluated: true, recoveryOpportunitiesEvaluated: true, coveredCallOpportunitiesEvaluated: true,
    redeploymentAlternativesEvaluated: true }).reason, 'DATA_INSUFFICIENT');
});
