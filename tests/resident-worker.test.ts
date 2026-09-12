import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import type { Pool } from 'pg';
import { loadEnvironment, assertAutonomousWorkerConfiguration } from '../src/config/environment.js';
import { ResidentThetaWorker, externalWorkerHostState, verifyPythonRuntime } from '../src/worker/resident-worker.js';
import type { AutonomousRuntimeReport } from '../src/theta/autonomous-runtime.js';
import type { WorkerRegistration, WorkerRuntimeState, WorkerRuntimeStore } from '../src/worker/postgres-worker-runtime-store.js';

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
  const snapshot=worker.snapshot();
  assert.equal(snapshot.status,'DEGRADED');
  assert.equal(snapshot.runtimeState,'DEGRADED');
  assert.equal(snapshot.runningCycle,false);
  assert.equal(snapshot.databaseConfigured,true);
  assert.equal(snapshot.lastCycleStatus,'FAILED');
  assert.equal(snapshot.consecutiveFailures,1);
  assert.equal(snapshot.currentDelayMs,120_000);
  assert.equal(snapshot.executionGate,'LOCKED');
  assert.equal(snapshot.alwaysOnWorker,'NOT_YET_DEPLOYED');
  assert.equal(snapshot.hostState,externalWorkerHostState);
  assert.equal(JSON.stringify(worker.snapshot()).includes('pass'), false);
});

class CaptureRuntimeStore implements WorkerRuntimeStore {
  registrations:WorkerRegistration[]=[]; gaps:Array<{start:string;end:string}>=[]; states:WorkerRuntimeState[]=[];
  constructor(private readonly lease:'ACQUIRED'|'TAKEN_OVER'|'HELD_BY_OTHER'='ACQUIRED',private readonly previous:string|null=null){}
  async register(input:WorkerRegistration){this.registrations.push(input);return this.previous;}
  async acquireLease(){return this.lease;}
  async heartbeat(_workerId:string,_at:string,_expiresAt:string,state:WorkerRuntimeState){this.states.push(state);return true;}
  async cycleStarted(){this.states.push('RECONCILING');}
  async cycleCompleted(){this.states.push('WAITING_FOR_MARKET');}
  async recordResumeGap(_workerId:string,start:string,end:string){this.gaps.push({start,end});return 3;}
  async stop(_workerId:string,_at:string,state:'STOPPING'|'OFFLINE'|'ERROR'){this.states.push(state);}
}

test('worker refuses startup when another primary shadow lease is active',async()=>{
  const store=new CaptureRuntimeStore('HELD_BY_OTHER');
  const env=loadEnvironment({...Object.fromEntries(Object.entries(lockedEnvironment()).map(([key,value])=>[key,String(value)])),
    THETA_WORKER_PORT:'32041'});
  const worker=new ResidentThetaWorker(env,fakePool(),async()=>report(),logger,()=>new Date('2026-09-12T14:00:00Z'),store,
    {workerId:'worker-a',hostId:'host-a',buildSha:'38f1f6e'});
  await assert.rejects(()=>worker.start(),/PRIMARY_SHADOW_WORKER_LEASE_HELD/);
  assert.equal(worker.snapshot().leaseOwned,false);
});

test('startup records an offline gap, runs reconciliation first, and stops cleanly',async()=>{
  const store=new CaptureRuntimeStore('TAKEN_OVER','2026-09-12T13:55:00Z');
  const env=loadEnvironment({...Object.fromEntries(Object.entries(lockedEnvironment()).map(([key,value])=>[key,String(value)])),
    THETA_WORKER_PORT:'32042'});
  const worker=new ResidentThetaWorker(env,fakePool(),async()=>report(),logger,()=>new Date('2026-09-12T14:00:00Z'),store,
    {workerId:'worker-b',hostId:'host-a',buildSha:'38f1f6e'});
  try{
    await worker.start();
    assert.deepEqual(store.gaps,[{start:'2026-09-12T13:55:00Z',end:'2026-09-12T14:00:00.000Z'}]);
    assert.equal(worker.snapshot().lastResumeGap?.missedObservations,3);
    assert.equal(worker.snapshot().leaseOwned,true);
    assert.equal(store.states[0],'RECONCILING');
  }finally{await worker.stop();}
  assert.equal(worker.snapshot().runtimeState,'OFFLINE');
  assert.equal(worker.snapshot().leaseOwned,false);
});

test('Python runtime probe accepts the current Node executable and fails closed for a missing binary', async () => {
  assert.equal(await verifyPythonRuntime(process.execPath), true);
  assert.equal(await verifyPythonRuntime('definitely-not-a-real-python-runtime', 500), false);
});
