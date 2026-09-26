import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSevereDrawdownLabel } from '../src/research/severe-drawdown-label-contract.js';

const THRESHOLD = { thresholdVersion: 'v1', severeDrawdownFraction: 0.5 };

test('CORE CLAIM: a resolved chain with no breach is FACTUAL_NEGATIVE, never censored', () => {
  const result = buildSevereDrawdownLabel({ wholeChainId: 'c1', threshold: THRESHOLD, peakAdverseExcursionFraction: 0.2, isResolved: true });
  assert.equal(result.label, 'FACTUAL_NEGATIVE');
});

test('a resolved chain with a breach is FACTUAL_POSITIVE', () => {
  const result = buildSevereDrawdownLabel({ wholeChainId: 'c2', threshold: THRESHOLD, peakAdverseExcursionFraction: 0.7, isResolved: true });
  assert.equal(result.label, 'FACTUAL_POSITIVE');
});

test('an open chain is RIGHT_CENSORED regardless of its interim path', () => {
  const result = buildSevereDrawdownLabel({ wholeChainId: 'c3', threshold: THRESHOLD, peakAdverseExcursionFraction: 0.9, isResolved: false });
  assert.equal(result.label, 'RIGHT_CENSORED');
});

test('a resolved chain with no path evidence at all is censored, not fabricated negative', () => {
  const result = buildSevereDrawdownLabel({ wholeChainId: 'c4', threshold: THRESHOLD, peakAdverseExcursionFraction: null, isResolved: true });
  assert.equal(result.label, 'RIGHT_CENSORED');
});

test('the threshold is a versioned research parameter, never hardcoded inside this module', () => {
  const looser = buildSevereDrawdownLabel({ wholeChainId: 'c5', threshold: { thresholdVersion: 'v2', severeDrawdownFraction: 0.9 }, peakAdverseExcursionFraction: 0.7, isResolved: true });
  assert.equal(looser.label, 'FACTUAL_NEGATIVE');
  assert.equal(looser.thresholdVersion, 'v2');
});
