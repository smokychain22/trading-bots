import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapConfidenceInterval, computeFlowIncrementalValueReport, deriveFlowBiasIfSupported, type FlowPrintSemantics,
} from '../src/research/optionomics-flow-analysis-engine.js';

function semantics(overrides: Partial<FlowPrintSemantics> = {}): FlowPrintSemantics {
  return {
    openCloseAmbiguity: 'OPENING', structure: 'SWEEP', size: 500, premium: 250_000, expiry: '2026-10-17',
    strike: 100, volumeToOpenInterestRatio: 2.5, underlyingDirectionAtPrint: 'UP', volatilityRegimeAtPrint: 'LOW',
    dealerExposureContext: null, ...overrides,
  };
}

test('CORE CLAIM: a call with OPENING + UP underlying is BULLISH_CONSISTENT -- never inferred from side alone', () => {
  assert.equal(deriveFlowBiasIfSupported(semantics(), 'CALL'), 'BULLISH_CONSISTENT');
});

test('CORE CLAIM: the SAME call print with AMBIGUOUS open/close is UNKNOWN, never defaulted to bullish', () => {
  assert.equal(deriveFlowBiasIfSupported(semantics({ openCloseAmbiguity: 'AMBIGUOUS' }), 'CALL'), 'UNKNOWN');
});

test('a put with OPENING + DOWN underlying is BEARISH_CONSISTENT', () => {
  assert.equal(deriveFlowBiasIfSupported(semantics({ underlyingDirectionAtPrint: 'DOWN' }), 'PUT'), 'BEARISH_CONSISTENT');
});

test('CORE CLAIM: naive call=bullish is rejected -- a call print with DOWN underlying is UNKNOWN, not forced bullish', () => {
  assert.equal(deriveFlowBiasIfSupported(semantics({ underlyingDirectionAtPrint: 'DOWN' }), 'CALL'), 'UNKNOWN');
});

test('bootstrapConfidenceInterval is deterministic given the same seed', () => {
  const values = [0.01, 0.02, -0.01, 0.03, 0.015, -0.005];
  const a = bootstrapConfidenceInterval(values, 500, 7);
  const b = bootstrapConfidenceInterval(values, 500, 7);
  assert.equal(a.low, b.low);
  assert.equal(a.high, b.high);
});

test('CORE CLAIM: fewer than 2 values yields null CI bounds, never a fabricated interval', () => {
  const result = bootstrapConfidenceInterval([0.01]);
  assert.equal(result.low, null);
  assert.equal(result.high, null);
});

test('computeFlowIncrementalValueReport computes a real incremental value and independentN from paired observations', () => {
  const report = computeFlowIncrementalValueReport({
    baseModelId: 'base', baseModelVersion: 'v1', basePlusFlowModelId: 'base-flow', basePlusFlowModelVersion: 'v1',
    observations: [
      { subjectId: 's1', baseModelNormalizedOutcome: 0.01, basePlusFlowModelNormalizedOutcome: 0.03 },
      { subjectId: 's2', baseModelNormalizedOutcome: 0.02, basePlusFlowModelNormalizedOutcome: 0.02 },
    ],
    evaluatedAt: '2026-09-26T00:00:00Z',
  });
  assert.equal(report.independentN, 2);
  assert.ok(report.incrementalPredictiveValue !== null);
});

test('zero observations yields an honestly un-evaluated report', () => {
  const report = computeFlowIncrementalValueReport({
    baseModelId: 'base', baseModelVersion: 'v1', basePlusFlowModelId: 'base-flow', basePlusFlowModelVersion: 'v1',
    observations: [], evaluatedAt: '2026-09-26T00:00:00Z',
  });
  assert.equal(report.independentN, null);
  assert.equal(report.evaluatedAt, null);
});
