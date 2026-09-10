import assert from 'node:assert/strict';
import test from 'node:test';
import { positionManagementScanIntervalMs, waitRecheckTrigger } from '../src/theta/scheduling-policy.js';

test('WAIT_PRICE requires a reference price and builds a PRICE_THRESHOLD trigger', () => {
  const trigger = waitRecheckTrigger('WAIT_PRICE', { referencePrice: 100, priceThresholdPct: 0.02, volatilityThresholdPct: 0.1 });
  assert.equal(trigger.kind, 'PRICE_THRESHOLD');
});

test('WAIT_PRICE without a reference price throws rather than guessing', () => {
  assert.throws(() => waitRecheckTrigger('WAIT_PRICE', { priceThresholdPct: 0.02, volatilityThresholdPct: 0.1 }));
});

test('WAIT_VOL requires a reference RV', () => {
  const trigger = waitRecheckTrigger('WAIT_VOL', { referenceRv: 0.2, priceThresholdPct: 0.02, volatilityThresholdPct: 0.1 });
  assert.equal(trigger.kind, 'VOLATILITY_CHANGE');
  assert.throws(() => waitRecheckTrigger('WAIT_VOL', { priceThresholdPct: 0.02, volatilityThresholdPct: 0.1 }));
});

test('WAIT_LIQUIDITY requires a reference spread', () => {
  const trigger = waitRecheckTrigger('WAIT_LIQUIDITY', { referenceSpreadPct: 0.05, priceThresholdPct: 0.02, volatilityThresholdPct: 0.1 });
  assert.equal(trigger.kind, 'LIQUIDITY_IMPROVEMENT');
});

test('WAIT_EVENT requires a lockout expiry', () => {
  const trigger = waitRecheckTrigger('WAIT_EVENT', {
    lockoutExpiresAt: new Date().toISOString(), priceThresholdPct: 0.02, volatilityThresholdPct: 0.1,
  });
  assert.equal(trigger.kind, 'EVENT_LOCKOUT_EXPIRY');
});

test('WAIT_REGIME requires a next scheduled refresh', () => {
  const trigger = waitRecheckTrigger('WAIT_REGIME', {
    nextScheduledRefreshAt: new Date().toISOString(), priceThresholdPct: 0.02, volatilityThresholdPct: 0.1,
  });
  assert.equal(trigger.kind, 'REGIME_TRANSITION_OR_SCHEDULED');
});

const baseFactors = {
  dte: 30, gammaExposure: 0.1, distanceToStrikePct: 0.1, eventProximityDays: null, assignmentProbability: null,
};

test('low-urgency position scans at the base 30-minute interval', () => {
  assert.equal(positionManagementScanIntervalMs(baseFactors), 30 * 60 * 1000);
});

test('short DTE increases scan frequency (shorter interval)', () => {
  const normal = positionManagementScanIntervalMs(baseFactors);
  const shortDte = positionManagementScanIntervalMs({ ...baseFactors, dte: 3 });
  assert.ok(shortDte < normal);
});

test('multiple simultaneous risk factors compound to increase frequency further', () => {
  const oneFactorUrgent = positionManagementScanIntervalMs({ ...baseFactors, dte: 3 });
  const allFactorsUrgent = positionManagementScanIntervalMs({
    dte: 3, gammaExposure: 0.9, distanceToStrikePct: 0.01, eventProximityDays: 1, assignmentProbability: 0.8,
  });
  assert.ok(allFactorsUrgent < oneFactorUrgent);
});

test('interval never goes below the one-minute floor regardless of urgency', () => {
  const extreme = positionManagementScanIntervalMs({
    dte: 0, gammaExposure: 10, distanceToStrikePct: 0, eventProximityDays: 0, assignmentProbability: 1,
  });
  assert.ok(extreme >= 60 * 1000);
});
