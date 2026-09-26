import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimObservationJob, deferObservationJob, observationJobDue, resolveObservationJob,
  type ObservationJobStateRecord,
} from '../src/research/observation-job-state.js';

const pending: ObservationJobStateRecord = {
  state: 'PENDING', targetAt: '2026-09-25T15:00:00Z', attempts: 0,
  lastAttemptAt: null, claimExpiresAt: null, resolvedAt: null, reasonCode: null,
};

test('pending job becomes due, is claimed once, and preserves its real attempt time', () => {
  const due = observationJobDue(pending, '2026-09-25T15:00:01Z');
  assert.equal(due.state, 'DUE');
  const claimed = claimObservationJob(due, '2026-09-25T15:17:00Z', 60);
  assert.equal(claimed.state, 'IN_PROGRESS');
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.lastAttemptAt, '2026-09-25T15:17:00.000Z');
  assert.equal(claimed.claimExpiresAt, '2026-09-25T15:18:00.000Z');
});

test('restart recovers only an expired claim and never duplicates an active claim', () => {
  const claimed = claimObservationJob(observationJobDue(pending, '2026-09-25T15:00:00Z'),
    '2026-09-25T15:00:00Z', 60);
  assert.equal(observationJobDue(claimed, '2026-09-25T15:00:30Z').state, 'IN_PROGRESS');
  const recovered = observationJobDue(claimed, '2026-09-25T15:01:00Z');
  assert.equal(recovered.state, 'DUE');
  assert.equal(recovered.reasonCode, 'RESTART_RECOVERED_EXPIRED_CLAIM');
  assert.equal(claimObservationJob(recovered, '2026-09-25T15:01:00Z', 60).attempts, 2);
});

test('provider and market deferrals remain retryable typed states', () => {
  const claimed = claimObservationJob(observationJobDue(pending, '2026-09-25T15:00:00Z'),
    '2026-09-25T15:00:00Z', 60);
  const provider = deferObservationJob(claimed, 'DEFERRED_PROVIDER', '2026-09-25T15:00:01Z', 'ALPACA_503');
  assert.equal(provider.state, 'DEFERRED_PROVIDER');
  assert.equal(observationJobDue(provider, '2026-09-25T15:00:02Z').state, 'DUE');
  const marketClaim = claimObservationJob(observationJobDue(provider, '2026-09-25T15:00:02Z'),
    '2026-09-25T15:00:02Z', 60);
  assert.equal(deferObservationJob(marketClaim, 'DEFERRED_MARKET', '2026-09-25T15:00:03Z',
    'MARKET_CLOSED').state, 'DEFERRED_MARKET');
});

test('resolved jobs are immutable to the state machine and cannot be backdated', () => {
  const claimed = claimObservationJob(observationJobDue(pending, '2026-09-25T15:00:00Z'),
    '2026-09-25T15:00:00Z', 60);
  assert.throws(() => resolveObservationJob(claimed, 'OBSERVED', '2026-09-25T14:59:59Z', null),
    /RESOLVED_BEFORE_TARGET/);
  const observed = resolveObservationJob(claimed, 'OBSERVED', '2026-09-25T15:00:10Z', null);
  assert.equal(observed.state, 'OBSERVED');
  assert.equal(observationJobDue(observed, '2026-09-25T16:00:00Z'), observed);
  assert.throws(() => claimObservationJob(observed, '2026-09-25T16:00:00Z', 60), /NOT_DUE:OBSERVED/);
});

test('non-observed terminal states require an explicit sanitized reason', () => {
  const claimed = claimObservationJob(observationJobDue(pending, '2026-09-25T15:00:00Z'),
    '2026-09-25T15:00:00Z', 60);
  assert.throws(() => resolveObservationJob(claimed, 'MISSED', '2026-09-25T15:01:00Z', null),
    /TERMINAL_REASON_REQUIRED/);
  assert.equal(resolveObservationJob(claimed, 'MISSED', '2026-09-25T15:01:00Z',
    'NO_PIT_QUOTE_AVAILABLE').reasonCode, 'NO_PIT_QUOTE_AVAILABLE');
});
