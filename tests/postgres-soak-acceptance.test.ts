import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { thetaSoakFreshPhysicalConnectionTimeoutMillis,
  thetaSoakPoolWaitTimeoutMillis } from '../src/theta/postgres-connection-characterization.js';
import { classifyPostgresSoakWait, evaluatePostgresSoakAcceptance,
  type PostgresSoakAcceptanceInput, type PostgresSoakWaitEvent } from '../src/theta/postgres-soak-acceptance.js';

const waitEvent=(override:Partial<PostgresSoakWaitEvent>={}):PostgresSoakWaitEvent=>({
  waitEventId:'wait-1',batchId:'batch-1',waitStart:'2026-09-28T00:00:00.000Z',
  waitEnd:'2026-09-28T00:00:00.020Z',waitDurationMs:20,poolTotalAtStart:2,poolIdleAtStart:1,
  poolWaitingAtStart:1,concurrentTaskCount:2,operationType:'BOUNDED_BATCH_READ',
  acquisitionResult:'ACQUIRED',poolWaitingAfterBatch:0,classification:'PG_POOL_ASYNC_IDLE_HANDOFF',...override});

const validInput=(override:Partial<PostgresSoakAcceptanceInput>={}):PostgresSoakAcceptanceInput=>({
  poolWaitTimeoutMillis:5_000,poolMaximum:2,maxPoolTotal:2,finalPoolWaiting:0,
  waitEvents:[waitEvent()],batches:[{batchId:'batch-1',expectedTaskCount:6,completedTaskCount:6,
    maximumConcurrentTaskCount:2,poolWaitingAfterBatch:0}],acquiredClients:10,releasedClients:10,
  failedAcquisitions:0,classifiedPoolErrorCount:0,unclassifiedErrors:0,recoveredReadRetries:0,
  postmasterRestartDetected:false,maxIdleInTransaction:0,lastSafeCode:null,rollbackSafeWrites:1,
  snapshotPersistenceProofs:1,archiveReconstructionProofs:1,freshProbeAttemptCount:1,
  freshProbeClosedCount:1,freshProbeFailureCount:0,...override});

test('transient waiter below timeout that drains after its bounded batch passes',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput());
  assert.equal(result.result,'PASS');
  assert.equal(result.waitersDrainedAfterEveryBatch,true);
  assert.equal(result.maxTransientWaitMs,20);
});

test('waiter exceeding the governed 5000 ms pool-wait boundary fails',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({waitEvents:[waitEvent({waitDurationMs:5_001})]}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_POOL_WAIT_DURATION_EXCEEDED'));
});

test('an incomplete bounded batch fails explicitly',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({
    batches:[{batchId:'batch-1',expectedTaskCount:6,completedTaskCount:5,maximumConcurrentTaskCount:2,
      poolWaitingAfterBatch:0}]}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_BOUNDED_BATCH_INCOMPLETE'));
});

test('waiter remaining after a bounded batch fails',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({waitEvents:[waitEvent({poolWaitingAfterBatch:1})],
    batches:[{batchId:'batch-1',expectedTaskCount:6,completedTaskCount:6,maximumConcurrentTaskCount:2,
      poolWaitingAfterBatch:1}]}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_POOL_WAITERS_NOT_DRAINED'));
});

test('any acquisition error fails acceptance',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({failedAcquisitions:1,
    waitEvents:[waitEvent({acquisitionResult:'ACQUISITION_FAILED'})]}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_ACQUISITION_FAILED'));
  assert.ok(result.reasons.includes('SOAK_WAIT_EVENT_ACQUISITION_FAILED'));
});

test('an acquired client without a matching release fails as a connection leak',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({acquiredClients:10,releasedClients:9}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_CONNECTION_LEAK'));
});

test('hidden over-concurrency fails explicitly',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({maxPoolTotal:3,
    batches:[{batchId:'batch-1',expectedTaskCount:6,completedTaskCount:6,maximumConcurrentTaskCount:3,
      poolWaitingAfterBatch:0}]}));
  assert.equal(result.result,'FAIL');
  assert.equal(result.hiddenOverConcurrency,true);
  assert.ok(result.reasons.includes('SOAK_HIDDEN_OVERCONCURRENCY'));
});

test('momentary queue depth alone is telemetry and never a starvation verdict',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({waitEvents:[waitEvent({poolWaitingAtStart:7,
    waitDurationMs:1,poolWaitingAfterBatch:0})]}));
  assert.equal(result.result,'PASS');
  assert.equal(result.transientWaitEventCount,1);
});

test('a nonzero final queue fails even when batches previously drained',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({finalPoolWaiting:1}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_FINAL_POOL_WAITERS_NONZERO'));
});

test('pool wait and physical connection timeouts remain separate governed constants',()=>{
  assert.equal(thetaSoakPoolWaitTimeoutMillis,5_000);
  assert.equal(thetaSoakFreshPhysicalConnectionTimeoutMillis,8_000);
});

test('fresh probe phase telemetry is integrated without retries or broker semantics',async()=>{
  const source=await readFile(new URL('../tools/theta-postgres-stability-soak.ts',import.meta.url),'utf8');
  assert.match(source,/runInstrumentedFreshPostgresAttempt/);
  assert.match(source,/connectionTimeoutMillis:thetaSoakFreshPhysicalConnectionTimeoutMillis/);
  assert.match(source,/freshConnectionLifecycleTelemetry/);
  for(const field of ['dnsMs','tcpMs','tlsMs','postgresStartupMs','totalConnectionMs','firstQueryMs']){
    assert.match(source,new RegExp(`${field}:summarizeKnown`));
  }
  for(const field of ['waitEventId','batchId','waitStart','waitEnd','waitDurationMs','poolTotalAtStart',
    'poolIdleAtStart','poolWaitingAtStart','concurrentTaskCount','operationType','acquisitionResult',
    'poolWaitingAfterBatch'])assert.match(source,new RegExp(field));
  assert.doesNotMatch(source,/withRuntimePostgresReadRetry/);
  assert.match(source,/orderSubmissions:0,brokerMutations:0/);
});

test('idle clients with a pending pg-pool handoff classify as asynchronous handoff',()=>{
  assert.equal(classifyPostgresSoakWait({poolTotal:2,poolIdle:2,poolMaximum:2}),'PG_POOL_ASYNC_IDLE_HANDOFF');
  assert.equal(classifyPostgresSoakWait({poolTotal:2,poolIdle:0,poolMaximum:2}),'CAPACITY_WAIT');
});
