import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_CANONICAL_FEATURE_FAMILIES, buildInitialFilterValueRegistry, insufficientDataClassification,
  recordFilterValueClassification,
} from '../src/research/filter-value-classification.js';

test('CORE CLAIM: all 20 canonical feature families default to INSUFFICIENT_DATA, no exceptions', () => {
  const registry = buildInitialFilterValueRegistry();
  assert.equal(registry.size, 20);
  for (const family of ALL_CANONICAL_FEATURE_FAMILIES) {
    assert.equal(registry.get(family)?.verdict, 'INSUFFICIENT_DATA');
  }
});

test('an INSUFFICIENT_DATA classification carries no fabricated numeric evidence', () => {
  const c = insufficientDataClassification('FLOW');
  assert.equal(c.independentN, null);
  assert.equal(c.effectSize, null);
  assert.equal(c.evaluatedAt, null);
});

test('ADVERSARIAL (directive anti-pattern): a naive comparison with no paired ablation/matched sample cannot produce VALUE_NOT_DEMONSTRATED', () => {
  assert.throws(() => recordFilterValueClassification({
    family: 'TREND', verdict: 'VALUE_NOT_DEMONSTRATED', independentN: 100, effectSize: 0.01,
    confidenceIntervalLow: -0.1, confidenceIntervalHigh: 0.1,
    method: { pairedAblationUsed: false, matchedSamplesUsed: false, regimeStratified: false, purgedWalkForwardVersion: null, dependenceGroupingVersion: null, costAware: false },
    evaluatedAt: '2026-09-26T00:00:00Z', notes: null,
  }), /FILTER_VALUE_NAIVE_ANALYSIS_REJECTED/);
});

test('a real paired-ablation, purged-walk-forward analysis with real evidence can record VALUE_SUPPORTED', () => {
  const result = recordFilterValueClassification({
    family: 'LIQUIDITY', verdict: 'VALUE_SUPPORTED', independentN: 42, effectSize: 0.15,
    confidenceIntervalLow: 0.05, confidenceIntervalHigh: 0.25,
    method: { pairedAblationUsed: true, matchedSamplesUsed: false, regimeStratified: true, purgedWalkForwardVersion: 'pwf-v1', dependenceGroupingVersion: 'dg-v1', costAware: true },
    evaluatedAt: '2026-09-26T00:00:00Z', notes: 'Real ablation.',
  });
  assert.equal(result.verdict, 'VALUE_SUPPORTED');
});

test('CONFOUNDED and NOT_IDENTIFIABLE do not require the real-method gate (they are honest non-conclusions)', () => {
  const result = recordFilterValueClassification({
    family: 'SECTOR', verdict: 'CONFOUNDED', independentN: null, effectSize: null,
    confidenceIntervalLow: null, confidenceIntervalHigh: null,
    method: { pairedAblationUsed: false, matchedSamplesUsed: false, regimeStratified: false, purgedWalkForwardVersion: null, dependenceGroupingVersion: null, costAware: false },
    evaluatedAt: null, notes: 'Confounded with correlation family.',
  });
  assert.equal(result.verdict, 'CONFOUNDED');
});
