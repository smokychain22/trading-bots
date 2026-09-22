import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagedEpisodeOutcomeDistribution } from '../src/research/managed-episode-outcome-distribution.js';

const ASOF = '2026-09-22T14:00:00Z';

function base(overrides: Partial<Parameters<typeof buildManagedEpisodeOutcomeDistribution>[0]> = {}) {
  return {
    episodeId: 'ep-1', asOf: ASOF, censoredEpisode: false, outOfDomain: false,
    effectiveIndependentN: 100, minimumEffectiveN: 30, featureSchemaVersion: 'v1', modelVersion: 'v1',
    trainingStart: null, trainingEnd: null, sourceDatasetHash: null, ...overrides,
  };
}

test('CORE CLAIM: a censored (still-open) episode reports CENSORED for every outcome field, never a guessed final number', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base({ censoredEpisode: true }));
  assert.equal(result.expectedNetPnl.state, 'CENSORED');
  assert.equal(result.expectedNetPnl.value, null);
  assert.equal(result.pAssignment.state, 'CENSORED');
  assert.equal(result.maeDistribution.median.state, 'CENSORED');
});

test('insufficient effective N produces INSUFFICIENT_DATA, not a computed-but-untrustworthy number', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base({ effectiveIndependentN: 5, minimumEffectiveN: 30 }));
  assert.equal(result.expectedNetPnl.state, 'INSUFFICIENT_DATA');
  assert.equal(result.calibrationState, 'NOT_APPLICABLE');
});

test('an out-of-domain feature state reports OUT_OF_DOMAIN across every field', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base({ outOfDomain: true }));
  assert.equal(result.expectedCapitalDays.state, 'OUT_OF_DOMAIN');
  assert.equal(result.recoveryDurationDistribution.mean.state, 'OUT_OF_DOMAIN');
});

test('with no realValues supplied and no gating, every field is honestly EMPIRICALLY_UNPROVEN, never zero', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base());
  assert.equal(result.expectedNetPnl.state, 'EMPIRICALLY_UNPROVEN');
  assert.equal(result.expectedNetPnl.value, null);
  assert.notEqual(result.expectedNetPnl.value, 0);
  assert.equal(result.downside.p05.state, 'EMPIRICALLY_UNPROVEN');
});

test('a real supplied value is KNOWN, not degraded to EMPIRICALLY_UNPROVEN', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base({
    realValues: { expectedNetPnl: 125.5, pProfit: 0.62 },
  }));
  assert.equal(result.expectedNetPnl.state, 'KNOWN');
  assert.equal(result.expectedNetPnl.value, 125.5);
  assert.equal(result.pProfit.state, 'KNOWN');
  assert.equal(result.pProfit.value, 0.62);
});

test('ADVERSARIAL: null-safe serialization -- every unresolved field has value=null, never undefined or NaN', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base());
  const json = JSON.parse(JSON.stringify(result));
  assert.equal(json.expectedNetPnl.value, null);
  assert.equal(Number.isNaN(json.expectedNetPnl.value), false);
});

test('ADVERSARIAL: no future-outcome leakage -- a KNOWN value can only come from explicit realValues input, never inferred', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base({ realValues: { expectedNetPnl: 100 } }));
  // pAssignment was NOT supplied -- must remain unproven, not silently derived from expectedNetPnl.
  assert.equal(result.pAssignment.state, 'EMPIRICALLY_UNPROVEN');
  assert.equal(result.pAssignment.value, null);
});

test('ADVERSARIAL: invalid asOf is rejected', () => {
  assert.throws(() => buildManagedEpisodeOutcomeDistribution(base({ asOf: 'not-a-date' })), /INVALID_ASOF/);
});

test('ADVERSARIAL: a non-finite real value is rejected, never silently accepted', () => {
  assert.throws(() => buildManagedEpisodeOutcomeDistribution(base({ realValues: { expectedNetPnl: Number.NaN } })), /INVALID_REAL_VALUE/);
});

test('censored takes precedence over out-of-domain when both are true, reported consistently', () => {
  const result = buildManagedEpisodeOutcomeDistribution(base({ censoredEpisode: true, outOfDomain: true }));
  assert.equal(result.expectedNetPnl.state, 'CENSORED');
});
