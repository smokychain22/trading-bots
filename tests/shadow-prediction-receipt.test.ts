import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShadowFailureReceipt, buildShadowPredictionReceipt, recordShadowFailure, type ShadowFailureState } from '../src/research/shadow-prediction-receipt.js';

test('CORE CLAIM: a shadow prediction receipt is structurally brokerAuthority=false and shadowOnly=true', () => {
  const receipt = buildShadowPredictionReceipt({
    predictionId: 'p1', modelId: 'm1', modelVersion: 'v1', targetId: 'ENTRY_PROFITABILITY', entityId: 'c1',
    decisionId: 'd1', featureSnapshotHash: 'h1', predictedAt: '2026-09-25T00:00:00Z', prediction: 0.4,
    uncertainty: 0.1, sourceSha: 'sha1', workerSha: null, strategyScope: 'THETA_CONVENTIONAL',
  });
  assert.equal(receipt.brokerAuthority, false);
  assert.equal(receipt.shadowOnly, true);
});

test('a non-finite prediction is rejected', () => {
  assert.throws(() => buildShadowPredictionReceipt({
    predictionId: 'p2', modelId: 'm1', modelVersion: 'v1', targetId: 'ENTRY_PROFITABILITY', entityId: 'c1',
    decisionId: 'd1', featureSnapshotHash: 'h1', predictedAt: '2026-09-25T00:00:00Z', prediction: NaN,
    uncertainty: null, sourceSha: 'sha1', workerSha: null, strategyScope: 'THETA_CONVENTIONAL',
  }), /SHADOW_PREDICTION_NON_FINITE/);
});

test('CORE CLAIM: every shadow failure state produces a receipt structurally distinct from any canonical decision output -- no field named action/candidate/quantity/aegisState exists', () => {
  const states: readonly ShadowFailureState[] = [
    'SHADOW_UNAVAILABLE', 'SHADOW_MODEL_TIMEOUT', 'SHADOW_FEATURE_MISSING',
    'SHADOW_MODEL_NAN', 'SHADOW_VERSION_MISMATCH', 'SHADOW_UNSUPPORTED_STATE',
  ];
  for (const failureState of states) {
    const receipt = recordShadowFailure({
      failureId: `f-${failureState}`, modelId: 'm1', entityId: 'c1', decisionId: 'd1',
      failureState, observedAt: '2026-09-25T00:00:00Z', detail: 'test',
    });
    assert.equal(receipt.brokerAuthority, false);
    assert.equal(receipt.shadowOnly, true);
    assert.ok(!('action' in receipt));
    assert.ok(!('candidate' in receipt));
    assert.ok(!('quantity' in receipt));
    assert.ok(!('aegisState' in receipt));
    // The failure receipt's own state is never one of the canonical decision
    // output literals -- structurally a different string union entirely.
    assert.ok(!(['WAIT', 'REJECT', '0_EV', 'ALLOW', 'OPEN'] as const).includes(receipt.failureState as never));
  }
});

test('buildShadowFailureReceipt and recordShadowFailure are the same real function, not two divergent implementations', () => {
  const a = buildShadowFailureReceipt({ failureId: 'f1', modelId: 'm1', entityId: 'c1', decisionId: 'd1', failureState: 'SHADOW_UNAVAILABLE', observedAt: '2026-09-25T00:00:00Z', detail: 'x' });
  const b = recordShadowFailure({ failureId: 'f1', modelId: 'm1', entityId: 'c1', decisionId: 'd1', failureState: 'SHADOW_UNAVAILABLE', observedAt: '2026-09-25T00:00:00Z', detail: 'x' });
  assert.deepEqual(a, b);
});
