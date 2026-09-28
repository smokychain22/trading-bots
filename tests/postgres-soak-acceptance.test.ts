import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { thetaSoakFreshPhysicalConnectionTimeoutMillis,
  thetaSoakPoolWaitTimeoutMillis } from '../src/theta/postgres-connection-characterization.js';
import { buildPostgresSoakBatchReceipt, classifyPostgresSoakWait, evaluatePostgresSoakAcceptance,
  type PostgresSoakAcceptanceInput, type PostgresSoakWaitEvent } from '../src/theta/postgres-soak-acceptance.js';

const waitEvent=(override:Partial<PostgresSoakWaitEvent>={}):PostgresSoakWaitEvent=>({
  waitEventId:'wait-1',batchId:'batch-1',taskId:'batch-1-task-2',waitStart:'2026-09-28T00:00:00.000Z',
  waitEnd:'2026-09-28T00:00:00.020Z',waitDurationMs:20,poolQueueDurationMs:20,
  physicalConnectionDurationMs:null,poolTotalAtStart:2,poolIdleAtStart:1,
  poolWaitingAtStart:1,concurrentTaskCount:2,operationType:'BOUNDED_BATCH_READ',
  acquisitionResult:'ACQUIRED',acquisitionPath:'IDLE_REUSE',acquisitionFailureClass:null,
  poolWaitingAfterBatch:0,classification:'PG_POOL_ASYNC_IDLE_HANDOFF',...override});

const batch=(override:Partial<PostgresSoakAcceptanceInput['batches'][number]>={}):
PostgresSoakAcceptanceInput['batches'][number]=>({batchId:'batch-1',state:'PASS',
  startedAt:'2026-09-28T00:00:00.000Z',completedAt:'2026-09-28T00:00:00.050Z',failureSafeCode:null,
  expectedTaskCount:6,completedTaskCount:6,maximumConcurrentTaskCount:2,poolWaitingAfterBatch:0,...override});

const validInput=(override:Partial<PostgresSoakAcceptanceInput>={}):PostgresSoakAcceptanceInput=>({
  poolWaitTimeoutMillis:5_000,poolMaximum:2,maxPoolTotal:2,finalPoolWaiting:0,
  waitEvents:[waitEvent()],batches:[batch()],acquiredClients:10,releasedClients:10,
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
  const result=evaluatePostgresSoakAcceptance(validInput({waitEvents:[waitEvent({waitDurationMs:5_001,
    poolQueueDurationMs:5_001})]}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_POOL_WAIT_DURATION_EXCEEDED'));
});

test('an incomplete bounded batch fails explicitly',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({
    batches:[batch({state:'FAILED',completedTaskCount:5,failureSafeCode:'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT'})]}));
  assert.equal(result.result,'FAIL');
  assert.ok(result.reasons.includes('SOAK_BOUNDED_BATCH_INCOMPLETE'));
});

test('a started batch with a primary failure is persisted as FAILED rather than omitted',()=>{
  const receipt=buildPostgresSoakBatchReceipt({batchId:'batch-69',
    startedAt:'2026-09-28T14:53:44.000Z',completedAt:'2026-09-28T14:53:53.000Z',expectedTaskCount:6,
    completedTaskCount:4,maximumConcurrentTaskCount:2,poolWaitingAfterBatch:0,
    failureSafeCode:'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT'});
  assert.equal(receipt.state,'FAILED');
  assert.equal(receipt.failureSafeCode,'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT');
  const result=evaluatePostgresSoakAcceptance(validInput({batches:[receipt]}));
  assert.equal(result.allBoundedBatchesComplete,false);
  assert.ok(result.reasons.includes('SOAK_BOUNDED_BATCH_INCOMPLETE'));
});

test('zero recorded batches cannot satisfy bounded-batch completion',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({batches:[]}));
  assert.equal(result.allBoundedBatchesComplete,false);
  assert.ok(result.reasons.includes('SOAK_BOUNDED_BATCH_INCOMPLETE'));
});

test('waiter remaining after a bounded batch fails',()=>{
  const result=evaluatePostgresSoakAcceptance(validInput({waitEvents:[waitEvent({poolWaitingAfterBatch:1})],
    batches:[batch({poolWaitingAfterBatch:1})]}));
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
    batches:[batch({maximumConcurrentTaskCount:3})]}));
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

test('an eight-second physical connect failure is not evaluated as a five-second pool queue wait',()=>{
  const physical=waitEvent({waitDurationMs:8_007,poolQueueDurationMs:null,
    physicalConnectionDurationMs:8_007,acquisitionPath:'NEW_CONNECTION',
    acquisitionFailureClass:'PHYSICAL_CONNECTION_TIMEOUT',classification:'PHYSICAL_CONNECTION_ESTABLISHMENT',
    acquisitionResult:'ACQUISITION_FAILED'});
  const result=evaluatePostgresSoakAcceptance(validInput({waitEvents:[physical],failedAcquisitions:1,
    batches:[batch({state:'FAILED',completedTaskCount:4,failureSafeCode:'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT'})],
    lastSafeCode:'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT'}));
  assert.equal(result.result,'FAIL');
  assert.ok(!result.reasons.includes('SOAK_POOL_WAIT_DURATION_EXCEEDED'));
  assert.ok(result.reasons.includes('SOAK_ACQUISITION_FAILED'));
  assert.ok(result.reasons.includes('SOAK_BOUNDED_BATCH_INCOMPLETE'));
  assert.equal(result.transientWaitEventCount,0);
  assert.equal(result.maxTransientWaitMs,null);
  assert.equal(result.physicalConnectionEventCount,1);
  assert.equal(result.maxPhysicalConnectionMs,8_007);
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
    'taskId','poolIdleAtStart','poolWaitingAtStart','concurrentTaskCount','operationType','acquisitionResult',
    'poolWaitingAfterBatch'])assert.match(source,new RegExp(field));
  assert.match(source,/readyMs:summarizeKnown/);
  assert.match(source,/buildPostgresSoakBatchReceipt/);
  assert.doesNotMatch(source,/withRuntimePostgresReadRetry/);
  assert.match(source,/orderSubmissions:0,brokerMutations:0/);
});

test('idle clients with a pending pg-pool handoff classify as asynchronous handoff',()=>{
  assert.equal(classifyPostgresSoakWait({poolTotal:2,poolIdle:2,poolMaximum:2}),'PG_POOL_ASYNC_IDLE_HANDOFF');
  assert.equal(classifyPostgresSoakWait({poolTotal:2,poolIdle:0,poolMaximum:2}),'CAPACITY_WAIT');
});
