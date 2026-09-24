import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveBrainLayerOwnership, adaptiveStrategyRegistry, buildAdaptiveShadowDecisionReceipt,
  buildOvertradingDiagnostic, buildWaitParalysisDiagnostic, canonicalEvidencePolicyRoles,
  fixedVsAdaptiveExperiments, sovereignDecisionPath, thetaRManagementRoute, validateKernelEvidence,
} from '../src/theta/adaptive-decision-brain.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
const required = <T>(value: T | null | undefined): T => { assert.ok(value !== null && value !== undefined); return value; };

const frontier = (): CanonicalStrategyFrontier => ({
  contractVersion: 'theta-canonical-strategy-frontier-v1', snapshotId: 'snapshot-1',
  timestamp: '2026-09-21T14:00:00.000Z', strategyVersion: 'strategy-v1',
  decisionAuthorityVersion: 'theta-canonical-decision-authority-v1',
  branches: [{ branch: 'THETA_CONVENTIONAL', strategyVersion: 'v1', status: 'SHADOW', applicable: true,
    evaluated: true, routeReasons: [], evaluationState: 'EVALUATED', candidateCount: 1,
    mechanicallyRejected: 0, enumerationTruncated: false, hardVetoed: 0, softRanked: 1,
    dataInsufficient: 0, candidates: [{ candidateId: 'c1', branch: 'THETA_CONVENTIONAL', action: 'OPEN_CSP',
      underlying: 'SPY', legs: [], dte: 30, delta: -0.2, moneyness: 0.95, spreadPct: 0.02,
      liquidity: { volume: 100, openInterest: 1000 }, economics: { premiumPerShare: 1, grossPremium: 100,
        collateral: 10_000, maxProfit: 100, maxLoss: null, breakEven: 99, downsideCushion: 0.01,
        retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
        capitalDayYield: 0.0003, expectedAfterCostEv: null }, assignmentCapacityQty: 1,
      aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: ['REGIME_CONTEXT'],
      unknownEvidence: ['FLOW_UNKNOWN'], structurallyFeasible: true, riskFeasible: true,
      sizing: { quantity: 1, bindingConstraint: 'RISK_BUDGET', reasons: ['STRUCTURAL_SIZING_COMPUTED'] },
      paretoRank: 1, dominatedBy: [], executionAuthorized: false }], bestCandidateId: 'c1',
    secondBestCandidateId: null, bestRejectedCandidateId: null, empiricalEconomicsReady: false,
    executionAuthorized: false }],
  branchesConsidered: ['THETA_CONVENTIONAL'], branchesEvaluated: ['THETA_CONVENTIONAL'],
  selectedBranch: 'THETA_CONVENTIONAL', selectedCandidateId: 'c1', primaryAction: 'OPEN_CSP',
  selectedQuantity: 1, empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED', secondBestCandidateId: null,
  nearMissCandidateId: null, bestRejectedCandidateId: null, globalWaitEarned: false, globalWaitReasons: [],
  empiricalEconomicsReady: false, executionAuthorized: false, optionomicsContext: {}, contentHash: 'a'.repeat(64),
});

const currentDecision = () => ({
  selectedCandidateRef: 'c1', actionCode: 'OPEN_CSP', quantity: 1, strategyBranch: 'THETA_CONVENTIONAL',
} as const);

function comparableFrontier(): CanonicalStrategyFrontier {
  const f = frontier();
  const c = required(required(f.branches[0]).candidates[0]);
  const legs = [{ positionIntent: 'SELL_TO_OPEN' as const, optionSymbol: 'SPY261021P00100000',
    occSymbol: 'SPY261021P00100000', optionType: 'PUT' as const, strike: 100, expiration: '2026-10-21',
    multiplier: 100, contractTradable: true, deliverableClassification: 'STANDARD_EQUITY' as const,
    bid: 1, ask: 1.05, quoteTimestamp: f.timestamp }];
  return { ...f, branches: [{ ...required(f.branches[0]), candidates: [
    { ...c, legs }, { ...c, candidateId: 'c2', legs: [{ ...required(legs[0]), optionSymbol: 'SPY261021P00099000',
      occSymbol: 'SPY261021P00099000', strike: 99 }] },
  ] }] };
}

