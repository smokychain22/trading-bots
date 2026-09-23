import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessBaselineMaturity, paperBootstrapStressApplicability,
  type BaselineEvidenceCounts, type BaselineSufficiencyPolicy, type CurrentObservationEvidence,
} from '../src/research/aegis-stress-baseline-maturity.js';

const POLICY: BaselineSufficiencyPolicy = {
  policyVersion: 'test-policy-v1', minimumRawN: 100, minimumSessionN: 5,
  minimumDistinctUnderlyingN: 3, minimumTemporalSpanDays: 14, maxCurrentObservationAgeSeconds: 60,
};

const ASOF = '2026-09-22T14:00:00Z';

function evidence(overrides: Partial<BaselineEvidenceCounts> = {}): BaselineEvidenceCounts {
  return { rawN: 0, sessionN: 0, distinctUnderlyingN: 0, effectiveN: null, ...overrides };
}

test('BASELINE_NOT_STARTED when rawN is zero', () => {
  const result = assessBaselineMaturity('IV_SHOCK', ASOF, 'optionomics', 'v1', evidence(), null, null, POLICY, null, false);
  assert.equal(result.state, 'BASELINE_NOT_STARTED');
});

test('Paper cold-start policy applies only to a real accumulating baseline', () => {
  assert.equal(paperBootstrapStressApplicability('BASELINE_ACCUMULATING'), 'PAPER_COLD_START_NOT_APPLICABLE');
  assert.equal(paperBootstrapStressApplicability('BASELINE_NOT_STARTED'), 'REQUIRED');
  assert.equal(paperBootstrapStressApplicability('CURRENT_OBSERVATION_STALE'), 'REQUIRED');
  assert.equal(paperBootstrapStressApplicability('DETECTOR_PROVIDER_LIMITED'), 'REQUIRED');
  assert.equal(paperBootstrapStressApplicability(null), 'REQUIRED');
});

test('BASELINE_ACCUMULATING when below any single policy minimum -- never silently treated as sufficient', () => {
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 50, sessionN: 5, distinctUnderlyingN: 3 }), // rawN below min(100)
    '2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, null, false,
  );
  assert.equal(result.state, 'BASELINE_ACCUMULATING');
  assert.ok(result.reason.includes('rawN'));
});

test('ADVERSARIAL: BASELINE_ACCUMULATING even with sufficient rawN if temporal span is too short (real 3,876/1,696-style single-session evidence)', () => {
  const result = assessBaselineMaturity(
    'SPREAD_WIDENING', ASOF, 'aiven-quote-history', 'v1',
    evidence({ rawN: 3876, sessionN: 1, distinctUnderlyingN: 1696 }),
    '2026-09-21T00:00:00Z', '2026-09-21T23:59:59Z', POLICY, null, false,
  );
  assert.equal(result.state, 'BASELINE_ACCUMULATING');
  assert.ok(result.reason.includes('sessionN') || result.reason.includes('temporalSpanDays'));
});

test('cold-start baseline cannot hide a stale or invalid current observation', () => {
  const accumulatingEvidence = evidence({ rawN: 50, sessionN: 4, distinctUnderlyingN: 2 });
  const stale = assessBaselineMaturity(
    'SPREAD_WIDENING', ASOF, 'alpaca-bbo', 'v1', accumulatingEvidence,
    '2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY,
    { observedAt: '2026-09-22T13:00:00Z', valid: true, invalidReason: null }, false,
  );
  assert.equal(stale.state, 'CURRENT_OBSERVATION_STALE');
  assert.equal(paperBootstrapStressApplicability(stale.state), 'REQUIRED');

  const invalid = assessBaselineMaturity(
    'SPREAD_WIDENING', ASOF, 'alpaca-bbo', 'v1', accumulatingEvidence,
    '2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY,
    { observedAt: ASOF, valid: false, invalidReason: 'INVALID_CURRENT_BBO' }, false,
  );
  assert.equal(invalid.state, 'CURRENT_OBSERVATION_INVALID');
  assert.equal(paperBootstrapStressApplicability(invalid.state), 'REQUIRED');
});

test('BASELINE_SUFFICIENT when every minimum is met and no current observation is supplied', () => {
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, null, false,
  );
  assert.equal(result.state, 'BASELINE_SUFFICIENT');
});

function freshObservation(): CurrentObservationEvidence {
  return { observedAt: '2026-09-22T13:59:30Z', valid: true, invalidReason: null };
}

