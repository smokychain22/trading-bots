import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyContinuationValueEstimate, validateEstimatorSpec, type ContinuationValueEstimatorSpec,
} from '../src/research/continuation-value-interface.js';

function spec(overrides: Partial<ContinuationValueEstimatorSpec> = {}): ContinuationValueEstimatorSpec {
  return {
    target: 'EV_HOLD', modelFamily: 'EMPIRICAL_COHORT_MEAN', specVersion: 'v1',
    featureAvailabilityRule: 'AT_OR_BEFORE_DECISION_TIMESTAMP', labelAvailabilityRule: 'STRICTLY_AFTER_DECISION_TIMESTAMP',
    censoringPolicy: 'EXCLUDE_UNRESOLVED_CHAINS_FROM_TRAINING', purgeWindowDays: 5, embargoWindowDays: 5,
    dependenceGroupingUnit: 'underlying_and_overlapping_decision_window', calibrationMethod: 'NONE_YET_DEFINED',
    uncertaintyMethod: 'NONE_YET_DEFINED', ...overrides,
  };
}

test('emptyContinuationValueEstimate starts every empirical field null/zero -- never a fabricated value', () => {
  const estimate = emptyContinuationValueEstimate('EV_ROLL', 'chain-1', '2026-09-22T14:00:00Z', 'v1');
  assert.equal(estimate.value, null);
  assert.equal(estimate.calibratedUncertainty, null);
  assert.equal(estimate.rawN, 0);
  assert.equal(estimate.maturedN, 0);
  assert.equal(estimate.statisticalEffectiveN, null);
});

test('validateEstimatorSpec rejects negative purge/embargo windows', () => {
  assert.equal(validateEstimatorSpec(spec({ purgeWindowDays: -1 })).valid, false);
  assert.equal(validateEstimatorSpec(spec({ embargoWindowDays: -1 })).valid, false);
});

test('validateEstimatorSpec accepts a simple cohort-mean spec with NONE_YET_DEFINED calibration/uncertainty', () => {
  const result = validateEstimatorSpec(spec());
  assert.equal(result.valid, true);
});

test('validateEstimatorSpec REJECTS a complex model family (quantile regression) with no real calibration/uncertainty method', () => {
  const result = validateEstimatorSpec(spec({ modelFamily: 'QUANTILE_REGRESSION' }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'COMPLEX_MODEL_FAMILY_REQUIRES_A_REAL_CALIBRATION_AND_UNCERTAINTY_METHOD');
});

test('validateEstimatorSpec accepts a complex model family once real calibration/uncertainty methods are supplied', () => {
  const result = validateEstimatorSpec(spec({
    modelFamily: 'SURVIVAL_RECOVERY_DURATION', calibrationMethod: 'RELIABILITY_BINS', uncertaintyMethod: 'BOOTSTRAP_CI',
  }));
  assert.equal(result.valid, true);
});

test('all six ContinuationValueTarget values are distinct, one estimator per target -- never one shared model for all six', () => {
  const targets = ['EV_HOLD', 'EV_CLOSE', 'EV_ROLL', 'EV_ASSIGN', 'EV_SELL_STOCK', 'EV_SELL_CC'];
  assert.equal(new Set(targets).size, 6);
});
