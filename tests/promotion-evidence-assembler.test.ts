import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblePromotionEvidence, type PromotionEvidenceInput } from '../src/research/promotion-evidence-assembler.js';
import type { ModelRegistryRecord } from '../src/research/empirical-model-registry.js';
import type { CalibrationEvaluationReceipt } from '../src/research/calibration-evaluation-contract.js';
import type { SelectionBiasReceipt } from '../src/research/selection-bias-receipt.js';

function model(overrides: Partial<ModelRegistryRecord> = {}): ModelRegistryRecord {
  return {
    contractVersion: 'theta-empirical-model-registry-v1', modelId: 'entry-baseline', modelVersion: 'v1',
    targetId: 'ENTRY_PROFITABILITY', strategyScope: ['THETA_CONVENTIONAL'], actionScope: [], featureSetVersion: 'fs-v1',
    datasetId: 'ds-1', datasetHash: 'a'.repeat(64), labelVersion: 'lv-1', codeSha: 'b'.repeat(40),
    trainingWindow: { start: '2026-01-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
    validationWindows: [], finalOosWindow: { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' },
    dependenceGroupingVersion: 'dg-v1', purgeVersion: 'pv-1',
    calibrationMethod: 'PLATT', calibrationArtifactHash: 'd'.repeat(64), costModelVersion: 'cm-v1', hyperparameterSearchId: null,
    numberOfTrials: 3, selectionBiasReceiptId: 'campaign-1',
    metrics: { brierScore: 0.2, logLoss: 0.5, ece: 0.05, independentN: 500 },
    artifactHash: 'c'.repeat(64), createdAt: '2026-09-26T00:00:00Z', promotionState: 'PAPER_CHALLENGER',
    baselineModelId: 'entry-baseline-v0', isBaseline: false,
    ...overrides,
  };
}

function calibration(overrides: Partial<CalibrationEvaluationReceipt> = {}): CalibrationEvaluationReceipt {
  return {
    contractVersion: 'theta-calibration-evaluation-contract-v1', modelId: 'entry-baseline', modelVersion: 'v1',
    dataProvenance: 'REAL_EMPIRICAL_DATA', brierScore: 0.2, logLoss: 0.5, ece: 0.05,
    calibrationSlope: 1.0, calibrationIntercept: 0.0, reliabilityBins: [], n: 500, independentN: 500,
    confidenceIntervalWidth95: 0.05, ...overrides,
  };
}

function selectionBias(overrides: Partial<SelectionBiasReceipt> = {}): SelectionBiasReceipt {
  return {
    contractVersion: 'theta-selection-bias-receipt-v1', researchCampaignId: 'campaign-1',
    returnNormalizationVersion: 'capital-day-return-v1', numberOfTrials: 3, trialIdentities: ['t1', 't2', 't3'],
    dsr: { deflatedSharpeRatio: 0.6, expectedMaxSharpeUnderNull: 0.3, pValue: 0.4 },
    pbo: { probabilityOfBacktestOverfitting: 0.1, numberOfCombinatorialSplits: 6 },
    inputDatasetHash: 'a'.repeat(64), dependencyGroupingVersion: 'dg-v1', codeSha: 'b'.repeat(40),
    createdAt: '2026-09-26T00:00:00Z', ...overrides,
  };
}

function fullInput(overrides: Partial<PromotionEvidenceInput> = {}): PromotionEvidenceInput {
  return {
    model: model(), calibrationReceipt: calibration(), selectionBiasReceipt: selectionBias(),
    pitValidationPassed: true, purgedWalkForwardPassed: true, untouchedOosPassed: true,
    afterCostMetricsPresent: true, tailMetricsPresent: true, executionRealismPresent: true,
    minimumIndependentN: 100, ...overrides,
  };
}

test('CORE CLAIM: a fully complete evidence package is eligibleForReview, with all 11 requirements satisfied', () => {
  const result = assemblePromotionEvidence(fullInput(), '2026-09-26T01:00:00Z');
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.missing.length, 0);
  assert.equal(result.satisfied.length, 11);
});

test('ADVERSARIAL (overnight §40): missing calibration receipt alone makes the whole package NOT eligible -- no partial-credit "mostly ready" state', () => {
  const result = assemblePromotionEvidence(fullInput({ calibrationReceipt: null }), '2026-09-26T01:00:00Z');
  assert.equal(result.eligibleForReview, false);
  assert.ok(result.missing.includes('CALIBRATION_PRESENT'));
});

test('a NON_EMPIRICAL_TEST_DATA calibration receipt never satisfies CALIBRATION_PRESENT', () => {
  const result = assemblePromotionEvidence(fullInput({ calibrationReceipt: calibration({ dataProvenance: 'NON_EMPIRICAL_TEST_DATA' }) }), '2026-09-26T01:00:00Z');
  assert.ok(result.missing.includes('CALIBRATION_PRESENT'));
});

test('independentN below the caller-supplied gate is refused, never rounded up', () => {
  const result = assemblePromotionEvidence(fullInput({ minimumIndependentN: 1000 }), '2026-09-26T01:00:00Z');
  assert.ok(result.missing.includes('INDEPENDENT_N_MEETS_GATE'));
});

test('a model with no finalOosWindow is refused UNTOUCHED_OOS_PASS even if the caller claims it passed', () => {
  const result = assemblePromotionEvidence(fullInput({ model: model({ finalOosWindow: null }) }), '2026-09-26T01:00:00Z');
  assert.ok(result.missing.includes('UNTOUCHED_OOS_PASS'));
});

test('a selectionBiasReceipt whose campaign id does not match the model\'s own selectionBiasReceiptId is refused, never silently trusted', () => {
  const mismatched = selectionBias({ researchCampaignId: 'campaign-DIFFERENT' });
  const result = assemblePromotionEvidence(fullInput({ selectionBiasReceipt: mismatched }), '2026-09-26T01:00:00Z');
  assert.ok(result.missing.includes('SELECTION_BIAS_RECEIPT_PRESENT'));
});

test('CORE CLAIM: this module never mutates promotionState -- its output type has no such field', () => {
  const result = assemblePromotionEvidence(fullInput(), '2026-09-26T01:00:00Z');
  assert.ok(!('promotionState' in result) && !('approved' in result) && !('promoted' in result));
});

test('a cold-start (zero independentN, all booleans false) model produces a fully-missing, honestly-refused package, never a crash', () => {
  const coldStart = fullInput({
    model: model({ metrics: { brierScore: null, logLoss: null, ece: null, independentN: null }, finalOosWindow: null, selectionBiasReceiptId: null }),
    calibrationReceipt: null, selectionBiasReceipt: null,
    pitValidationPassed: false, purgedWalkForwardPassed: false, untouchedOosPassed: false,
    afterCostMetricsPresent: false, tailMetricsPresent: false, executionRealismPresent: false,
  });
  const result = assemblePromotionEvidence(coldStart, '2026-09-26T01:00:00Z');
  assert.equal(result.eligibleForReview, false);
  assert.ok(result.missing.length >= 9);
});