test('DETECTOR_READY when baseline sufficient AND current observation fresh/valid', () => {
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, freshObservation(), false,
  );
  assert.equal(result.state, 'DETECTOR_READY');
  assert.equal(result.effectiveNPolicyState, 'EFFECTIVE_N_NOT_GOVERNING_POLICY');
});

test('effective N is enforced only when an explicit policy minimum exists', () => {
  const baseline = evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20, effectiveN: 8 });
  const insufficient = assessBaselineMaturity('SPREAD_WIDENING', ASOF, 'alpaca-bbo', 'v1', baseline,
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', { ...POLICY, minimumEffectiveN: 10 }, freshObservation(), false);
  assert.equal(insufficient.state, 'BASELINE_ACCUMULATING');
  assert.equal(insufficient.effectiveNPolicyState, 'EFFECTIVE_N_INSUFFICIENT');
  const ungoverned = assessBaselineMaturity('SPREAD_WIDENING', ASOF, 'alpaca-bbo', 'v1', baseline,
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, freshObservation(), false);
  assert.equal(ungoverned.state, 'DETECTOR_READY');
  assert.equal(ungoverned.effectiveNPolicyState, 'EFFECTIVE_N_NOT_GOVERNING_POLICY');
});

test('CURRENT_OBSERVATION_STALE when the live observation is older than the policy max age', () => {
  const stale: CurrentObservationEvidence = { observedAt: '2026-09-22T13:00:00Z', valid: true, invalidReason: null };
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, stale, false,
  );
  assert.equal(result.state, 'CURRENT_OBSERVATION_STALE');
});

test('REPAIR: CURRENT_OBSERVATION_STALE (never DETECTOR_READY) for a future-dated observation -- a PIT violation must never look fresh', () => {
  const future: CurrentObservationEvidence = { observedAt: '2026-09-22T15:00:00Z', valid: true, invalidReason: null };
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, future, false,
  );
  assert.equal(result.state, 'CURRENT_OBSERVATION_STALE');
});

test('CURRENT_OBSERVATION_INVALID when the live observation is explicitly marked invalid', () => {
  const invalid: CurrentObservationEvidence = { observedAt: ASOF, valid: false, invalidReason: 'CROSSED_BBO' };
  const result = assessBaselineMaturity(
    'SPREAD_WIDENING', ASOF, 'alpaca-bbo', 'v1',
    evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, invalid, false,
  );
  assert.equal(result.state, 'CURRENT_OBSERVATION_INVALID');
  assert.equal(result.reason, 'CROSSED_BBO');
});

test('DETECTOR_PROVIDER_LIMITED takes precedence over every other state, even with real evidence present', () => {
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, freshObservation(), true,
  );
  assert.equal(result.state, 'DETECTOR_PROVIDER_LIMITED');
});

test('no universal threshold invented -- policy minimums are always taken from the caller-supplied policy, never hardcoded', () => {
  const looserPolicy: BaselineSufficiencyPolicy = { ...POLICY, minimumRawN: 10, minimumSessionN: 1, minimumDistinctUnderlyingN: 1, minimumTemporalSpanDays: 0 };
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 50, sessionN: 1, distinctUnderlyingN: 1 }),
    '2026-09-22T00:00:00Z', '2026-09-22T12:00:00Z', looserPolicy, null, false,
  );
  assert.equal(result.state, 'BASELINE_SUFFICIENT'); // same raw evidence that was BASELINE_ACCUMULATING under POLICY is sufficient under a real, different, explicit policy
});

test('future-available historical evidence cannot make the detector ready', () => {
  const result = assessBaselineMaturity(
    'IV_SHOCK', ASOF, 'optionomics', 'v1',
    evidence({ rawN: 500, sessionN: 10, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-23T00:00:00Z', POLICY, freshObservation(), false,
  );
  assert.equal(result.state, 'BASELINE_INVALID');
});

test('malformed counts and policy cannot make the detector ready', () => {
  const result = assessBaselineMaturity(
    'SPREAD_WIDENING', ASOF, 'alpaca-bbo', 'v1',
    evidence({ rawN: 500, sessionN: -1, distinctUnderlyingN: 20 }),
    '2026-08-01T00:00:00Z', '2026-09-20T00:00:00Z', POLICY, freshObservation(), false,
  );
  assert.equal(result.state, 'BASELINE_INVALID');
});
