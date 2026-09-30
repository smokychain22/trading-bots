import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { createPromotedManagementPolicyProvider, validateExplicitPromotion } from '../src/theta/promoted-management-policy-provider.js';
import {
  assessEmpiricalPolicyPromotion,
  empiricalPolicyPromotionContractVersion,
} from '../src/theta/empirical-policy-promotion.js';

function receipt() {
  return {
    contractVersion: empiricalPolicyPromotionContractVersion,
    policyKind: 'MANAGEMENT', policyVersion: 'challenger-v1',
    datasetVersion: 'theta-r6-dataset-v5', datasetHash: 'a'.repeat(64),
    featureSetVersion: 'theta-profit-preservation-v1', strategyVersions: ['theta-conventional-v1'],
    labelResolverVersion:'theta-outcome-resolution-v1',executionModelVersion:'theta-market-mark-v1',
    trainWindow: { start: '2025-01-01T00:00:00.000Z', end: '2025-06-01T00:00:00.000Z' },
    validationWindow: { start: '2025-06-08T00:00:00.000Z', end: '2025-09-01T00:00:00.000Z' },
    outOfSampleWindow: { start: '2025-09-08T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' },
    embargoDays: 7,
    metrics: {
      effectiveIndependentN: 100, managedEpisodeWinRate: 0.6, wholeChainWinRate: 0.55,
      afterCostExpectedValue: 12, profitFactor: 1.4, averageWin: 50, averageLoss: -35,
      maxDrawdown: -500, expectedShortfall: -80, capitalDays: 25_000, brierScore: 0.2,
      realizedSlippage: 3, deflatedSharpeRatio: 0.8, probabilityOfBacktestOverfitting: 0.2,
      returnOnSecuredCapital:0.08,annualizedCapitalReturn:0.12,
    },
    acceptanceCriteriaVersion: 'research-acceptance-v1',
    acceptanceCriteria: [{ id: 'positive-ev', description: 'After-cost EV passes the versioned threshold',
      passed: true, evidenceReference: 'experiment:1' }],
    executionEvidence: 'PROVEN', approval: 'APPROVED',approvalIdentity:'owner-governance',
    approvalTimestamp:'2026-01-02T00:00:00.000Z',
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

test('promotion rejects impossible metrics, empty samples and duplicate criteria', () => {
  const input = receipt();
  for (const metrics of [{...input.metrics, managedEpisodeWinRate: 50}, {...input.metrics, probabilityOfBacktestOverfitting: -1},
    {...input.metrics, effectiveIndependentN: 0}, {...input.metrics, capitalDays: 0}, {...input.metrics, averageLoss: 5}]) {
    assert.equal(assessEmpiricalPolicyPromotion({...input, metrics}).readyForHumanPromotionReview, false);
  }
  assert.equal(assessEmpiricalPolicyPromotion({...input, acceptanceCriteria: [...input.acceptanceCriteria, ...input.acceptanceCriteria]}).readyForHumanPromotionReview, false);
  assert.equal(assessEmpiricalPolicyPromotion({...input, approvalIdentity: ' '}).readyForHumanPromotionReview, false);
});

function artifact() {
  const promotion = {state:'PROMOTED' as const, policyVersion:receipt().policyVersion, datasetHash:receipt().datasetHash,
    approvedBy:'owner-governance',approvedAt:'2026-01-03T00:00:00.000Z',governanceVersion:'fixture-v1',
    receiptHash:createHash('sha256').update(canonicalJson(receipt())).digest('hex')};
  return {receipt: structuredClone(receipt()), promotion:{...promotion,contentHash:createHash('sha256').update(JSON.stringify(promotion)).digest('hex')}};
}

test('explicit promotion binds the complete reviewed receipt and rejects malformed approval metadata', () => {
  assert.deepEqual(validateExplicitPromotion(artifact()), []);
  const changed = artifact();
  assert.ok(validateExplicitPromotion({...changed,receipt:{...changed.receipt,metrics:{...changed.receipt.metrics,afterCostExpectedValue:99}}}).includes('PROMOTION_RECEIPT_HASH_MISMATCH'));
  for (const override of [{approvedAt:'invalid'},{approvedBy:' '},{governanceVersion:''}]) {
    const altered = {...changed,promotion:{...changed.promotion,...override}};
    assert.ok(validateExplicitPromotion(altered).includes('PROMOTION_APPROVAL_IDENTITY_INVALID'));
  }
});

test('management promotion pins input and gives each evaluator an isolated reviewed artifact', async () => {
  const input = artifact();
  const seen: string[] = [];
  const provider = createPromotedManagementPolicyProvider(input, async (_state, approved) => {
    seen.push(approved.promotion.approvedBy);
    Object.assign(approved.promotion, {approvedBy:'evaluator-change'});
    return null;
  });
  assert.ok(provider);
  input.promotion.approvedBy = 'caller-change';
  await provider.evaluate({} as never);
  await provider.evaluate({} as never);
  assert.deepEqual(seen,['owner-governance','owner-governance']);
});
