import assert from 'node:assert/strict';
import test from 'node:test';
import { computeManagedEpisodePathFeatures, type PathObservation } from '../src/theta/managed-episode-path-features.js';

test('with no observations, every excursion field is null -- never a fabricated zero', () => {
  const result = computeManagedEpisodePathFeatures([]);
  assert.equal(result.maximumFavorableExcursionDollars, null);
  assert.equal(result.maximumAdverseExcursionDollars, null);
  assert.equal(result.peakProfitFraction, null);
  assert.equal(result.profitGivebackFraction, null);
});

test('MFE/MAE are the actual highest and lowest analytical values observed, not the latest or first', () => {
  const observations: PathObservation[] = [
    { asOf: '2026-09-01T00:00:00.000Z', analyticalValueDollars: 50 },
    { asOf: '2026-09-05T00:00:00.000Z', analyticalValueDollars: 180 }, // MFE
    { asOf: '2026-09-10T00:00:00.000Z', analyticalValueDollars: -30 }, // MAE
    { asOf: '2026-09-12T00:00:00.000Z', analyticalValueDollars: 20 },
  ];
  const result = computeManagedEpisodePathFeatures(observations, 200);
  assert.equal(result.maximumFavorableExcursionDollars, 180);
  assert.equal(result.maximumAdverseExcursionDollars, -30);
});

test('a +60% MFE that has since given back to +8% is captured as evidence, not as an automatic command', () => {
  // No "action" field exists on this interface at all -- it is purely
  // descriptive path evidence.
  const observations: PathObservation[] = [
    { asOf: '2026-09-01T00:00:00.000Z', analyticalValueDollars: 120 }, // +60% of 200 entry
    { asOf: '2026-09-15T00:00:00.000Z', analyticalValueDollars: 16 }, // +8% of 200 entry
  ];
  const result = computeManagedEpisodePathFeatures(observations, 200);
  assert.ok(Math.abs((result.peakProfitFraction ?? 0) - 0.6) < 1e-9);
  // giveback = (120-16)/120
  assert.ok(Math.abs((result.profitGivebackFraction ?? 0) - (104 / 120)) < 1e-9);
  assert.ok(!('action' in result));
  assert.ok(!('recommendedAction' in result));
});

test('without an entryReference, peakProfitFraction stays null but the dollar-denominated MFE/MAE still compute', () => {
  const observations: PathObservation[] = [
    { asOf: '2026-09-01T00:00:00.000Z', analyticalValueDollars: 100 },
    { asOf: '2026-09-05T00:00:00.000Z', analyticalValueDollars: 50 },
  ];
  const result = computeManagedEpisodePathFeatures(observations);
  assert.equal(result.peakProfitFraction, null);
  assert.equal(result.maximumFavorableExcursionDollars, 100);
});

test('profitGivebackFraction stays null when the episode never showed a positive MFE at all', () => {
  const observations: PathObservation[] = [
    { asOf: '2026-09-01T00:00:00.000Z', analyticalValueDollars: -20 },
    { asOf: '2026-09-05T00:00:00.000Z', analyticalValueDollars: -50 },
  ];
  const result = computeManagedEpisodePathFeatures(observations, 200);
  assert.equal(result.profitGivebackFraction, null);
});

test('timeSinceMfeDays/timeSinceMaeDays measure from the extremum observation to the latest one', () => {
  const observations: PathObservation[] = [
    { asOf: '2026-09-01T00:00:00.000Z', analyticalValueDollars: 100 }, // MFE, 11 days before latest
    { asOf: '2026-09-05T00:00:00.000Z', analyticalValueDollars: -20 }, // MAE, 7 days before latest
    { asOf: '2026-09-12T00:00:00.000Z', analyticalValueDollars: 30 },
  ];
  const result = computeManagedEpisodePathFeatures(observations, 200);
  assert.equal(result.timeSinceMfeDays, 11);
  assert.equal(result.timeSinceMaeDays, 7);
});

test('-35% MAE followed by recovery to +10% is captured honestly without any implicit success/failure verdict', () => {
  const observations: PathObservation[] = [
    { asOf: '2026-09-01T00:00:00.000Z', analyticalValueDollars: -70 }, // -35% of 200
    { asOf: '2026-09-10T00:00:00.000Z', analyticalValueDollars: 20 }, // +10% of 200
  ];
  const result = computeManagedEpisodePathFeatures(observations, 200);
  assert.ok(Math.abs((result.maximumAdverseExcursionDollars ?? 0) - -70) < 1e-9);
  assert.ok(!('managementSucceeded' in result));
});
