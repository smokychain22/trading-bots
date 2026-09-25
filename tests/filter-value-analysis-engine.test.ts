import assert from 'node:assert/strict';
import test from 'node:test';
import { computePairedAblationStatistics, runFilterValueAnalysis, type MatchedAblationPair } from '../src/research/filter-value-analysis-engine.js';

function pair(overrides: Partial<MatchedAblationPair> = {}): MatchedAblationPair {
  return {
    pairId: 'p1', wholeChainIdWithFeature: 'chain-a', wholeChainIdWithoutFeature: 'chain-b',
    normalizedReturnWithFeature: 0.05, normalizedReturnWithoutFeature: 0.02, ...overrides,
  };
}

test('CORE CLAIM: fewer than 2 pairs yields null statistics, never a fabricated CI', () => {
  const stats = computePairedAblationStatistics([pair()]);
  assert.equal(stats.standardError, null);
  assert.equal(stats.effectSize, null);
});

test('a real, varied sample produces real computed statistics', () => {
  const pairs = [
    pair({ pairId: 'p1', normalizedReturnWithFeature: 0.05, normalizedReturnWithoutFeature: 0.01 }),
    pair({ pairId: 'p2', normalizedReturnWithFeature: 0.04, normalizedReturnWithoutFeature: 0.02 }),
    pair({ pairId: 'p3', normalizedReturnWithFeature: 0.06, normalizedReturnWithoutFeature: 0.00 }),
  ];
  const stats = computePairedAblationStatistics(pairs);
  assert.ok(stats.meanDifference > 0);
  assert.ok(stats.standardError !== null && stats.standardError > 0);
  assert.ok(stats.confidenceIntervalLow !== null);
});

test('CORE CLAIM: insufficient N yields INSUFFICIENT_DATA, never a stronger verdict', () => {
  const result = runFilterValueAnalysis({
    family: 'FLOW', pairs: [pair()], regimeStratified: true, purgedWalkForwardVersion: 'v1',
    dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
    minimumIndependentN: 30, minimumMeaningfulEffectSize: 0.2,
  });
  assert.equal(result.verdict, 'INSUFFICIENT_DATA');
});

test('CORE CLAIM: a non-regime-stratified analysis with enough N is CONFOUNDED, never VALUE_SUPPORTED', () => {
  const pairs = Array.from({ length: 30 }, (_, i) => pair({ pairId: `p${i}`, normalizedReturnWithFeature: 0.05 + i * 0.001, normalizedReturnWithoutFeature: 0.01 }));
  const result = runFilterValueAnalysis({
    family: 'FLOW', pairs, regimeStratified: false, purgedWalkForwardVersion: 'v1',
    dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
    minimumIndependentN: 10, minimumMeaningfulEffectSize: 0.2,
  });
  assert.equal(result.verdict, 'CONFOUNDED');
});

test('a real, regime-stratified, sufficiently-large, meaningfully-separated sample can reach VALUE_SUPPORTED', () => {
  const pairs = Array.from({ length: 30 }, (_, i) => pair({ pairId: `p${i}`, normalizedReturnWithFeature: 0.10, normalizedReturnWithoutFeature: 0.01 }));
  const result = runFilterValueAnalysis({
    family: 'FLOW', pairs, regimeStratified: true, purgedWalkForwardVersion: 'v1',
    dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
    minimumIndependentN: 10, minimumMeaningfulEffectSize: 0.2,
  });
  assert.equal(result.verdict, 'VALUE_SUPPORTED');
  assert.equal(result.independentN, 30);
});
