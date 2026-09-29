import assert from 'node:assert/strict';
import test from 'node:test';
import { persistedTechnicalEvidence } from '../src/theta/postgres-theta-cycle-store.js';

const technical = (overrides: Record<string, unknown> = {}) => ({
  maSlope: 0.002,
  technicalFeatures: {
    contractVersion: 'theta-underlying-technical-features-v1',
    provider: 'ALPACA', operationAlias: 'alpaca.get_stock_bars',
    asOf: '2026-09-25T15:00:00.000Z', providerAsOf: '2026-09-24T04:00:00.000Z',
    retrievedAt: '2026-09-25T15:00:00.000Z', sourceState: 'REAL_PROVIDER',
    dataQuality: 'GOOD', feed: 'iex', adjustment: 'split', barCount: 220,
    values: { trendSlope20d: 0.002, return5d: 0.015, drawdown60d: -0.04,
      realizedVolatility20d: 0.19 },
    methods: { trend: 'NORMALIZED_LINEAR_REGRESSION_SLOPE_20_COMPLETED_DAILY_BARS',
      momentum: 'CLOSE_TO_CLOSE_RETURN_5_COMPLETED_DAILY_BARS' },
    units: { trend: 'NORMALIZED_SLOPE_PER_BAR', momentum: 'DECIMAL_RETURN' },
    ...overrides,
  },
});

test('technical persistence projects real PIT trend, momentum, drawdown, and volatility evidence', () => {
  const evidence = persistedTechnicalEvidence(technical());
  assert.equal(evidence.trend, 0.002);
  assert.equal(evidence.trendStatus, 'AVAILABLE');
  assert.equal(evidence.trendUnit, 'NORMALIZED_SLOPE_PER_BAR');
  assert.equal(evidence.momentum, 0.015);
  assert.equal(evidence.momentumStatus, 'AVAILABLE');
  assert.equal(evidence.momentumUnit, 'DECIMAL_RETURN');
  assert.equal(evidence.drawdown, -0.04);
  assert.equal(evidence.drawdownStatus, 'AVAILABLE');
  assert.equal(evidence.realizedVolatility, 0.19);
  assert.equal(evidence.realizedVolatilityStatus, 'AVAILABLE');
  assert.deepEqual(evidence.source, {
    contractVersion: 'theta-underlying-technical-features-v1', provider: 'ALPACA',
    operationAlias: 'alpaca.get_stock_bars', asOf: '2026-09-25T15:00:00.000Z',
    providerAsOf: '2026-09-24T04:00:00.000Z', retrievedAt: '2026-09-25T15:00:00.000Z',
    sourceState: 'REAL_PROVIDER', dataQuality: 'GOOD', feed: 'iex', adjustment: 'split', barCount: 220,
  });
});

test('technical persistence keeps insufficient history unknown instead of coercing null to zero', () => {
  const evidence = persistedTechnicalEvidence(technical({
    sourceState: 'REAL_PROVIDER_UNKNOWN', dataQuality: 'UNKNOWN', barCount: 3,
    values: { trendSlope20d: null, return5d: null, drawdown60d: -0.01, realizedVolatility20d: null },
  }));
  assert.equal(evidence.trend, null);
  assert.equal(evidence.trendStatus, 'INSUFFICIENT_INPUTS');
  assert.equal(evidence.momentum, null);
  assert.equal(evidence.momentumStatus, 'INSUFFICIENT_INPUTS');
  assert.equal(evidence.drawdown, -0.01);
  assert.equal(evidence.drawdownStatus, 'INSUFFICIENT_INPUTS');
  assert.equal(evidence.realizedVolatility, null);
});

test('technical persistence distinguishes provider failure from missing history', () => {
  const evidence = persistedTechnicalEvidence(technical({
    sourceState: 'REAL_PROVIDER_ERROR', dataQuality: 'DEGRADED', barCount: 0,
    values: { trendSlope20d: null, return5d: null, drawdown60d: null, realizedVolatility20d: null },
  }));
  assert.equal(evidence.trendStatus, 'PROVIDER_ERROR');
  assert.equal(evidence.momentumStatus, 'PROVIDER_ERROR');
  assert.equal(evidence.drawdownStatus, 'PROVIDER_ERROR');
  assert.equal(evidence.realizedVolatilityStatus, 'PROVIDER_ERROR');
});

test('legacy snapshots without the technical receipt stay explicitly source-not-wired', () => {
  const evidence = persistedTechnicalEvidence({ maSlope: 0.002 });
  assert.equal(evidence.regimeState !== null, true);
  assert.equal(evidence.trend, null);
  assert.equal(evidence.trendStatus, 'SOURCE_NOT_WIRED');
  assert.equal(evidence.momentumStatus, 'SOURCE_NOT_WIRED');
  assert.equal(evidence.source, null);
});
