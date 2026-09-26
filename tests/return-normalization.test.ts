import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNormalizedReturnSeries, computeNormalizedReturn } from '../src/research/return-normalization.js';

function input(overrides: Partial<Parameters<typeof computeNormalizedReturn>[0]> = {}) {
  return {
    wholeChainId: 'chain-1', strategyFamily: 'THETA_CONVENTIONAL', netPnl: 100,
    capitalAtRisk: 1000, capitalDays: 10, maxLoss: null, collateral: 5000,
    ...overrides,
  };
}

test('CORE CLAIM: a raw/unregistered normalization version is rejected', () => {
  assert.throws(() => computeNormalizedReturn(input(), 'raw-dollar-pnl' as never), /RETURN_NORMALIZATION_UNREGISTERED_VERSION/);
});

test('CORE CLAIM: max-loss normalization is rejected for a strategy that is not defined-risk', () => {
  assert.throws(() => computeNormalizedReturn(input(), 'max-loss-normalized-return-v1'), /RETURN_NORMALIZATION_NOT_APPLICABLE_TO_STRATEGY/);
});

test('D can use max-loss normalization', () => {
  const result = computeNormalizedReturn(input({ strategyFamily: 'THETA_DEFINED_RISK', maxLoss: 500 }), 'max-loss-normalized-return-v1');
  assert.equal(result.normalizedReturn, 0.2);
});

test('CORE CLAIM: a missing denominator yields null, never a fabricated zero', () => {
  const result = computeNormalizedReturn(input({ capitalAtRisk: null }), 'capital-at-risk-return-v1');
  assert.equal(result.normalizedReturn, null);
});

test('capital-day normalization multiplies capitalAtRisk by capitalDays', () => {
  const result = computeNormalizedReturn(input(), 'capital-day-return-v1');
  assert.equal(result.normalizedReturn, 100 / (1000 * 10));
});

test('buildNormalizedReturnSeries reports unresolved rows as a count, never silently drops them unaccounted', () => {
  const rows = [input({ wholeChainId: 'a' }), input({ wholeChainId: 'b', capitalAtRisk: null })];
  const series = buildNormalizedReturnSeries(rows, 'capital-at-risk-return-v1');
  assert.equal(series.series.length, 1);
  assert.equal(series.unresolvedCount, 1);
  assert.deepEqual(series.wholeChainIds, ['a']);
});
