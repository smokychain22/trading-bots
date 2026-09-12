import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparePriority, deterministicJobId, prioritizeDueJobs, dispatchOneJob, dispatchDueJobs,
  type DueJob, type SchedulerEngineConfig, type JobExecutor,
} from '../src/theta/scheduler-engine.js';
import { InMemorySchedulerCheckpointRepository } from '../src/theta/persistence-repositories-memory.js';

const config = (overrides: Partial<SchedulerEngineConfig> = {}): SchedulerEngineConfig => ({
  workerId: 'worker-a', workerVersion: 'v1', policyVersion: 'v1',
  leaseDurationMs: 60_000, maxAttempts: 3,
  ...overrides,
});

const succeed: JobExecutor = async () => ({ status: 'SUCCEEDED', errorCode: null, errorDetail: null, nextRunAt: null });
const fail: JobExecutor = async () => ({ status: 'FAILED', errorCode: 'X', errorDetail: 'boom', nextRunAt: null });

test('deterministic job id is stable for the same (jobType, correlationKey)', () => {
  assert.equal(deterministicJobId('POSITION_MANAGEMENT_SCAN', 'chain-1'), deterministicJobId('POSITION_MANAGEMENT_SCAN', 'chain-1'));
  assert.notEqual(deterministicJobId('POSITION_MANAGEMENT_SCAN', 'chain-1'), deterministicJobId('POSITION_MANAGEMENT_SCAN', 'chain-2'));
});

test('priority ladder applies broker lifecycle before management, then wait-recheck and opportunity scan', () => {
  assert.ok(comparePriority('POSITION_RECONCILIATION', 'ORDER_RECONCILIATION') < 0);
  assert.ok(comparePriority('ORDER_RECONCILIATION', 'POSITION_MANAGEMENT_SCAN') < 0);
  assert.ok(comparePriority('ASSIGNMENT_EXPIRY_RECONCILIATION', 'POSITION_MANAGEMENT_SCAN') < 0);
  assert.ok(comparePriority('ASSIGNMENT_EXPIRY_RECONCILIATION', 'WAIT_RECHECK') < 0);
  assert.ok(comparePriority('ASSIGNMENT_EXPIRY_RECONCILIATION', 'PENDING_ORDER_MANAGEMENT') < 0);
  assert.ok(comparePriority('PENDING_ORDER_MANAGEMENT', 'WAIT_RECHECK') < 0);
  assert.ok(comparePriority('WAIT_RECHECK', 'OPPORTUNITY_SCAN') < 0);
  assert.ok(comparePriority('OPPORTUNITY_SCAN', 'ACCOUNT_STATE_REFRESH') < 0);
});

test('scheduler leases expose acquisition and heartbeat evidence', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const jobId = deterministicJobId('ORDER_RECONCILIATION', 'heartbeat');
  const firstExpiry = new Date(Date.now() + 30_000).toISOString();
  assert.equal(await repo.tryAcquireLease(jobId, 'worker-a', firstExpiry, 'runtime-v1', 'policy-v1'), true);
  const secondExpiry = new Date(Date.now() + 60_000).toISOString();
  assert.equal(await repo.heartbeat(jobId, 'worker-a', secondExpiry), true);
  const record = await repo.findById(jobId);
  assert.equal(record?.leaseExpiresAt, secondExpiry);
  assert.equal(record?.runtimeVersion, 'runtime-v1');
  assert.equal(record?.policyVersion, 'policy-v1');
  assert.equal(record?.leaseAcquiredAt !== null, true);
});

test('failed jobs become retryable only when nextEligibleAt is due', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const jobId = deterministicJobId('ORDER_RECONCILIATION', 'retry-me');
  assert.equal(await repo.tryAcquireLease(jobId, 'worker-a', '2099-09-11T14:10:00.000Z'), true);
  const leased = await repo.findById(jobId);
  assert.ok(leased);
  await repo.save({
    ...leased, status: 'FAILED', resultStatus: 'DEGRADED', completedAt: '2026-09-11T14:00:00.000Z',
    nextEligibleAt: '2026-09-11T14:05:00.000Z', lastError: 'retry later',
  });
  assert.equal((await repo.findRetryableFailures('2026-09-11T14:04:59.000Z')).length, 0);
  assert.equal((await repo.findRetryableFailures('2026-09-11T14:05:00.000Z')).length, 1);
});

