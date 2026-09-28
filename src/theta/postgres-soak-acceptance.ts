import type { PostgresAcquisitionFailureClass, PostgresAcquisitionPath } from './runtime-postgres-client.js';

export type PostgresSoakAcquisitionResult = 'ACQUIRED' | 'ACQUISITION_FAILED';
export type PostgresSoakWaitClassification = 'PG_POOL_ASYNC_IDLE_HANDOFF' | 'CAPACITY_WAIT'
  | 'PHYSICAL_CONNECTION_ESTABLISHMENT' | 'UNKNOWN';
export type PostgresSoakBatchState = 'PASS' | 'FAILED' | 'ABORTED_BY_PARENT' | 'NOT_STARTED';

export interface PostgresSoakWaitEvent {
  readonly waitEventId: string;
  readonly batchId: string;
  readonly taskId: string;
  readonly waitStart: string;
  readonly waitEnd: string;
  readonly waitDurationMs: number;
  readonly poolQueueDurationMs: number | null;
  readonly physicalConnectionDurationMs: number | null;
  readonly poolTotalAtStart: number;
  readonly poolIdleAtStart: number;
  readonly poolWaitingAtStart: number;
  readonly concurrentTaskCount: number;
  readonly operationType: string;
  readonly acquisitionResult: PostgresSoakAcquisitionResult;
  readonly acquisitionPath: PostgresAcquisitionPath;
  readonly acquisitionFailureClass: PostgresAcquisitionFailureClass | null;
  poolWaitingAfterBatch: number | null;
  readonly classification: PostgresSoakWaitClassification;
}

export interface PostgresSoakBatchReceipt {
  readonly batchId: string;
  readonly state: PostgresSoakBatchState;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly failureSafeCode: string | null;
  readonly expectedTaskCount: number;
  readonly completedTaskCount: number;
  readonly maximumConcurrentTaskCount: number;
  readonly poolWaitingAfterBatch: number;
}

export interface PostgresSoakAcceptanceInput {
  readonly poolWaitTimeoutMillis: number;
  readonly poolMaximum: number;
  readonly maxPoolTotal: number;
  readonly finalPoolWaiting: number;
  readonly waitEvents: readonly PostgresSoakWaitEvent[];
  readonly batches: readonly PostgresSoakBatchReceipt[];
  readonly acquiredClients: number;
  readonly releasedClients: number;
  readonly failedAcquisitions: number;
  readonly classifiedPoolErrorCount: number;
  readonly unclassifiedErrors: number;
  readonly recoveredReadRetries: number;
  readonly postmasterRestartDetected: boolean;
  readonly maxIdleInTransaction: number;
  readonly lastSafeCode: string | null;
  readonly rollbackSafeWrites: number;
  readonly snapshotPersistenceProofs: number;
  readonly archiveReconstructionProofs: number;
  readonly freshProbeAttemptCount: number;
  readonly freshProbeClosedCount: number;
  readonly freshProbeFailureCount: number;
}

export interface PostgresSoakAcceptanceResult {
  readonly result: 'PASS' | 'FAIL';
  readonly reasons: readonly string[];
  readonly transientWaitEventCount: number;
  readonly maxTransientWaitMs: number | null;
  readonly physicalConnectionEventCount: number;
  readonly maxPhysicalConnectionMs: number | null;
  readonly waitersDrainedAfterEveryBatch: boolean;
  readonly allBoundedBatchesComplete: boolean;
  readonly hiddenOverConcurrency: boolean;
}

export function buildPostgresSoakBatchReceipt(input:{readonly batchId:string;readonly startedAt:string;
  readonly completedAt:string;readonly expectedTaskCount:number;readonly completedTaskCount:number;
  readonly maximumConcurrentTaskCount:number;readonly poolWaitingAfterBatch:number;
  readonly failureSafeCode:string|null}):PostgresSoakBatchReceipt{
  const complete=input.failureSafeCode===null&&input.completedTaskCount===input.expectedTaskCount;
  return {...input,state:complete?'PASS':'FAILED'};
}

export function classifyPostgresSoakWait(input:{readonly poolTotal:number;readonly poolIdle:number;
  readonly poolMaximum:number;readonly acquisitionPath?:PostgresAcquisitionPath}):PostgresSoakWaitClassification{
  if(input.acquisitionPath==='NEW_CONNECTION')return 'PHYSICAL_CONNECTION_ESTABLISHMENT';
  if(input.poolIdle>0)return 'PG_POOL_ASYNC_IDLE_HANDOFF';
  if(input.poolTotal>=input.poolMaximum)return 'CAPACITY_WAIT';
  return 'UNKNOWN';
}

