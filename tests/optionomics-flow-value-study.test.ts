import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnevaluatedIncrementalValueReport, isValidMatchedPair, type FlowMatchControls } from '../src/research/optionomics-flow-value-study.js';

function controls(overrides: Partial<FlowMatchControls> = {}): FlowMatchControls {
  return {
    underlying: 'SPY', dte: 30, delta: 0.2, iv: 0.18, rv: 0.15, regime: 'NEUTRAL', trend: 'FLAT',
    eventProximityDays: null, liquidityBucket: 'DEEP', spreadPct: 0.02, timeOfDayBucket: 'MID',
    marketState: 'OPEN', ...overrides,
  };
}

test('CORE CLAIM: an unevaluated report has every incremental-value field null -- no fabricated lift', () => {
  const report = buildUnevaluatedIncrementalValueReport({
    baseModelId: 'base', baseModelVersion: '0.1.0', basePlusFlowModelId: 'base-plus-flow', basePlusFlowModelVersion: '0.1.0',
  });
  assert.equal(report.incrementalPredictiveValue, null);
  assert.equal(report.incrementalCalibrationImprovement, null);
  assert.equal(report.independentN, null);
});

test('a matched pair with identical underlying/DTE/regime and tolerable delta/IV/RV/spread differences is valid', () => {
  const a = controls();
  const b = controls({ delta: 0.21, iv: 0.19, rv: 0.155, spreadPct: 0.021 });
  assert.equal(isValidMatchedPair(a, b, { delta: 0.02, iv: 0.02, rv: 0.02, spreadPct: 0.01 }), true);
});

test('ADVERSARIAL: a different underlying is never a valid matched pair regardless of tolerances', () => {
  const a = controls();
  const b = controls({ underlying: 'QQQ' });
  assert.equal(isValidMatchedPair(a, b, { delta: 1, iv: 1, rv: 1, spreadPct: 1 }), false);
});

test('a different regime is never a valid matched pair -- regime must match exactly', () => {
  const a = controls();
  const b = controls({ regime: 'STRESSED' });
  assert.equal(isValidMatchedPair(a, b, { delta: 1, iv: 1, rv: 1, spreadPct: 1 }), false);
});

test('a delta difference outside tolerance is rejected', () => {
  const a = controls();
  const b = controls({ delta: 0.35 });
  assert.equal(isValidMatchedPair(a, b, { delta: 0.02, iv: 1, rv: 1, spreadPct: 1 }), false);
});
