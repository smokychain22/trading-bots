import assert from 'node:assert/strict';
import test from 'node:test';
import { computePairedAblationStatistics, runFilterValueAnalysis, type MatchedAblationPair } from '../src/research/filter-value-analysis-engine.js';
import { ALL_CANONICAL_FEATURE_FAMILIES, type FilterValueVerdict } from '../src/research/filter-value-classification.js';

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

test('CORE CLAIM (closure item 3): the identical generic engine correctly handles LIQUIDITY -- a completely different family, same runFilterValueAnalysis path', () => {
  const pairs = Array.from({ length: 30 }, (_, i) => pair({ pairId: `liq-${i}`, normalizedReturnWithFeature: 0.08, normalizedReturnWithoutFeature: 0.01 }));
  const result = runFilterValueAnalysis({
    family: 'LIQUIDITY', pairs, regimeStratified: true, purgedWalkForwardVersion: 'v1',
    dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
    minimumIndependentN: 10, minimumMeaningfulEffectSize: 0.2,
  });
  assert.equal(result.family, 'LIQUIDITY');
  assert.equal(result.verdict, 'VALUE_SUPPORTED');
});

test('CORE CLAIM (closure item 3): REGIME with insufficient N correctly yields INSUFFICIENT_DATA, same gate logic as every other family', () => {
  const pairs = [pair({ pairId: 'regime-1', normalizedReturnWithFeature: 0.05, normalizedReturnWithoutFeature: 0.01 })];
  const result = runFilterValueAnalysis({
    family: 'REGIME', pairs, regimeStratified: true, purgedWalkForwardVersion: 'v1',
    dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
    minimumIndependentN: 30, minimumMeaningfulEffectSize: 0.2,
  });
  assert.equal(result.family, 'REGIME');
  assert.equal(result.verdict, 'INSUFFICIENT_DATA');
});

test('CORE CLAIM (closure item 3): PORTFOLIO_EXPOSURE with real evidence but no effect correctly yields VALUE_NOT_DEMONSTRATED', () => {
  const pairs = Array.from({ length: 30 }, (_, i) => pair({
    pairId: `pe-${i}`, normalizedReturnWithFeature: 0.05 + (i % 2 === 0 ? 0.01 : -0.01), normalizedReturnWithoutFeature: 0.05,
  }));
  const result = runFilterValueAnalysis({
    family: 'PORTFOLIO_EXPOSURE', pairs, regimeStratified: true, purgedWalkForwardVersion: 'v1',
    dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
    minimumIndependentN: 10, minimumMeaningfulEffectSize: 0.2,
  });
  assert.equal(result.family, 'PORTFOLIO_EXPOSURE');
  assert.equal(result.verdict, 'VALUE_NOT_DEMONSTRATED');
});

const VALID_VERDICTS: ReadonlySet<FilterValueVerdict> = new Set([
  'VALUE_SUPPORTED', 'VALUE_NOT_DEMONSTRATED', 'POSSIBLY_OVERRESTRICTIVE',
  'SAFETY_ONLY_NOT_ALPHA', 'INSUFFICIENT_DATA', 'CONFOUNDED', 'NOT_IDENTIFIABLE',
]);

test('CORE CLAIM (overnight §27): the identical generic engine handles ALL 20 canonical feature families with a consistent contract, not just the 4 spot-checked so far', () => {
  assert.equal(ALL_CANONICAL_FEATURE_FAMILIES.length, 20);
  for (const family of ALL_CANONICAL_FEATURE_FAMILIES) {
    // Same fixture shape for every family -- proves the engine's contract
    // (verdict enum validity, trial registration via dependence/purge
    // metadata, cost-aware flag) is uniform, not a per-family special case.
    const insufficient = runFilterValueAnalysis({
      family, pairs: [pair({ pairId: `${family}-1` })], regimeStratified: true, purgedWalkForwardVersion: 'v1',
      dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
      minimumIndependentN: 30, minimumMeaningfulEffectSize: 0.2,
    });
    assert.equal(insufficient.family, family);
    assert.ok(VALID_VERDICTS.has(insufficient.verdict), `family ${family} produced an invalid verdict: ${insufficient.verdict}`);
    assert.equal(insufficient.verdict, 'INSUFFICIENT_DATA');

    const sufficientPairs = Array.from({ length: 30 }, (_, i) => pair({
      pairId: `${family}-${i}`, normalizedReturnWithFeature: 0.05, normalizedReturnWithoutFeature: 0.02,
    }));
    const sufficient = runFilterValueAnalysis({
      family, pairs: sufficientPairs, regimeStratified: true, purgedWalkForwardVersion: 'v1',
      dependenceGroupingVersion: 'v1', costAware: true, evaluatedAt: '2026-09-26T00:00:00Z',
      minimumIndependentN: 30, minimumMeaningfulEffectSize: 0.2,
    });
    assert.equal(sufficient.family, family);
    assert.ok(VALID_VERDICTS.has(sufficient.verdict), `family ${family} produced an invalid verdict: ${sufficient.verdict}`);
    assert.equal(sufficient.method.dependenceGroupingVersion, 'v1');
    assert.equal(sufficient.method.costAware, true);
  }
});