export function evaluatePostgresSoakAcceptance(input:PostgresSoakAcceptanceInput):PostgresSoakAcceptanceResult{
  const reasons:string[]=[];
  const allBoundedBatchesComplete=input.batches.length>0&&input.batches.every((batch)=>
    batch.state==='PASS'&&batch.completedTaskCount===batch.expectedTaskCount);
  const waitersDrainedAfterEveryBatch=input.batches.every((batch)=>batch.poolWaitingAfterBatch===0)
    &&input.waitEvents.every((event)=>event.poolWaitingAfterBatch===0);
  const hiddenOverConcurrency=input.maxPoolTotal>input.poolMaximum||input.batches.some((batch)=>
    batch.maximumConcurrentTaskCount>input.poolMaximum);
  if(!allBoundedBatchesComplete)reasons.push('SOAK_BOUNDED_BATCH_INCOMPLETE');
  if(hiddenOverConcurrency)reasons.push('SOAK_HIDDEN_OVERCONCURRENCY');
  if(!waitersDrainedAfterEveryBatch)reasons.push('SOAK_POOL_WAITERS_NOT_DRAINED');
  if(input.finalPoolWaiting!==0)reasons.push('SOAK_FINAL_POOL_WAITERS_NONZERO');
  if(input.waitEvents.some((event)=>event.poolQueueDurationMs!==null
    &&event.poolQueueDurationMs>=input.poolWaitTimeoutMillis)){
    reasons.push('SOAK_POOL_WAIT_DURATION_EXCEEDED');
  }
  if(input.waitEvents.some((event)=>event.acquisitionResult==='ACQUISITION_FAILED')){
    reasons.push('SOAK_WAIT_EVENT_ACQUISITION_FAILED');
  }
  if(input.failedAcquisitions!==0)reasons.push('SOAK_ACQUISITION_FAILED');
  if(input.acquiredClients!==input.releasedClients)reasons.push('SOAK_CONNECTION_LEAK');
  if(input.classifiedPoolErrorCount!==0)reasons.push('SOAK_CLASSIFIED_POOL_ERROR');
  if(input.unclassifiedErrors!==0)reasons.push('SOAK_UNCLASSIFIED_POSTGRES_ERROR');
  if(input.recoveredReadRetries!==0)reasons.push('SOAK_RECOVERED_READ_RETRY');
  if(input.postmasterRestartDetected)reasons.push('SOAK_POSTMASTER_RESTART');
  if(input.maxIdleInTransaction!==0)reasons.push('SOAK_IDLE_IN_TRANSACTION_LEAK');
  if(input.lastSafeCode!==null)reasons.push('SOAK_DATABASE_FAILURE');
  if(input.rollbackSafeWrites<=0)reasons.push('SOAK_ROLLBACK_SAFE_WRITE_MISSING');
  if(input.snapshotPersistenceProofs!==1)reasons.push('SOAK_SNAPSHOT_PERSISTENCE_PROOF_MISSING');
  if(input.archiveReconstructionProofs!==1)reasons.push('SOAK_ARCHIVE_RECONSTRUCTION_PROOF_MISSING');
  if(input.freshProbeAttemptCount!==input.freshProbeClosedCount)reasons.push('SOAK_FRESH_PROBE_CLOSE_LEAK');
  if(input.freshProbeFailureCount!==0)reasons.push('SOAK_FRESH_PROBE_FAILED');
  const durations=input.waitEvents.flatMap((event)=>event.poolQueueDurationMs===null?[]:[event.poolQueueDurationMs]);
  const physicalDurations=input.waitEvents.flatMap((event)=>event.physicalConnectionDurationMs===null
    ?[]:[event.physicalConnectionDurationMs]);
  return {result:reasons.length===0?'PASS':'FAIL',reasons:[...new Set(reasons)],
    transientWaitEventCount:durations.length,
    maxTransientWaitMs:durations.length===0?null:Math.max(...durations),waitersDrainedAfterEveryBatch,
    physicalConnectionEventCount:physicalDurations.length,
    maxPhysicalConnectionMs:physicalDurations.length===0?null:Math.max(...physicalDurations),
    allBoundedBatchesComplete,hiddenOverConcurrency};
}
