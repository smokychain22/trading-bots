import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessEmpiricalPolicyPromotion,
  empiricalPolicyPromotionContractVersion,
} from '../src/theta/empirical-policy-promotion.js';

function receipt() {
  return {
    contractVersion: empiricalPolicyPromotionContractVersion,
    policyKind: 'MANAGEMENT', policyVersion: 'challenger-v1',
    datasetVersion: 'theta-r6-dataset-v2', datasetHash: 'a'.repeat(64),
    featureSetVersion: 'theta-profit-preservation-v1', strategyVersions: ['theta-conventional-v1'],
    trainWindow: { start: '2025-01-01T00:00:00.000Z', end: '2025-06-01T00:00:00.000Z' },
    validationWindow: { start: '2025-06-08T00:00:00.000Z', end: '2025-09-01T00:00:00.000Z' },
    outOfSampleWindow: { start: '2025-09-08T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' },
    embargoDays: 7,
    metrics: {
      effectiveIndependentN: 100, managedEpisodeWinRate: 0.6, wholeChainWinRate: 0.55,
      afterCostExpectedValue: 12, profitFactor: 1.4, averageWin: 50, averageLoss: -35,
      maxDrawdown: -500, expectedShortfall: -80, capitalDays: 25_000, brierScore: 0.2,
      realizedSlippage: 3, deflatedSharpeRatio: null, probabilityOfBacktestOverfitting: null,
    },
    acceptanceCriteriaVersion: 'research-acceptance-v1',
    acceptanceCriteria: [{ id: 'positive-ev', description: 'After-cost EV passes the versioned threshold',
      passed: true, evidenceReference: 'experiment:1' }],
    executionEvidence: 'PROVEN', approval: 'APPROVED',
  } as const;
}

test('complete evidence can become review-ready but never self-promotes or authorizes execution', () => {
  const assessment = assessEmpiricalPolicyPromotion(receipt());
  assert.equal(assessment.readyForHumanPromotionReview, true);
  assert.equal(assessment.promoted, false);
  assert.equal(assessment.executionAuthorized, false);
});

test('missing economics and execution evidence fail closed', () => {
  const input = receipt();
  const assessment = assessEmpiricalPolicyPromotion({
    ...input,
    metrics: { ...input.metrics, afterCostExpectedValue: null },
    executionEvidence: 'NOT_PROVEN',
    approval: 'NOT_REQUESTED',
  });
  assert.equal(assessment.readyForHumanPromotionReview, false);
  assert.ok(assessment.blockers.includes('METRIC_AFTERCOSTEXPECTEDVALUE_UNKNOWN'));
  assert.ok(assessment.blockers.includes('EXECUTION_EVIDENCE_NOT_PROVEN'));
  assert.ok(assessment.blockers.includes('HUMAN_APPROVAL_NOT_GRANTED'));
  assert.equal(assessment.executionAuthorized, false);
});

test('overlapping evidence windows fail the point-in-time promotion boundary', () => {
  const input = receipt();
  const assessment = assessEmpiricalPolicyPromotion({
    ...input,
    validationWindow: { start: '2025-06-01T00:00:00.000Z', end: '2025-09-01T00:00:00.000Z' },
  });
  assert.equal(assessment.readyForHumanPromotionReview, false);
  assert.ok(assessment.blockers.includes('TRAIN_VALIDATION_EMBARGO_FAILED'));
});
