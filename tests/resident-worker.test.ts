import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import type { Pool } from 'pg';
import { loadEnvironment, assertAutonomousWorkerConfiguration } from '../src/config/environment.js';
import { ResidentThetaWorker, externalWorkerHostState, verifyPythonRuntime } from '../src/worker/resident-worker.js';
import type { AutonomousRuntimeReport } from '../src/theta/autonomous-runtime.js';

const lockedEnvironment = () => loadEnvironment({
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  PAPER_COPY_TOKEN_ENCRYPTION_KEY: 'test-only-encryption-key', THETA_AUTONOMOUS_WORKER_ENABLED: 'true',
  MASTER_PAPER_EXECUTION_ENABLED: 'false', FOLLOWER_PAPER_EXECUTION_ENABLED: 'false',
  PAPER_PAUSE_NEW_ORDERS: 'true', THETA_WORKER_PORT: '3001', THETA_WORKER_INTERVAL_MS: '60000',
  THETA_PYTHON_EXECUTABLE: process.execPath,
});

const report = (status: AutonomousRuntimeReport['status'] = 'SUCCEEDED'): AutonomousRuntimeReport => ({
  correlationId: 'theta-runtime:2026-09-12T00:00', status,
  runtimeVersion: 'test-runtime', policyVersion: 'test-policy', jobsAttempted: 1, jobsCompleted: 1,
  jobResults: [], reconciliation: null, executionGate: 'LOCKED', masterPaperOrdersSubmitted: 0,
  followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
});

const fakePool = () => ({ query: async () => ({ rows: [{ '?column?': 1 }] }), end: async () => undefined }) as unknown as Pool;
const logger = pino({ level: 'silent' });

test('worker configuration rejects every order-unlock combination', () => {
  assert.doesNotThrow(() => assertAutonomousWorkerConfiguration(lockedEnvironment()));
  for (const override of [
    { PAPER_PAUSE_NEW_ORDERS: 'false' },
    { MASTER_PAPER_EXECUTION_ENABLED: 'true' },
    { FOLLOWER_PAPER_EXECUTION_ENABLED: 'true' },
  ]) {
    assert.throws(() => assertAutonomousWorkerConfiguration(loadEnvironment({
      ...Object.fromEntries(Object.entries(lockedEnvironment()).map(([key, value]) => [key, String(value)])),
      ...override,
    })), /FIRST_PAPER_ORDER_BOUNDARY_NOT_LOCKED/);
  }
});

test('worker skips an overlapping trigger and never runs two cycles concurrently', async () => {
  let resolveCycle: ((value: AutonomousRuntimeReport) => void) | null = null;
  let invocations = 0;
  const runner = async () => {
    invocations += 1;
    return new Promise<AutonomousRuntimeReport>((resolve) => { resolveCycle = resolve; });
  };
  const worker = new ResidentThetaWorker(lockedEnvironment(), fakePool(), runner, logger);
  const first = worker.runOnce();
  assert.equal(worker.snapshot().runningCycle, true);
  assert.equal(await worker.runOnce(), null);
  assert.equal(invocations, 1);
  const finish = resolveCycle as unknown as (value: AutonomousRuntimeReport) => void;
  finish(report());
  assert.equal((await first)?.status, 'SUCCEEDED');
  assert.equal(worker.snapshot().status, 'READY');
  assert.equal(worker.snapshot().runningCycle, false);
});

test('worker health is sanitized and records degraded cycle state', async () => {
  const worker = new ResidentThetaWorker(lockedEnvironment(), fakePool(), async () => report('FAILED'), logger);
  await worker.runOnce();
  assert.deepEqual(worker.snapshot(), {
    status: 'DEGRADED', runningCycle: false, pythonReady: false, databaseConfigured: true,
    lastCycleStartedAt: worker.snapshot().lastCycleStartedAt,
    lastCycleCompletedAt: worker.snapshot().lastCycleCompletedAt,
    lastCycleStatus: 'FAILED', consecutiveFailures: 1, executionGate: 'LOCKED',
    alwaysOnWorker: 'NOT_YET_DEPLOYED', hostState: externalWorkerHostState,
  });
  assert.equal(JSON.stringify(worker.snapshot()).includes('pass'), false);
});

test('Python runtime probe accepts the current Node executable and fails closed for a missing binary', async () => {
  assert.equal(await verifyPythonRuntime(process.execPath), true);
  assert.equal(await verifyPythonRuntime('definitely-not-a-real-python-runtime', 500), false);
});