test('prioritizeDueJobs reorders a mixed batch into the fixed priority order, stable within a tier', () => {
  const jobs: DueJob[] = [
    { jobType: 'OPPORTUNITY_SCAN', correlationKey: 'a' },
    { jobType: 'POSITION_RECONCILIATION', correlationKey: 'b' },
    { jobType: 'WAIT_RECHECK', correlationKey: 'c' },
    { jobType: 'POSITION_MANAGEMENT_SCAN', correlationKey: 'd' },
  ];
  const ordered = prioritizeDueJobs(jobs);
  assert.deepEqual(ordered.map((j) => j.jobType), [
    'POSITION_RECONCILIATION', 'POSITION_MANAGEMENT_SCAN', 'WAIT_RECHECK', 'OPPORTUNITY_SCAN',
  ]);
});

test('dispatchOneJob runs the executor once a lease is acquired and persists a completed checkpoint', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const outcome = await dispatchOneJob(repo, config(), { jobType: 'OPPORTUNITY_SCAN', correlationKey: 'SPY' }, () => new Date().toISOString(), succeed);
  assert.equal(outcome.outcome, 'RAN');
  assert.equal(outcome.runResult?.status, 'SUCCEEDED');
  const record = await repo.findById(outcome.jobId);
  assert.equal(record?.status, 'COMPLETED');
});

test('a job whose lease is already held by another owner is never run twice -- duplicate-work prevention', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const future = new Date(Date.now() + 300_000).toISOString();
  await repo.tryAcquireLease(deterministicJobId('POSITION_MANAGEMENT_SCAN', 'chain-1'), 'another-worker', future);

  let ran = false;
  const executor: JobExecutor = async () => { ran = true; return { status: 'SUCCEEDED', errorCode: null, errorDetail: null, nextRunAt: null }; };
  const outcome = await dispatchOneJob(repo, config(), { jobType: 'POSITION_MANAGEMENT_SCAN', correlationKey: 'chain-1' }, () => new Date().toISOString(), executor);
  assert.equal(outcome.outcome, 'LEASE_HELD_BY_ANOTHER_OWNER');
  assert.equal(ran, false);
});

test('an executor that throws is recorded as FAILED, never silently swallowed', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const throwing: JobExecutor = async () => { throw new Error('provider unreachable'); };
  const outcome = await dispatchOneJob(repo, config(), { jobType: 'ORDER_RECONCILIATION', correlationKey: 'order-1' }, () => new Date().toISOString(), throwing);
  assert.equal(outcome.runResult?.status, 'FAILED');
  assert.equal(outcome.runResult?.errorDetail, 'provider unreachable');
});

test('a job that keeps failing stops being retried once maxAttempts is exceeded -- bounded retry', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const cfg = config({ maxAttempts: 2 });
  const job: DueJob = { jobType: 'ORDER_RECONCILIATION', correlationKey: 'order-2' };
  await dispatchOneJob(repo, cfg, job, () => new Date().toISOString(), fail);
  await dispatchOneJob(repo, cfg, job, () => new Date().toISOString(), fail);
  const thirdOutcome = await dispatchOneJob(repo, cfg, job, () => new Date().toISOString(), fail);
  assert.equal(thirdOutcome.outcome, 'MAX_ATTEMPTS_EXCEEDED');
});

test('an expired lease runs the executor in reconciliation mode before any retry -- crash recovery', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const jobId = deterministicJobId('ORDER_RECONCILIATION', 'order-3');
  const past = new Date(Date.now() - 60_000).toISOString();
  await repo.tryAcquireLease(jobId, 'crashed-worker', past); // simulates a worker that died mid-execution
  let ran = false;
  let recoveryAction = 'SAFE_TO_RESCHEDULE';
  const executor: JobExecutor = async (_type, _key, _id, recovery) => { ran = true; recoveryAction = recovery; return { status: 'SUCCEEDED', errorCode: null, errorDetail: null, nextRunAt: null }; };
  const outcome = await dispatchOneJob(repo, config(), { jobType: 'ORDER_RECONCILIATION', correlationKey: 'order-3' }, () => new Date().toISOString(), executor);
  assert.equal(outcome.outcome, 'RECOVERY_RECONCILIATION_RAN');
  assert.equal(recoveryAction, 'RECONCILE_BEFORE_RETRY');
  assert.equal(ran, true);
});

test('dispatchDueJobs runs a whole batch in priority order and returns one outcome per job', async () => {
  const repo = new InMemorySchedulerCheckpointRepository();
  const results = await dispatchDueJobs(repo, config(), [
    { jobType: 'OPPORTUNITY_SCAN', correlationKey: 'SPY' },
    { jobType: 'POSITION_RECONCILIATION', correlationKey: 'acct-1' },
  ], () => new Date().toISOString(), succeed);
  assert.equal(results.length, 2);
  assert.equal(results[0].jobType, 'POSITION_RECONCILIATION');
  assert.equal(results[1].jobType, 'OPPORTUNITY_SCAN');
  assert.ok(results.every((r) => r.outcome === 'RAN'));
});
