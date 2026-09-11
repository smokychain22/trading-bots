import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCboeRegime,
  computeNearTermVolRatio,
  computePercentile,
  computeZScore,
  type CboeHistoricalObservation,
  type CboeRegimeClassificationPolicy,
} from '../src/theta/cboe-regime-features.js';

const day = (n: number): string => new Date(Date.UTC(2026, 0, n)).toISOString();

test('NearTermVolRatio = VIX9D / VIX', () => {
  assert.equal(computeNearTermVolRatio(18, 20), 0.9);
});

test('NearTermVolRatio is UNKNOWN when either input is missing, never a fabricated ratio', () => {
  assert.equal(computeNearTermVolRatio(null, 20), null);
  assert.equal(computeNearTermVolRatio(18, null), null);
});

test('NearTermVolRatio is UNKNOWN (never Infinity) when VIX is exactly 0', () => {
  assert.equal(computeNearTermVolRatio(18, 0), null);
});

const series: readonly CboeHistoricalObservation[] = [
  { asOfUtc: day(1), value: 12 },
  { asOfUtc: day(2), value: 14 },
  { asOfUtc: day(3), value: 16 },
  { asOfUtc: day(4), value: 18 },
  { asOfUtc: day(5), value: 20 },
];

test('computePercentile: historical timestamp correctness -- only observations at or before asOfUtc count', () => {
  // As of day(3), the eligible prior set is {day1:12, day2:14, day3:16} --
  // days 4 and 5 must never be considered.
  const percentile = computePercentile(series, day(3), 16);
  assert.equal(percentile, 1); // 16 <= 16, and all three prior values are <= 16
});

test('computePercentile derived-feature correctness against a known distribution', () => {
  const percentile = computePercentile(series, day(5), 16);
  // As of day(5), prior set is all 5 values {12,14,16,18,20}; values <= 16: {12,14,16} = 3/5
  assert.equal(percentile, 0.6);
});

test('computePercentile: NO FUTURE LEAKAGE -- identical result whether or not later observations exist in the array', () => {
  const truncated = series.filter((o) => new Date(o.asOfUtc).getTime() <= new Date(day(3)).getTime());
  const withFuture = computePercentile(series, day(3), 15);
  const withoutFuture = computePercentile(truncated, day(3), 15);
  assert.equal(withFuture, withoutFuture);
});

test('computePercentile: a real future value injected into the series is invisible to an earlier asOfUtc', () => {
  const withInjectedFutureSpike: readonly CboeHistoricalObservation[] = [...series, { asOfUtc: day(6), value: 100 }];
  const percentileAsOfDay5 = computePercentile(withInjectedFutureSpike, day(5), 16);
  assert.equal(percentileAsOfDay5, 0.6); // identical to the no-future-spike case above
});

test('computePercentile is UNKNOWN when currentValue is null or there is no prior history', () => {
  assert.equal(computePercentile(series, day(5), null), null);
  assert.equal(computePercentile(series, day(0), 10), null); // asOfUtc before any history exists
});

test('computeZScore derived-feature correctness against a known mean/stddev', () => {
  const flatSeries: readonly CboeHistoricalObservation[] = [
    { asOfUtc: day(1), value: 10 }, { asOfUtc: day(2), value: 10 }, { asOfUtc: day(3), value: 10 }, { asOfUtc: day(4), value: 30 },
  ];
  // mean=15, population stddev = sqrt(((10-15)^2*3 + (30-15)^2)/4) = sqrt((75+225)/4) = sqrt(75) = 8.660...
  const z = computeZScore(flatSeries, day(4), 30);
  assert.ok(z !== null && Math.abs(z - (30 - 15) / Math.sqrt(75)) < 1e-9);
});

test('computeZScore: NO FUTURE LEAKAGE -- a later spike never affects an earlier z-score', () => {
  const zBeforeSpike = computeZScore(series, day(3), 16);
  const seriesWithLaterSpike: readonly CboeHistoricalObservation[] = [...series, { asOfUtc: day(6), value: 1000 }];
  const zBeforeSpikeWithFutureData = computeZScore(seriesWithLaterSpike, day(3), 16);
  assert.equal(zBeforeSpike, zBeforeSpikeWithFutureData);
});

test('computeZScore is UNKNOWN with fewer than 2 prior observations or zero variance, never a fabricated Infinity/0', () => {
  assert.equal(computeZScore(series, day(1), 12), null); // only 1 prior observation
  const constantSeries: readonly CboeHistoricalObservation[] = [{ asOfUtc: day(1), value: 10 }, { asOfUtc: day(2), value: 10 }];
  assert.equal(computeZScore(constantSeries, day(2), 15), null); // stddev = 0
});

test('computeZScore is UNKNOWN when currentValue is null', () => {
  assert.equal(computeZScore(series, day(5), null), null);
});

const classificationPolicy: CboeRegimeClassificationPolicy = {
  policyVersion: 'cboe-regime-classification-v1-test',
  lowStressVixPercentileCeiling: 0.2, elevatedVixPercentileFloor: 0.7, highStressVixPercentileFloor: 0.9,
};

test('classifyCboeRegime: UNKNOWN when percentile is null, never a default state', () => {
  assert.equal(classifyCboeRegime(null, classificationPolicy), 'UNKNOWN');
});

test('classifyCboeRegime: LOW_STRESS / NORMAL / ELEVATED / HIGH_STRESS boundaries follow the SUPPLIED policy, never a hardcoded default', () => {
  assert.equal(classifyCboeRegime(0.1, classificationPolicy), 'LOW_STRESS');
  assert.equal(classifyCboeRegime(0.5, classificationPolicy), 'NORMAL');
  assert.equal(classifyCboeRegime(0.75, classificationPolicy), 'ELEVATED');
  assert.equal(classifyCboeRegime(0.95, classificationPolicy), 'HIGH_STRESS');
});

test('classifyCboeRegime: a differently-configured policy changes the classification of the SAME percentile -- proving no hardcoded threshold exists', () => {
  const permissivePolicy: CboeRegimeClassificationPolicy = { policyVersion: 'permissive-test', lowStressVixPercentileCeiling: 0.65, elevatedVixPercentileFloor: 0.95, highStressVixPercentileFloor: 0.99 };
  assert.equal(classifyCboeRegime(0.6, classificationPolicy), 'NORMAL');
  assert.equal(classifyCboeRegime(0.6, permissivePolicy), 'LOW_STRESS');
});
