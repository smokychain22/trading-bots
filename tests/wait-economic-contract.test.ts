import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyWaitRegretMetrics, validateWaitEconomicEvidence, waitAsComparisonCandidate,
  type WaitEconomicEvidence,
} from '../src/research/wait-economic-contract.js';

function evidence(overrides: Partial<WaitEconomicEvidence> = {}): WaitEconomicEvidence {
  return {
    decisionId: 'd1', asOf: '2026-09-22T14:00:00Z', cashPreserved: 19000, capitalDaysAvoided: 570000,
    eventRiskAvoided: true, assignmentBurdenAvoided: null, foregonePremium: 200,
    bestRejectedCandidateId: 'THETA_CONVENTIONAL:AAPL-put', secondBestCandidateId: null,
    futureRealizedCounterfactual: null, futureRealizedCounterfactualProvenance: 'NOT_IDENTIFIABLE',
    ...overrides,
  };
}

test('validateWaitEconomicEvidence rejects a NOT_IDENTIFIABLE provenance carrying a non-null counterfactual value', () => {
  const result = validateWaitEconomicEvidence(evidence({ futureRealizedCounterfactualProvenance: 'NOT_IDENTIFIABLE', futureRealizedCounterfactual: 50 }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NOT_IDENTIFIABLE_PROVENANCE_MUST_NEVER_CARRY_A_NON_NULL_COUNTERFACTUAL_VALUE');
});

test('validateWaitEconomicEvidence rejects an ESTIMABLE provenance with no counterfactual value at all', () => {
  const result = validateWaitEconomicEvidence(evidence({ futureRealizedCounterfactualProvenance: 'ESTIMABLE', futureRealizedCounterfactual: null }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'OBSERVED_OR_ESTIMABLE_PROVENANCE_REQUIRES_A_NON_NULL_COUNTERFACTUAL_VALUE');
});

test('validateWaitEconomicEvidence accepts NOT_IDENTIFIABLE with null, and OBSERVED/ESTIMABLE with a real value', () => {
  assert.equal(validateWaitEconomicEvidence(evidence()).valid, true);
  assert.equal(validateWaitEconomicEvidence(evidence({ futureRealizedCounterfactualProvenance: 'ESTIMABLE', futureRealizedCounterfactual: 75 })).valid, true);
  assert.equal(validateWaitEconomicEvidence(evidence({ futureRealizedCounterfactualProvenance: 'OBSERVED', futureRealizedCounterfactual: 75 })).valid, true);
});

test('emptyWaitRegretMetrics starts every future metric null and sampleSize zero -- never a synthetic populated number', () => {
  const metrics = emptyWaitRegretMetrics('2026-01-01', '2026-12-31');
  assert.equal(metrics.sampleSize, 0);
  assert.equal(metrics.opportunityConversionRate, null);
  assert.equal(metrics.falseRejectRate, null);
  assert.equal(metrics.falseAcceptRate, null);
  assert.equal(metrics.decisionRegret, null);
  assert.equal(metrics.waitRegret, null);
});

test('waitAsComparisonCandidate reports zero (real, known) capital commitment, never null, and null empirical economics', () => {
  const candidate = waitAsComparisonCandidate(evidence());
  assert.equal(candidate.deterministic.action, 'WAIT');
  assert.equal(candidate.deterministic.collateral, 0);
  assert.equal(candidate.deterministic.capitalRequirement, 0);
  assert.equal(candidate.empirical.expectedAfterCostWholeChainPnl, null);
});

test('waitAsComparisonCandidate never carries a futureRealizedCounterfactual across into empirical economics, even when one exists on the source evidence', () => {
  const withEstimate = evidence({ futureRealizedCounterfactualProvenance: 'ESTIMABLE', futureRealizedCounterfactual: 300 });
  const candidate = waitAsComparisonCandidate(withEstimate);
  assert.equal(candidate.empirical.expectedAfterCostWholeChainPnl, null);
});
