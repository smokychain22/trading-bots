import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalibrationReceipt, isEligibleForPromotionEvidence } from '../src/research/calibration-evaluation-contract.js';

function baseReceiptInput(overrides: Partial<Parameters<typeof buildCalibrationReceipt>[0]> = {}) {
  return {
    modelId: 'm1', modelVersion: 'v1', dataProvenance: 'REAL_EMPIRICAL_DATA' as const,
    evaluationRowIds: ['e1', 'e2'], fittingRowIds: ['f1', 'f2'],
    brierScore: 0.2, logLoss: 0.5, ece: 0.05, calibrationSlope: 1.0, calibrationIntercept: 0.0,
    reliabilityBins: [], independentN: 2, confidenceIntervalWidth95: 0.1, ...overrides,
  };
}

test('CORE CLAIM: synthetic/fixture calibration data is tagged NON_EMPIRICAL_TEST_DATA and is ineligible for promotion evidence', () => {
  const receipt = buildCalibrationReceipt(baseReceiptInput({ dataProvenance: 'NON_EMPIRICAL_TEST_DATA' }));
  assert.equal(receipt.dataProvenance, 'NON_EMPIRICAL_TEST_DATA');
  assert.equal(isEligibleForPromotionEvidence(receipt), false);
});

test('real empirical data is eligible for promotion evidence', () => {
  const receipt = buildCalibrationReceipt(baseReceiptInput());
  assert.equal(isEligibleForPromotionEvidence(receipt), true);
});

test('ADVERSARIAL: calibration must never be evaluated on the same rows used to fit the calibrator', () => {
  assert.throws(() => buildCalibrationReceipt(baseReceiptInput({ evaluationRowIds: ['f1', 'e2'] })), /CALIBRATION_EVALUATION_OVERLAPS_FITTING_SAMPLE/);
});
