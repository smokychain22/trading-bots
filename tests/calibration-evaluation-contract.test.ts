import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCalibrationReceipt, computeBrierScore, computeCalibrationSlopeIntercept, computeEce, computeLogLoss,
  computeReliabilityBins, evaluateCalibrationFromPredictions, isEligibleForPromotionEvidence, type CalibrationEvaluationPair,
} from '../src/research/calibration-evaluation-contract.js';
import { featureVectorFromRow, fitFillBaseline, predictFillProbability } from '../src/research/execution-fill-baseline.js';
import type { FillProbabilityRow } from '../src/research/execution-dataset-contract.js';

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

function pair(rowId: string, predictedProbability: number, observedOutcome: 0 | 1): CalibrationEvaluationPair {
  return { rowId, predictedProbability, observedOutcome };
}

test('CORE CLAIM (closure item 2): computeBrierScore/computeLogLoss are null for zero pairs, never fabricated', () => {
  assert.equal(computeBrierScore([]), null);
  assert.equal(computeLogLoss([]), null);
});

test('a perfectly calibrated set of predictions scores a real, low Brier score', () => {
  const pairs = [pair('a', 0.9, 1), pair('b', 0.1, 0), pair('c', 0.9, 1), pair('d', 0.1, 0)];
  const brier = computeBrierScore(pairs);
  assert.ok(brier !== null && brier < 0.05);
});

test('reliability bins report only real, non-empty bins with real per-bin means', () => {
  const pairs = [pair('a', 0.05, 0), pair('b', 0.95, 1), pair('c', 0.92, 1)];
  const bins = computeReliabilityBins(pairs, 10);
  assert.equal(bins.length, 2); // one low bin, one high bin -- no fabricated empty-bin rows
  const highBin = bins.find((b) => b.binLower >= 0.9);
  assert.equal(highBin?.n, 2);
});

test('computeEce is null when there are no bins, never a fabricated zero', () => {
  assert.equal(computeEce([], 0), null);
});

test('a zero-variance prediction set yields null slope/intercept -- no fabricated regression line', () => {
  const pairs = [pair('a', 0.5, 0), pair('b', 0.5, 1)];
  const result = computeCalibrationSlopeIntercept(pairs);
  assert.equal(result.slope, null);
  assert.equal(result.intercept, null);
});

test('CORE CLAIM (closure item 2): execution-fill-baseline predictions wire directly into a real calibration receipt', () => {
  function row(overrides: Partial<FillProbabilityRow> = {}): FillProbabilityRow {
    return {
      contractVersion: 'theta-execution-dataset-contract-v1', orderIntentId: `o-${Math.random()}`, side: 'SELL', size: 1,
      limitOffsetFromMid: 0.02, quoteAgeSeconds: 5, underlyingLiquidity: 1_000_000, optionOpenInterest: 500,
      optionVolume: 100, timeOfDayBucket: 'MORNING', filled: true, terminalStatus: 'FILLED', ...overrides,
    };
  }
  const trainingRows = Array.from({ length: 40 }, (_, i) => row({ orderIntentId: `train-${i}`, filled: i % 3 !== 0, limitOffsetFromMid: i % 3 !== 0 ? 0.01 : 0.15 }));
  const model = fitFillBaseline(trainingRows);

  const evaluationRows = Array.from({ length: 20 }, (_, i) => row({ orderIntentId: `eval-${i}`, filled: i % 2 === 0, limitOffsetFromMid: i % 2 === 0 ? 0.01 : 0.12 }));
  const evaluationPairs: CalibrationEvaluationPair[] = evaluationRows.map((r) => ({
    rowId: r.orderIntentId, predictedProbability: predictFillProbability(model, featureVectorFromRow(r)),
    observedOutcome: r.filled ? 1 : 0,
  }));

  const receipt = evaluateCalibrationFromPredictions({
    modelId: 'execution-fill-baseline', modelVersion: 'v1', dataProvenance: 'NON_EMPIRICAL_TEST_DATA',
    evaluationPairs, fittingRowIds: trainingRows.map((r) => r.orderIntentId), independentN: evaluationRows.length,
  });
  assert.ok(receipt !== null);
  assert.equal(receipt?.n, 20);
  assert.equal(receipt?.dataProvenance, 'NON_EMPIRICAL_TEST_DATA');
  assert.equal(isEligibleForPromotionEvidence(receipt as NonNullable<typeof receipt>), false);
});

test('evaluateCalibrationFromPredictions still enforces the fitting/evaluation-overlap invariant', () => {
  const pairs = [pair('shared-id', 0.6, 1), pair('e2', 0.4, 0)];
  assert.throws(() => evaluateCalibrationFromPredictions({
    modelId: 'm', modelVersion: 'v1', dataProvenance: 'NON_EMPIRICAL_TEST_DATA',
    evaluationPairs: pairs, fittingRowIds: ['shared-id'], independentN: 2,
  }), /CALIBRATION_EVALUATION_OVERLAPS_FITTING_SAMPLE/);
});
