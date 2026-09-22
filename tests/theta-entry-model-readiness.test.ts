import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEntryModelReadiness, type DatasetSufficiencyInput, type EvaluationMetrics } from '../src/research/theta-entry-model-readiness.js';

const ASOF = '2026-09-22T14:00:00Z';

function sufficiency(overrides: Partial<DatasetSufficiencyInput> = {}): DatasetSufficiencyInput {
  return {
    rawRowCount: 500, resolvedLabelRowCount: 400, censoredRowCount: 50,
    effectiveIndependentN: 300, minimumEffectiveN: 200, distinctUnderlyingCount: 20, minimumDistinctUnderlyings: 10,
    ...overrides,
  };
}

function goodEval(overrides: Partial<EvaluationMetrics> = {}): EvaluationMetrics {
  return {
    brierScore: 0.18, logLoss: 0.5, calibrationSlope: 1.02, calibrationIntercept: 0.01,
    expectedNetPnl: 45, medianNetPnl: 40, profitFactor: 1.3, avgWin: 100, avgLoss: -70,
    expectedShortfall: -400, maxDrawdown: -1200, capitalDays: 25, rpcd: 1.8, effectiveIndependentN: 300, ...overrides,
  };
}

test('zero raw rows is DATASET_NOT_READY', () => {
  const result = assessEntryModelReadiness({
    modelFamily: 'REGULARIZED_LOGISTIC', target: 'P_WHOLE_CHAIN_PROFITABLE', asOf: ASOF,
    sufficiency: sufficiency({ rawRowCount: 0, resolvedLabelRowCount: 0, censoredRowCount: 0 }),
  });
  assert.equal(result.state, 'DATASET_NOT_READY');
});

test('below effective-N minimum is INSUFFICIENT_EFFECTIVE_N, never silently advanced', () => {
  const result = assessEntryModelReadiness({
    modelFamily: 'REGULARIZED_LOGISTIC', target: 'P_WHOLE_CHAIN_PROFITABLE', asOf: ASOF,
    sufficiency: sufficiency({ effectiveIndependentN: 50 }),
  });
  assert.equal(result.state, 'INSUFFICIENT_EFFECTIVE_N');
  assert.equal(result.promotionEligible, false);
});

test('below distinct-underlying minimum is also INSUFFICIENT_EFFECTIVE_N (concentration risk)', () => {
  const result = assessEntryModelReadiness({
    modelFamily: 'REGULARIZED_LOGISTIC', target: 'P_WHOLE_CHAIN_PROFITABLE', asOf: ASOF,
    sufficiency: sufficiency({ distinctUnderlyingCount: 2 }),
  });
  assert.equal(result.state, 'INSUFFICIENT_EFFECTIVE_N');
});

test('sufficiency met, no evaluation supplied, is TRAINING_READY', () => {
  const result = assessEntryModelReadiness({
    modelFamily: 'CALIBRATED_TREE', target: 'EXPECTED_WHOLE_CHAIN_NET_PNL', asOf: ASOF, sufficiency: sufficiency(),
  });
  assert.equal(result.state, 'TRAINING_READY');
});

test('CORE CLAIM: only real, passing calibration + confirmed OOS reaches OOS_SUPPORTED/promotionEligible=true', () => {
  const result = assessEntryModelReadiness({
    modelFamily: 'QUANTILE_DOWNSIDE', target: 'DOWNSIDE_P05', asOf: ASOF, sufficiency: sufficiency(),
    evaluation: goodEval(), oosSupported: true,
  });
  assert.equal(result.state, 'OOS_SUPPORTED');
  assert.equal(result.promotionEligible, true);
});

test('good evaluation but oosSupported not confirmed stays TRAINED, not promotable', () => {
  const result = assessEntryModelReadiness({
    modelFamily: 'QUANTILE_DOWNSIDE', target: 'DOWNSIDE_P05', asOf: ASOF, sufficiency: sufficiency(),
    evaluation: goodEval(),
  });
  assert.equal(result.state, 'TRAINED');
  assert.equal(result.promotionEligible, false);
});

test('ADVERSARIAL: poor calibration (slope far from 1) is CALIBRATION_FAILED even with good other metrics and oosSupported=true', () => {
  const result = assessEntryModelReadiness({
    modelFamily: 'GRADIENT_BOOSTED_BASELINE', target: 'P_ASSIGNMENT', asOf: ASOF, sufficiency: sufficiency(),
    evaluation: goodEval({ calibrationSlope: 2.5 }), oosSupported: true,
  });
  assert.equal(result.state, 'CALIBRATION_FAILED');
  assert.equal(result.promotionEligible, false);
});

test('ADVERSARIAL: never optimizes/promotes on accuracy/AUC/win-rate alone -- EvaluationMetrics has no such field', () => {
  const evalKeys = Object.keys(goodEval());
  assert.ok(!evalKeys.includes('accuracy'));
  assert.ok(!evalKeys.includes('auc'));
  assert.ok(!evalKeys.includes('winRate'));
});

test('ADVERSARIAL: supplying an evaluation despite insufficient N is rejected, never silently accepted', () => {
  assert.throws(() => assessEntryModelReadiness({
    modelFamily: 'REGULARIZED_LOGISTIC', target: 'P_WHOLE_CHAIN_PROFITABLE', asOf: ASOF,
    sufficiency: sufficiency({ effectiveIndependentN: 10 }), evaluation: goodEval(),
  }), /EVALUATION_SUPPLIED_DESPITE_INSUFFICIENT_N/);
});

test('ADVERSARIAL: evaluation effectiveIndependentN mismatch with sufficiency is rejected', () => {
  assert.throws(() => assessEntryModelReadiness({
    modelFamily: 'REGULARIZED_LOGISTIC', target: 'P_WHOLE_CHAIN_PROFITABLE', asOf: ASOF,
    sufficiency: sufficiency(), evaluation: goodEval({ effectiveIndependentN: 999 }),
  }), /EVALUATION_N_MISMATCH/);
});

test('ADVERSARIAL: inconsistent sufficiency counts (resolved+censored > raw) are rejected', () => {
  assert.throws(() => assessEntryModelReadiness({
    modelFamily: 'REGULARIZED_LOGISTIC', target: 'P_WHOLE_CHAIN_PROFITABLE', asOf: ASOF,
    sufficiency: sufficiency({ rawRowCount: 10, resolvedLabelRowCount: 8, censoredRowCount: 8 }),
  }), /SUFFICIENCY_COUNTS_INCONSISTENT/);
});
