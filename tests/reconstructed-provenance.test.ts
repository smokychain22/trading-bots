import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNotSilentlyMerged, isEligibleForFactualTraining, observedAtDecisionTime, reconstructedValue,
} from '../src/research/reconstructed-provenance.js';

test('an observed point-in-time value is eligible for factual training', () => {
  const value = observedAtDecisionTime(42, '2026-09-25T00:00:00Z');
  assert.equal(isEligibleForFactualTraining(value), true);
});

test('CORE CLAIM: a RECONSTRUCTED value is never eligible for factual training', () => {
  const value = reconstructedValue(42, 'derived from current-code re-evaluation of a historical replay session');
  assert.equal(isEligibleForFactualTraining(value), false);
});

test('ADVERSARIAL: reconstructing a value without a real note is rejected', () => {
  assert.throws(() => reconstructedValue(42, ''), /PROVENANCE_RECONSTRUCTED_REQUIRES_NOTE/);
});

test('ADVERSARIAL: an observed and a reconstructed value for the same field cannot silently coexist', () => {
  const observed = observedAtDecisionTime(1, '2026-09-25T00:00:00Z');
  const reconstructed = reconstructedValue(2, 'note');
  assert.throws(() => assertNotSilentlyMerged(observed, reconstructed), /PROVENANCE_OBSERVED_AND_RECONSTRUCTED_MUST_NOT_COEXIST/);
});
