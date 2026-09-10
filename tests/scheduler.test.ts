import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidJobTransition,
  completeJob,
  InvalidJobTransitionError,
  isValidJobTransition,
  restartRecoveryAction,
  type JobRecord,
} from '../src/theta/scheduler.js';

const baseJob = (overrides: Partial<JobRecord> = {}): JobRecord => ({
  jobId: 'job-1',
  jobType: 'OPPORTUNITY_SCAN',
  scheduledAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  status: 'SCHEDULED',
  attemptCount: 1,
  policyVersion: 'v1',
  workerVersion: 'v1',
  correlationId: 'corr-1',
  errorCode: null,
  errorDetail: null,
  nextRunAt: null,
  ...overrides,
});

test('the happy path SCHEDULED -> RUNNING -> SUCCEEDED is valid', () => {
  assertValidJobTransition('SCHEDULED', 'RUNNING');
  assertValidJobTransition('RUNNING', 'SUCCEEDED');
});

test('FAILED and DEGRADED may be rescheduled', () => {
  assert.equal(isValidJobTransition('FAILED', 'SCHEDULED'), true);
  assert.equal(isValidJobTransition('DEGRADED', 'SCHEDULED'), true);
});

test('QUARANTINED has no automatic outgoing transition', () => {
  assert.equal(isValidJobTransition('QUARANTINED', 'SCHEDULED'), false);
  assert.throws(() => assertValidJobTransition('QUARANTINED', 'SCHEDULED'), InvalidJobTransitionError);
});

test('terminal states SUCCEEDED and SKIPPED have no outgoing transitions', () => {
  assert.equal(isValidJobTransition('SUCCEEDED', 'SCHEDULED'), false);
  assert.equal(isValidJobTransition('SKIPPED', 'RUNNING'), false);
});

test('a RUNNING job found at restart requires reconciliation before retry', () => {
  assert.equal(restartRecoveryAction('RUNNING'), 'RECONCILE_BEFORE_RETRY');
});

test('every other status is safe to reschedule directly', () => {
  for (const status of ['SCHEDULED', 'SUCCEEDED', 'DEGRADED', 'FAILED', 'SKIPPED', 'QUARANTINED'] as const) {
    assert.equal(restartRecoveryAction(status), 'SAFE_TO_RESCHEDULE');
  }
});

test('completeJob validates the transition and records the outcome', () => {
  const running = { ...baseJob(), status: 'RUNNING' as const };
  const finishedAt = new Date().toISOString();
  const completed = completeJob(running, { status: 'SUCCEEDED', errorCode: null, errorDetail: null, nextRunAt: null }, finishedAt);
  assert.equal(completed.status, 'SUCCEEDED');
  assert.equal(completed.finishedAt, finishedAt);
});

test('completeJob throws rather than recording an invalid outcome', () => {
  const scheduled = baseJob(); // status: SCHEDULED
  assert.throws(() =>
    completeJob(scheduled, { status: 'SUCCEEDED', errorCode: null, errorDetail: null, nextRunAt: null }, new Date().toISOString()),
  );
});
