import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQualifiedSoftFeatureEvidence } from '../src/research/qualified-soft-feature-evidence.js';

const OBSERVED = '2026-09-22T14:00:00Z';

test('builds real evidence for ATM_IV with correct fixed provenance', () => {
  const evidence = buildQualifiedSoftFeatureEvidence({
    featureId: 'ATM_IV', value: 0.32, observedAt: OBSERVED, validThrough: null,
    requestedDate: '2026-09-22', servedDate: '2026-09-22',
  });
  assert.equal(evidence.providerField, 'atm_iv');
  assert.equal(evidence.decisionRole, 'SOFT_RANKER');
  assert.equal(evidence.empiricalStatus, 'EMPIRICALLY_UNPROVEN');
  assert.equal(evidence.qualityState, 'PROVIDER_QUALIFIED');
});

test('a null value is a legitimate outcome, never defaulted, and yields UNKNOWN_PIT', () => {
  const evidence = buildQualifiedSoftFeatureEvidence({
    featureId: 'RV20', value: null, observedAt: OBSERVED, validThrough: null, requestedDate: null, servedDate: null,
  });
  assert.equal(evidence.value, null);
  assert.equal(evidence.pitState, 'UNKNOWN_PIT');
});

test('CORE CLAIM: requested/served date mismatch is PIT_UNSAFE, mirroring the real call-wall PIT-drift finding', () => {
  const evidence = buildQualifiedSoftFeatureEvidence({
    featureId: 'VRP20', value: 0.05, observedAt: OBSERVED, validThrough: null,
    requestedDate: '2018-01-01', servedDate: '2026-09-22',
  });
  assert.equal(evidence.pitState, 'PIT_UNSAFE');
});

test('matched requested/served dates are PIT_SAFE', () => {
  const evidence = buildQualifiedSoftFeatureEvidence({
    featureId: 'RV20', value: 0.18, observedAt: OBSERVED, validThrough: null,
    requestedDate: '2026-09-18', servedDate: '2026-09-18',
  });
  assert.equal(evidence.pitState, 'PIT_SAFE');
});

test('no requested/served date at all (current-session read) is CURRENT_ONLY, distinct from PIT_SAFE', () => {
  const evidence = buildQualifiedSoftFeatureEvidence({
    featureId: 'ATM_IV', value: 0.28, observedAt: OBSERVED, validThrough: null, requestedDate: null, servedDate: null,
  });
  assert.equal(evidence.pitState, 'CURRENT_ONLY');
});

test('ADVERSARIAL: an invalid (non-finite) feature value is rejected, never silently accepted', () => {
  assert.throws(() => buildQualifiedSoftFeatureEvidence({
    featureId: 'ATM_IV', value: Number.NaN, observedAt: OBSERVED, validThrough: null, requestedDate: null, servedDate: null,
  }), /INVALID_FEATURE_VALUE/);
});

test('empiricalStatus can only escalate to SUPPORTED_OOS/REJECTED via explicit caller input, never a default assumption', () => {
  const supported = buildQualifiedSoftFeatureEvidence({
    featureId: 'RV20', value: 0.2, observedAt: OBSERVED, validThrough: null, requestedDate: null, servedDate: null,
    empiricalStatus: 'SUPPORTED_OOS',
  });
  assert.equal(supported.empiricalStatus, 'SUPPORTED_OOS');
  const defaulted = buildQualifiedSoftFeatureEvidence({
    featureId: 'RV20', value: 0.2, observedAt: OBSERVED, validThrough: null, requestedDate: null, servedDate: null,
  });
  assert.equal(defaulted.empiricalStatus, 'EMPIRICALLY_UNPROVEN');
});
