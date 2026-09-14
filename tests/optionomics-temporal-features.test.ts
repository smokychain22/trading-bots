import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveOptionomicsTemporalFeatures,
  hashOptionomicsTemporalFeature,
  type OptionomicsFeatureSnapshotReference,
} from '../src/theta/optionomics-temporal-features.js';

const featureValue = (value: number | null, state: 'KNOWN' | 'UNKNOWN' | 'INVALID' = value === null ? 'UNKNOWN' : 'KNOWN') => ({
  state, value, reason: state === 'KNOWN' ? null : `${state}_FIXTURE`, units: 'PROVIDER_REPORTED_UNVERIFIED',
});

const snapshot = (overrides: Partial<OptionomicsFeatureSnapshotReference> = {}): OptionomicsFeatureSnapshotReference => ({
  featureSnapshotId: '11111111-1111-4111-8111-111111111111',
  underlying: 'SPY',
  observedAt: '2026-09-15T14:30:00.000Z',
  schemaVersion: 'theta-optionomics-features-v3',
  featureState: {
    skew: featureValue(0.03),
    termStructure: featureValue(0.02),
    providerContext: { metrics: {
      atmIv: featureValue(0.2), ivRank: featureValue(40), ivPercentile: featureValue(50),
      ivMinusRealizedVolatility20d: featureValue(0.04), impliedVolatilitySkewZScore: featureValue(0.5),
      riskReversal25: featureValue(-0.03), totalGex: featureValue(10), totalDeltaExposure: featureValue(20),
      gammaFlipStrike: featureValue(500), putWall: featureValue(490), callWall: featureValue(510),
    } },
  },
  ...overrides,
});

test('derives only time-ordered point-in-time changes and preserves zero', () => {
  const earlier = snapshot({ observedAt: '2026-09-15T14:00:00.000Z' });
  const current = snapshot({
    featureSnapshotId: '22222222-2222-4222-8222-222222222222',
    featureState: {
      ...snapshot().featureState,
      skew: featureValue(0),
      providerContext: { metrics: {
        ...(snapshot().featureState.providerContext as { metrics: Record<string, unknown> }).metrics,
        ivRank: featureValue(45), totalGex: featureValue(7),
      } },
    },
  });
  const features = deriveOptionomicsTemporalFeatures({ earlier, current, maximumGapSeconds: 3_600 });
  const skew = features.find((feature) => feature.metricKey === 'PUT25_MINUS_CALL25_IV');
  assert.equal(skew?.state, 'KNOWN');
  assert.equal(skew?.currentValue, 0);
  assert.equal(skew?.absoluteChange, -0.03);
  assert.equal(skew?.ratePerHour, -0.06);
  const ivRank = features.find((feature) => feature.metricKey === 'IV_RANK');
  assert.equal(ivRank?.absoluteChange, 5);
  assert.equal(ivRank?.ratePerHour, 10);
  assert.equal(features.every((feature) => feature.executionEligible === false), true);
});

test('keeps missing and invalid observations non-numeric', () => {
  const earlier = snapshot({
    observedAt: '2026-09-15T14:00:00.000Z',
    featureState: { ...snapshot().featureState, skew: featureValue(null, 'UNKNOWN') },
  });
  const current = snapshot({
    featureSnapshotId: '22222222-2222-4222-8222-222222222222',
    featureState: { ...snapshot().featureState, termStructure: featureValue(null, 'INVALID') },
  });
  const features = deriveOptionomicsTemporalFeatures({ earlier, current, maximumGapSeconds: 3_600 });
  const skew = features.find((feature) => feature.family === 'SKEW');
  const term = features.find((feature) => feature.family === 'TERM_STRUCTURE');
  assert.equal(skew?.state, 'UNKNOWN');
  assert.equal(skew?.absoluteChange, null);
  assert.match(skew?.reasonCode ?? '', /^UNKNOWN_INPUT:/);
  assert.equal(term?.state, 'INVALID');
  assert.equal(term?.ratePerHour, null);
  assert.match(term?.reasonCode ?? '', /^INVALID_INPUT:/);
});

test('rejects reversed time, cross-underlying pairs, and invalid gap policy', () => {
  const current = snapshot({ featureSnapshotId: '22222222-2222-4222-8222-222222222222' });
  const reversed = deriveOptionomicsTemporalFeatures({
    earlier: snapshot({ observedAt: '2026-09-15T14:31:00.000Z' }), current, maximumGapSeconds: 3_600,
  });
  assert.equal(reversed.every((feature) => feature.state === 'INVALID' && feature.reasonCode === 'OBSERVATIONS_NOT_STRICTLY_TIME_ORDERED'), true);
  const mismatched = deriveOptionomicsTemporalFeatures({
    earlier: snapshot({ observedAt: '2026-09-15T14:00:00.000Z', underlying: 'QQQ' }), current, maximumGapSeconds: 3_600,
  });
  assert.equal(mismatched.every((feature) => feature.reasonCode === 'UNDERLYING_MISMATCH'), true);
  const invalidPolicy = deriveOptionomicsTemporalFeatures({
    earlier: snapshot({ observedAt: '2026-09-15T14:00:00.000Z' }), current, maximumGapSeconds: 0,
  });
  assert.equal(invalidPolicy.every((feature) => feature.reasonCode === 'MAXIMUM_GAP_INVALID'), true);
});

test('schema mismatch and excessive observation gap remain UNKNOWN', () => {
  const current = snapshot({ featureSnapshotId: '22222222-2222-4222-8222-222222222222' });
  const versionMismatch = deriveOptionomicsTemporalFeatures({
    earlier: snapshot({ observedAt: '2026-09-15T14:00:00.000Z', schemaVersion: 'older' }), current,
    maximumGapSeconds: 3_600,
  });
  assert.equal(versionMismatch.every((feature) => feature.state === 'UNKNOWN' && feature.reasonCode === 'FEATURE_SCHEMA_VERSION_MISMATCH'), true);
  const stale = deriveOptionomicsTemporalFeatures({
    earlier: snapshot({ observedAt: '2026-09-15T12:00:00.000Z' }), current, maximumGapSeconds: 3_600,
  });
  assert.equal(stale.every((feature) => feature.state === 'UNKNOWN' && feature.reasonCode === 'OBSERVATION_GAP_EXCEEDS_POLICY'), true);
});

test('temporal feature hashing is deterministic and value-sensitive', () => {
  const earlier = snapshot({ observedAt: '2026-09-15T14:00:00.000Z' });
  const current = snapshot({ featureSnapshotId: '22222222-2222-4222-8222-222222222222' });
  const feature = deriveOptionomicsTemporalFeatures({ earlier, current, maximumGapSeconds: 3_600 })[0];
  assert.ok(feature);
  assert.equal(hashOptionomicsTemporalFeature(feature), hashOptionomicsTemporalFeature(feature));
  assert.notEqual(hashOptionomicsTemporalFeature(feature), hashOptionomicsTemporalFeature({ ...feature, currentValue: 0.21 }));
});
