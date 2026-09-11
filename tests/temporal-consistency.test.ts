import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTemporalConsistency, DEFAULT_TEMPORAL_CONSISTENCY_POLICIES, type TemporalObservationInput } from '../src/theta/temporal-consistency.js';

const NOW = '2026-09-10T15:00:00.000Z';
const secondsAgo = (s: number): string => new Date(new Date(NOW).getTime() - s * 1000).toISOString();

const observation = (overrides: Partial<TemporalObservationInput> = {}): TemporalObservationInput => ({
  observationClass: 'ACCOUNT', observedAt: NOW, required: true, valuePresent: true,
  providerReachable: true, providerEntitlement: 'ENTITLED',
  ...overrides,
});

test('all fresh, mutually-consistent required observations pass', () => {
  const result = checkTemporalConsistency(
    [observation({ observationClass: 'ACCOUNT', observedAt: secondsAgo(5) }), observation({ observationClass: 'OPTION_QUOTE', observedAt: secondsAgo(2) })],
    NOW,
    DEFAULT_TEMPORAL_CONSISTENCY_POLICIES.NEW_RISK,
  );
  assert.equal(result.ok, true);
});

test('a required observation individually STALE for its own class fails with a precise SYSTEM_HOLD_STALE_<CLASS> reason', () => {
  const result = checkTemporalConsistency(
    [observation({ observationClass: 'OPTION_QUOTE', observedAt: secondsAgo(120) })], // 120s >> OPTION_QUOTE's 60s staleMinAgeSeconds
    NOW,
    DEFAULT_TEMPORAL_CONSISTENCY_POLICIES.NEW_RISK,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'SYSTEM_HOLD_STALE_OPTION_QUOTE');
});

test('individually-fresh observations that disagree in time (skew) fail with SYSTEM_HOLD_DATA_SKEW, never a strategy WAIT/PASS', () => {
  // ACCOUNT is fresh at 20s (well under its 300s stale bound) and
  // OPTION_QUOTE is fresh at 8s (under its own 60s stale bound) -- neither
  // is individually stale, but a 20s vs 8s gap combined with a policy
  // maxSkewSeconds smaller than the observed gap should still fail.
  const result = checkTemporalConsistency(
    [observation({ observationClass: 'ACCOUNT', observedAt: secondsAgo(200) }), observation({ observationClass: 'OPTION_QUOTE', observedAt: secondsAgo(2) })],
    NOW,
    { policyVersion: 'test-strict-skew', freshnessPolicies: { ACCOUNT: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 30, staleMinAgeSeconds: 300 }, OPTION_QUOTE: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 10, staleMinAgeSeconds: 60 } }, maxSkewSeconds: 60 },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'SYSTEM_HOLD_DATA_SKEW');
});

test('a non-required observation never gates or contributes to skew, even when stale or missing', () => {
  const result = checkTemporalConsistency(
    [
      observation({ observationClass: 'ACCOUNT', observedAt: secondsAgo(5), required: true }),
      observation({ observationClass: 'OPTIONOMICS_ANALYTICS', observedAt: null, required: false, valuePresent: false }),
    ],
    NOW,
    DEFAULT_TEMPORAL_CONSISTENCY_POLICIES.NEW_RISK,
  );
  assert.equal(result.ok, true);
});

test('a future-dated observation (observedAt after receivedAt) is never treated as valid -- classified INVALID and fails closed', () => {
  const result = checkTemporalConsistency(
    [observation({ observationClass: 'ACCOUNT', observedAt: new Date(new Date(NOW).getTime() + 60_000).toISOString() })],
    NOW,
    DEFAULT_TEMPORAL_CONSISTENCY_POLICIES.NEW_RISK,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reasonCode, 'SYSTEM_HOLD_STALE_ACCOUNT');
});

test('a required observation with no timestamp at all is excluded from skew but still allows the check to pass if nothing else fails', () => {
  const result = checkTemporalConsistency(
    [observation({ observationClass: 'ACCOUNT', observedAt: null, valuePresent: false })],
    NOW,
    { policyVersion: 'test-no-account-policy', freshnessPolicies: {}, maxSkewSeconds: 60 },
  );
  assert.equal(result.ok, true);
});

test('MANAGEMENT policy is stricter on OPTION_QUOTE than NEW_RISK -- the same 35s-old quote passes NEW_RISK (under its 60s stale bound) but fails MANAGEMENT (over its 30s stale bound)', () => {
  const obs: TemporalObservationInput[] = [observation({ observationClass: 'OPTION_QUOTE', observedAt: secondsAgo(35) })];
  const newRisk = checkTemporalConsistency(obs, NOW, DEFAULT_TEMPORAL_CONSISTENCY_POLICIES.NEW_RISK);
  const management = checkTemporalConsistency(obs, NOW, DEFAULT_TEMPORAL_CONSISTENCY_POLICIES.MANAGEMENT);
  assert.equal(newRisk.ok, true);
  assert.equal(management.ok, false);
});
