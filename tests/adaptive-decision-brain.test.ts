import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveBrainLayerOwnership, adaptiveStrategyRegistry, buildAdaptiveShadowDecisionReceipt,
  buildOvertradingDiagnostic, buildWaitParalysisDiagnostic, canonicalEvidencePolicyRoles,
  fixedVsAdaptiveExperiments, sovereignDecisionPath, thetaRManagementRoute, validateKernelEvidence,
} from '../src/theta/adaptive-decision-brain.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';

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

test('adaptive shadow is a comparison receipt with no broker mutation authority', () => {
  const receipt = buildAdaptiveShadowDecisionReceipt({ frontier: frontier(), currentDecision: currentDecision() });
  assert.equal(receipt.currentPolicyDecision.action, 'OPEN_CSP');
  assert.equal(receipt.adaptiveShadowDecision.action, 'WAIT');
  assert.equal(receipt.adaptiveShadowDecision.quantity, 0);
  assert.equal(receipt.executionAuthorized, false);
  assert.equal(receipt.brokerMutationAllowed, false);
  assert.equal(receipt.comparison, 'DIFFERS_RESEARCH_ONLY');
  assert.deepEqual(receipt.lineage, sovereignDecisionPath);
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

test('overtrading metrics preserve denominator definitions and do not invent thresholds', () => {
  const diagnostic = buildOvertradingDiagnostic({ candidateCount: 20, acceptedCount: 2, cycles: 10,
    newRiskActions: 1, capitalInUse: 25_000, accountEquity: 100_000, simultaneousChains: 1,
    correlatedExposure: null, lowConfidenceTrades: 0, executionCost: 3, grossTradedNotional: 5_000 });
  assert.equal(diagnostic.candidateAcceptanceRate, 0.1);
  assert.equal(diagnostic.newRiskFrequency, 0.1);
  assert.equal(diagnostic.capitalUtilization, 0.25);
  assert.equal(diagnostic.turnover, 0.05);
  assert.equal(diagnostic.policyState, 'OBSERVATIONAL_NO_EMPIRICAL_THRESHOLDS');
  assert.equal(fixedVsAdaptiveExperiments.length, 7);
});
