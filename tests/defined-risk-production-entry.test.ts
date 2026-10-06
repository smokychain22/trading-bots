import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { buildStrategyPaperAuthorityReceipt } from '../src/theta/strategy-paper-authority.js';
import { buildDefinedRiskProductionDecision } from '../src/theta/defined-risk-production-decision.js';
import { testAegisAssessmentIdentity } from './fixtures/aegis-assessment-identity.js';
import { verifyAegisAssessmentIdentity } from '../src/theta/aegis-assessment-identity.js';

const NOW = '2026-09-14T15:00:00.000Z';
const contract = (symbol: string, strike: number, bid: number, ask: number) => normalizeOptionContract({ source: 'ALPACA', underlying: 'AAPL', optionSymbol: symbol, occSymbol: symbol,
  optionType: 'PUT', strike, expiration: '2026-09-25', asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
  bid, ask, bidSize: 20, askSize: 20, lastTradePrice: bid, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 100, volumeSource: 'ALPACA', openInterest: 1000,
  openInterestSource: 'OPTIONOMICS', iv: 0.3, delta: -0.2, gamma: 0.02, theta: -0.1, vega: 0.1, rho: -0.01, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA',
  dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2 }, NOW);
const SHORT = 'AAPL260925P00190000', LONG = 'AAPL260925P00185000';
const route = (eligible: readonly StrategyFamily[]) => parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'd-snap', timestamp: NOW,
  policyVersion: 'router-v1', results: (['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const).map((strategyFamily) => ({ strategyFamily,
    eligible: eligible.includes(strategyFamily), eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'TEST', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })) });
const authority = (strategy: 'THETA_DEFINED_RISK' | 'THETA_HOLD_STRIKE', patch: Record<string, unknown> = {}) => buildStrategyPaperAuthorityReceipt({ strategy, ownerPaperAuthorization: true,
  technicalStrategyCertification: true, idempotencyCertified: true, riskAuthorization: true, currentActionAuthorization: true, brokerCapability: 'SUPPORTED', decisionPlanBound: true,
  reconciliationCertified: true, managementCoverageCertified: true, restartRecoveryCertified: true, wholeChainAccountingCertified: true, strategyCanaryAccepted: false,
  liveAuthorization: false, observedAt: NOW, evidenceIds: ['phase4-d-tests'], ...patch });
