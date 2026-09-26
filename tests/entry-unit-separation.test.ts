import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDecisionCandidateObservation, buildExecutedEntryEpisode, hasRealExposure,
} from '../src/research/entry-unit-separation.js';

const DECISION_AT = '2026-09-25T14:00:00Z';

test('CORE CLAIM: DecisionCandidateObservation has no field capable of carrying a realized outcome', () => {
  const obs = buildDecisionCandidateObservation({
    candidateId: 'c1', decisionId: 'd1', decisionAt: DECISION_AT, strategyFamily: 'THETA_CONVENTIONAL',
    status: 'SELECTED', featureSnapshotHash: 'h1', sourceSha: 'sha1', workerSha: null,
  });
  assert.ok(!('realizedPnl' in obs));
  assert.ok(!('outcome' in obs));
});

test('CORE CLAIM: submission != fill -- exposure never starts at submittedAt', () => {
  const episode = buildExecutedEntryEpisode({
    executedEntryEpisodeId: 'e1', candidateId: 'c1', orderIntentId: 'oi1',
    lifecycleState: 'SUBMITTED', submittedAt: DECISION_AT, filledQuantity: 0, requestedQuantity: 1, firstFillAt: null,
  });
  assert.equal(episode.exposureStartAt, null);
  assert.equal(hasRealExposure(episode), false);
});

test('a real fill produces a real, later exposureStartAt distinct from submittedAt', () => {
  const fillAt = '2026-09-25T14:00:05Z';
  const episode = buildExecutedEntryEpisode({
    executedEntryEpisodeId: 'e2', candidateId: 'c1', orderIntentId: 'oi1',
    lifecycleState: 'FULLY_FILLED', submittedAt: DECISION_AT, filledQuantity: 1, requestedQuantity: 1, firstFillAt: fillAt,
  });
  assert.equal(episode.exposureStartAt, fillAt);
  assert.equal(hasRealExposure(episode), true);
  assert.equal(episode.terminalAt, fillAt);
});

test('partial fill: real exposure exists, terminal state is not yet reached', () => {
  const fillAt = '2026-09-25T14:00:05Z';
  const episode = buildExecutedEntryEpisode({
    executedEntryEpisodeId: 'e3', candidateId: 'c1', orderIntentId: 'oi1',
    lifecycleState: 'PARTIALLY_FILLED', submittedAt: DECISION_AT, filledQuantity: 1, requestedQuantity: 3, firstFillAt: fillAt,
  });
  assert.equal(hasRealExposure(episode), true);
  assert.equal(episode.terminalAt, null);
});

test('ADVERSARIAL: a claimed fill quantity without a fill timestamp is rejected', () => {
  assert.throws(() => buildExecutedEntryEpisode({
    executedEntryEpisodeId: 'e4', candidateId: 'c1', orderIntentId: 'oi1',
    lifecycleState: 'FULLY_FILLED', submittedAt: DECISION_AT, filledQuantity: 1, requestedQuantity: 1, firstFillAt: null,
  }), /EXECUTED_ENTRY_FILL_WITHOUT_FILL_TIMESTAMP/);
});

test('ADVERSARIAL: a fill timestamp before submission is rejected', () => {
  assert.throws(() => buildExecutedEntryEpisode({
    executedEntryEpisodeId: 'e5', candidateId: 'c1', orderIntentId: 'oi1',
    lifecycleState: 'FULLY_FILLED', submittedAt: DECISION_AT, filledQuantity: 1, requestedQuantity: 1, firstFillAt: '2026-09-25T13:59:00Z',
  }), /EXECUTED_ENTRY_FILL_BEFORE_SUBMISSION/);
});