test('real frontier alternatives enter the structural comparator without changing Q or inventing EV', () => {
  const f = comparableFrontier();
  const before = JSON.stringify(f);
  const result = buildAdaptiveShadowDecisionReceipt({ frontier: f, currentDecision: currentDecision() });
  assert.equal(JSON.stringify(f), before);
  assert.equal(result.comparison, 'STRUCTURAL_COMPARISON');
  assert.equal(required(result.shadowComparison.cohorts[0]).comparison.state, 'STRUCTURAL_ONLY');
  assert.equal(required(required(result.shadowComparison.cohorts[0]).candidates[0]).deterministic.maxLoss, 9900);
  assert.equal(required(required(result.shadowComparison.cohorts[0]).candidates[0]).empirical.expectedAfterCostWholeChainPnl, null);
  assert.equal(result.currentPolicyDecision.candidateId, 'c1');
  assert.equal(result.adaptiveShadowDecision.candidateId, null);
  assert.equal(result.adaptiveShadowDecision.quantity, null);
  assert.equal(result.shadowComparison.brokerAuthority, false);
  const reversed = { ...f, branches: [{ ...required(f.branches[0]), candidates: [...required(f.branches[0]).candidates].reverse() }] };
  assert.equal(buildAdaptiveShadowDecisionReceipt({ frontier: reversed, currentDecision: currentDecision() }).contentHash, result.contentHash);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('future quotes, invalid identity and incomplete enumeration remain visible', () => {
  const f = comparableFrontier();
  const bad = { ...f, branches: [{ ...required(f.branches[0]), enumerationTruncated: true,
    candidates: required(f.branches[0]).candidates.map((c) => ({ ...c, legs: c.legs.map((l) => ({ ...l,
      quoteTimestamp: '2026-09-22T14:00:00Z', contractTradable: null })) })) }] };
  const result = buildAdaptiveShadowDecisionReceipt({ frontier: bad, currentDecision: currentDecision() });
  assert.equal(result.comparison, 'NO_COMPARISON');
  assert.equal(result.shadowComparison.enumerationComplete, false);
  assert.equal(result.shadowComparison.excluded.length, 2);
  assert.ok(required(result.shadowComparison.excluded[0]).reasons.includes('QUOTE_TIME_INVALID_OR_FUTURE'));
});

test('different expirations are never treated as a common payoff horizon', () => {
  const f = comparableFrontier();
  const mixed = { ...f, branches: [{ ...required(f.branches[0]), candidates: required(f.branches[0]).candidates.map((c, i) =>
    ({ ...c, legs: c.legs.map((l) => ({ ...l, expiration: i === 0 ? '2026-10-21' : '2026-09-25',
      optionSymbol: i === 0 ? l.optionSymbol : l.optionSymbol.replace('261021', '260925'),
      occSymbol: i === 0 ? l.occSymbol : l.occSymbol.replace('261021', '260925') })) })) }] };
  const result = buildAdaptiveShadowDecisionReceipt({ frontier: mixed, currentDecision: currentDecision() });
  assert.equal(result.comparison, 'NO_COMPARISON');
  assert.equal(result.shadowComparison.cohorts.length, 2);
});

test('quote qualification blocks price comparison while risk-only blocks remain observable', () => {
  const f = comparableFrontier();
  const blocked = { ...f, branches: [{ ...required(f.branches[0]), candidates: required(f.branches[0]).candidates.map((c) =>
    ({ ...c, structurallyFeasible: false, riskFeasible: false, hardBlockers: ['AEGIS_HOLD_ONLY'] })) }] };
  const compared = buildAdaptiveShadowDecisionReceipt({ frontier: blocked, currentDecision: currentDecision() });
  assert.equal(compared.comparison, 'STRUCTURAL_COMPARISON');
  assert.equal(required(compared.shadowComparison.candidateEligibility[0]).riskFeasible, false);
  const stale = { ...blocked, branches: blocked.branches.map((b) => ({ ...b,
    candidates: b.candidates.map((c) => ({ ...c, unknownEvidence: ['EXECUTION_QUOTE_REQUIRED:QUOTE_STALE'] })) })) };
  assert.equal(buildAdaptiveShadowDecisionReceipt({ frontier: stale, currentDecision: currentDecision() }).comparison, 'NO_COMPARISON');
});

test('adaptive shadow is a comparison receipt with no broker mutation authority', () => {
  const receipt = buildAdaptiveShadowDecisionReceipt({ frontier: frontier(), currentDecision: currentDecision() });
  assert.equal(receipt.currentPolicyDecision.action, 'OPEN_CSP');
  assert.equal(receipt.adaptiveShadowDecision.action, 'NO_COMPARISON');
  assert.equal(receipt.adaptiveShadowDecision.quantity, null);
  assert.equal(receipt.executionAuthorized, false);
  assert.equal(receipt.brokerMutationAllowed, false);
  assert.equal(receipt.comparison, 'NO_COMPARISON');
  assert.deepEqual(receipt.lineage, sovereignDecisionPath);
});

test('a current-policy WAIT is not presented as adaptive agreement without an adaptive policy', () => {
  const receipt = buildAdaptiveShadowDecisionReceipt({
    frontier: frontier(),
    currentDecision: { actionCode: 'GLOBAL_WAIT', selectedCandidateRef: null, quantity: 0, strategyBranch: null },
  });
  assert.equal(receipt.currentPolicyDecision.action, 'GLOBAL_WAIT');
  assert.equal(receipt.adaptiveShadowDecision.action, 'NO_COMPARISON');
  assert.equal(receipt.comparison, 'NO_COMPARISON');
  assert.ok(receipt.adaptiveShadowDecision.reasonCodes.includes('EMPIRICAL_UTILITY_NOT_PROMOTED'));
});

test('strategy registry has five products and THETA_R remains a management route', () => {
  assert.equal(adaptiveStrategyRegistry.length, 5);
  assert.deepEqual(new Set(adaptiveStrategyRegistry.map((entry) => entry.branch)), new Set([
    'THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK', 'THETA_RECOVERY', 'THETA_CC',
  ]));
  assert.equal(adaptiveStrategyRegistry.find((entry) => entry.branch === 'THETA_HOLD_STRIKE')?.executionEnabled, false);
  assert.equal(adaptiveStrategyRegistry.find((entry) => entry.branch === 'THETA_DEFINED_RISK')?.maturity, 'RESEARCH_ONLY');
  assert.equal(thetaRManagementRoute.productStrategy, false);
  assert.equal(thetaRManagementRoute.executionAuthority, false);
});

test('hard, applicability, economics, and uncertainty roles are explicit', () => {
  assert.equal(canonicalEvidencePolicyRoles.FRESH_BROKER_STATE, 'HARD_SAFETY');
  assert.equal(canonicalEvidencePolicyRoles.LIFECYCLE_STATE, 'STRATEGY_APPLICABILITY');
  assert.equal(canonicalEvidencePolicyRoles.VRP, 'ECONOMIC_OBJECTIVE');
  assert.equal(canonicalEvidencePolicyRoles.FLOW, 'UNCERTAINTY_MODIFIER');
  assert.ok(adaptiveBrainLayerOwnership.STATE_AND_RISK_KERNEL.includes('BROKER_ACCOUNT'));
});

test('kernel state prevents unknown-to-zero leakage', () => {
  assert.deepEqual(validateKernelEvidence({ state: 'UNKNOWN', value: null, observedAt: null,
    source: 'OPTIONOMICS', version: 'v1', reason: 'NOT_SUPPLIED' }), []);
  assert.deepEqual(validateKernelEvidence({ state: 'UNKNOWN', value: 0, observedAt: null,
    source: 'OPTIONOMICS', version: 'v1', reason: null }), ['NON_KNOWN_VALUE_MUST_BE_NULL']);
  assert.deepEqual(validateKernelEvidence({ state: 'KNOWN', value: null, observedAt: null,
    source: 'ALPACA', version: 'v1', reason: null }), ['KNOWN_VALUE_MISSING']);
});

test('WAIT diagnostics preserve optional unknowns without converting them into hard rejection', () => {
  const diagnostic = buildWaitParalysisDiagnostic(frontier());
  assert.equal(diagnostic.contractsEnumerated, 1);
  assert.equal(diagnostic.hardSafetyRejected, 0);
  assert.equal(diagnostic.unknownOptionalEvidence, 1);
  assert.equal(diagnostic.ratios.unknownOptionalEvidence, 1);
});

test('WAIT diagnostics never call required quote, AEGIS, event or assignment evidence optional', () => {
  const f = frontier();
  const branch = required(f.branches[0]);
  const candidate = required(branch.candidates[0]);
  const input = { ...f, branches: [{ ...branch, candidates: [{ ...candidate,
    unknownEvidence: ['AEGIS_STATE_UNKNOWN', 'EVENT_STATE_UNKNOWN', 'ASSIGNMENT_CAPACITY_UNKNOWN',
      'EXECUTION_QUOTE_REQUIRED:QUOTE_STALE', 'FLOW_UNKNOWN', 'NEW_UNCLASSIFIED_FIELD_UNKNOWN'],
  }] }] };
  const before = JSON.stringify(input);
  const result = buildWaitParalysisDiagnostic(input);
  assert.equal(result.unknownSafetyBlocked, 1);
  assert.equal(result.unknownOptionalEvidence, 1);
  assert.equal(result.unclassifiedUnknownEvidence, 1);
  assert.equal(result.hardSafetyRejected, 0);
  assert.equal(result.unknownEvidenceReasons.filter((r) => r.role === 'REQUIRED_SAFETY').length, 4);
  assert.ok(result.unknownEvidenceReasons.every((r) => !r.recordedAsHardBlocker));
  assert.equal(JSON.stringify(input), before);
});

test('unknown hard blockers retain authority and unfamiliar fields never default to optional', () => {
  const f = frontier();
  const branch = required(f.branches[0]);
  const candidate = required(branch.candidates[0]);
  const result = buildWaitParalysisDiagnostic({ ...f, branches: [{ ...branch, candidates: [{ ...candidate,
    hardBlockers: ['OCC_IDENTITY_UNKNOWN'], unknownEvidence: ['OCC_IDENTITY_UNKNOWN', 'IV_UNKNOWN'],
  }] }] });
  assert.equal(result.unknownEvidenceReasons.length, 2);
  assert.equal(result.unknownOptionalEvidence, 0);
  assert.equal(result.unknownSafetyBlocked, 1);
  assert.equal(result.unclassifiedUnknownEvidence, 1);
  assert.equal(result.unknownEvidenceReasons.find((r) => r.reason === 'OCC_IDENTITY_UNKNOWN')?.recordedAsHardBlocker, true);
});

test('overtrading metrics preserve denominator definitions and do not invent thresholds', () => {
  const diagnostic = buildOvertradingDiagnostic({ candidateCount: 20, acceptedCount: 2, cycles: 10,
    newRiskActions: 1, capitalInUse: 25_000, accountEquity: 100_000, simultaneousChains: 1,
    correlatedExposure: null, lowConfidenceTrades: 0, executionCost: 3, grossTradedNotional: 5_000 });
  assert.equal(diagnostic.candidateAcceptanceRate, 0.1);
  assert.equal(diagnostic.newRiskFrequency, 0.1);
  assert.equal(diagnostic.capitalUtilization, 0.25);
  assert.equal(diagnostic.turnover, 0.05);
  assert.equal(diagnostic.policyState, 'OBSERVATIONAL_NO_EMPIRICAL_THRESHOLDS');
  assert.equal(fixedVsAdaptiveExperiments.length, 8);
});