const dInput = () => ({ snapshotId: 'd-snap', timestamp: NOW, strategyVersion: 'strategy-v1', contracts: [contract(SHORT, 190, 2.0, 2.1), contract(LONG, 185, 0.8, 0.9)],
  routing: route(['THETA_D']), stock: null, assignmentCapacityQty: 2, buyingPower: 100_000, brokerAllowedQty: 2,
  sizingPolicy: { riskBudgetQtyCap: 2, collateralQtyCap: 2, concentrationQtyCap: 2, assignmentCapacityQtyCap: 2, tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  aegisNewRiskState: 'ALLOW_FULL' as const, eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: {} });

test('D nominator: only from a verified governed D receipt, only after Q did not open and no H decision exists, and only a feasible sized two-leg candidate', () => {
  const structural = buildCanonicalStrategyFrontier(dInput() as Parameters<typeof buildCanonicalStrategyFrontier>[0]);
  const branch = structural.branches.find((item) => item.branch === 'THETA_DEFINED_RISK');
  assert.ok(branch?.candidates.length, 'fixture produces a D candidate');
  const ok = buildDefinedRiskProductionDecision({ structuralFrontier: structural, thetaQDecision: { winningAction: 'PASS' }, holdStrikeDecisionProduced: false, authority: authority('THETA_DEFINED_RISK') });
  assert.ok(branch?.candidates.some((candidate) => candidate.riskFeasible && candidate.sizing.quantity > 0), 'the fixture must produce a feasible, sized D candidate (no vacuous pass)');
  {
    assert.ok(ok);
    assert.equal(ok.branch, 'THETA_DEFINED_RISK');
    assert.equal(`THETA_DEFINED_RISK:${ok.selectedCandidateId}`.split(':').length, 3, 'the decision names both legs');
  }
  assert.equal(buildDefinedRiskProductionDecision({ structuralFrontier: structural, thetaQDecision: { winningAction: 'OPEN_FULL' }, holdStrikeDecisionProduced: false, authority: authority('THETA_DEFINED_RISK') }), null, 'Q opened');
  assert.equal(buildDefinedRiskProductionDecision({ structuralFrontier: structural, holdStrikeDecisionProduced: true, authority: authority('THETA_DEFINED_RISK') }), null, 'H already nominated this cycle');
  assert.equal(buildDefinedRiskProductionDecision({ structuralFrontier: structural, holdStrikeDecisionProduced: false, authority: undefined }), null, 'no receipt');
  assert.equal(buildDefinedRiskProductionDecision({ structuralFrontier: structural, holdStrikeDecisionProduced: false, authority: authority('THETA_HOLD_STRIKE') }), null, 'an H receipt never authorizes D');
  assert.equal(buildDefinedRiskProductionDecision({ structuralFrontier: structural, holdStrikeDecisionProduced: false, authority: authority('THETA_DEFINED_RISK', { brokerCapability: 'UNKNOWN' }) }), null,
    'unverified account mleg entitlement keeps D unauthorized');
});

test('the ONE canonical frontier selects D only through a verified D decision, binding the exact two-leg candidate; a tampered receipt selects nothing', () => {
  const structural = buildCanonicalStrategyFrontier(dInput() as Parameters<typeof buildCanonicalStrategyFrontier>[0]);
  const decision = buildDefinedRiskProductionDecision({ structuralFrontier: structural, thetaQDecision: { winningAction: 'PASS' }, holdStrikeDecisionProduced: false, authority: authority('THETA_DEFINED_RISK') });
  assert.ok(decision, 'no vacuous pass');
  const frontier = buildCanonicalStrategyFrontier({ ...dInput(), paperEntryDecision: decision } as Parameters<typeof buildCanonicalStrategyFrontier>[0]);
  assert.equal(frontier.selectedBranch, 'THETA_DEFINED_RISK');
  assert.equal(frontier.entrySelectionBasis, 'THETA_D_DECISION_BOUND');
  assert.equal(frontier.primaryAction, 'OPEN_DEFINED_RISK');
  assert.equal(frontier.selectedCandidateId, `THETA_DEFINED_RISK:${decision.selectedCandidateId}`);
  assert.equal(frontier.paperEntryAuthorityReceiptHash, decision.strategyPaperAuthority.receiptHash);
  const tampered = buildCanonicalStrategyFrontier({ ...dInput(), paperEntryDecision: { ...decision, strategyPaperAuthority: { ...decision.strategyPaperAuthority, evidenceIds: ['forged'] } } } as Parameters<typeof buildCanonicalStrategyFrontier>[0]);
  assert.equal(tampered.selectedCandidateId, null);
});

test('AEGIS identity is strategy-bound: H/D can never be satisfied by Q\'s per-symbol assessment of the same contract', () => {
  const h = testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_HOLD_STRIKE:${SHORT}`, strategyBranch: 'THETA_HOLD_STRIKE', optionSymbol: SHORT });
  assert.equal(h.assessmentCandidateId, `THETA_HOLD_STRIKE:${SHORT}`);
  assert.ok(verifyAegisAssessmentIdentity(h));
  const d = testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_DEFINED_RISK:${SHORT}:${LONG}`, strategyBranch: 'THETA_DEFINED_RISK', optionSymbol: SHORT });
  assert.ok(verifyAegisAssessmentIdentity(d));
  // an H identity re-labelled onto Q's per-symbol assessment id is rejected
  assert.equal(verifyAegisAssessmentIdentity({ ...h, assessmentCandidateId: SHORT }), null);
  // a D identity whose short leg does not match the named option symbol is rejected
  assert.throws(() => testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_DEFINED_RISK:${LONG}:${SHORT}`, strategyBranch: 'THETA_DEFINED_RISK', optionSymbol: SHORT }), /IDENTITY_MISMATCH/);
  assert.throws(() => testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_DEFINED_RISK:${SHORT}`, strategyBranch: 'THETA_DEFINED_RISK', optionSymbol: SHORT }), /IDENTITY_MISMATCH/);
  // Q is unchanged
  assert.ok(verifyAegisAssessmentIdentity(testAegisAssessmentIdentity({ runtimeCandidateRef: `THETA_CONVENTIONAL:${SHORT}`, optionSymbol: SHORT })));
});
