import assert from 'node:assert/strict';
import test from 'node:test';
import { joinPredictionToOutcome } from '../src/research/prediction-outcome-join.js';
import { buildShadowPredictionReceipt } from '../src/research/shadow-prediction-receipt.js';

const PREDICTION = buildShadowPredictionReceipt({
  predictionId: 'p1', modelId: 'm1', modelVersion: 'v1', targetId: 'ENTRY_PROFITABILITY', entityId: 'c1',
  decisionId: 'd1', featureSnapshotHash: 'h1', predictedAt: '2026-09-25T00:00:00Z', prediction: 0.5,
  uncertainty: null, sourceSha: 'sha1', workerSha: null, strategyScope: 'THETA_CONVENTIONAL',
});

test('a resolved, matching outcome joins successfully', () => {
  const result = joinPredictionToOutcome(PREDICTION, {
    entityId: 'c1', decisionId: 'd1', wholeChainId: 'wc1', targetId: 'ENTRY_PROFITABILITY',
    modelVersionAtOutcomeTime: 'v1', featureSnapshotHash: 'h1', observedOutcome: 1, resolvedAt: '2026-09-26T00:00:00Z', isResolved: true,
  }, '2026-09-26T01:00:00Z');
  assert.equal(result.status, 'JOINED');
  assert.equal(result.outcome, 1);
});

test('an unresolved episode stays PENDING, never joined', () => {
  const result = joinPredictionToOutcome(PREDICTION, {
    entityId: 'c1', decisionId: 'd1', wholeChainId: null, targetId: 'ENTRY_PROFITABILITY',
    modelVersionAtOutcomeTime: 'v1', featureSnapshotHash: 'h1', observedOutcome: null, resolvedAt: null, isResolved: false,
  }, '2026-09-26T01:00:00Z');
  assert.equal(result.status, 'PENDING');
});

test('a resolved episode with no identifiable outcome is CENSORED, not a fabricated value', () => {
  const result = joinPredictionToOutcome(PREDICTION, {
    entityId: 'c1', decisionId: 'd1', wholeChainId: null, targetId: 'ENTRY_PROFITABILITY',
    modelVersionAtOutcomeTime: 'v1', featureSnapshotHash: 'h1', observedOutcome: null, resolvedAt: '2026-09-26T00:00:00Z', isResolved: true,
  }, '2026-09-26T01:00:00Z');
  assert.equal(result.status, 'CENSORED');
});

test('ADVERSARIAL: feature-hash mismatch is rejected', () => {
  assert.throws(() => joinPredictionToOutcome(PREDICTION, {
    entityId: 'c1', decisionId: 'd1', wholeChainId: null, targetId: 'ENTRY_PROFITABILITY',
    modelVersionAtOutcomeTime: 'v1', featureSnapshotHash: 'DIFFERENT', observedOutcome: 1, resolvedAt: '2026-09-26T00:00:00Z', isResolved: true,
  }, '2026-09-26T01:00:00Z'), /JOIN_FEATURE_HASH_MISMATCH/);
});

test('ADVERSARIAL: an outcome resolved before the prediction was made is rejected', () => {
  assert.throws(() => joinPredictionToOutcome(PREDICTION, {
    entityId: 'c1', decisionId: 'd1', wholeChainId: null, targetId: 'ENTRY_PROFITABILITY',
    modelVersionAtOutcomeTime: 'v1', featureSnapshotHash: 'h1', observedOutcome: 1, resolvedAt: '2026-09-24T00:00:00Z', isResolved: true,
  }, '2026-09-26T01:00:00Z'), /JOIN_OUTCOME_RESOLVED_BEFORE_PREDICTION/);
});

test('ADVERSARIAL: the original prediction receipt is never mutated by the join', () => {
  const before = { ...PREDICTION };
  joinPredictionToOutcome(PREDICTION, {
    entityId: 'c1', decisionId: 'd1', wholeChainId: null, targetId: 'ENTRY_PROFITABILITY',
    modelVersionAtOutcomeTime: 'v1', featureSnapshotHash: 'h1', observedOutcome: 1, resolvedAt: '2026-09-26T00:00:00Z', isResolved: true,
  }, '2026-09-26T01:00:00Z');
  assert.deepEqual(PREDICTION, before);
});
