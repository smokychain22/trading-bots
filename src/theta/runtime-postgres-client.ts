import type { Pool, PoolClient } from 'pg';
import { classifyPostgresRuntimeError, PostgresCommitOutcomeUnknownError } from './postgres-runtime-error.js';

export type PostgresAcquisitionPath = 'IDLE_REUSE' | 'POOL_QUEUE' | 'NEW_CONNECTION' | 'UNKNOWN';
export type PostgresClientObservationOutcome = 'SUCCEEDED_RELEASED' | 'OPERATION_FAILED_RELEASED' | 'ACQUISITION_FAILED';

export interface RuntimePostgresPoolState {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
}

export interface RuntimePostgresClientObservation {
  readonly requestedAt: string;
  readonly acquiredAt: string | null;
  readonly releasedAt: string | null;
  readonly acquisitionDurationMs: number;
  readonly checkoutDurationMs: number | null;
  readonly acquisitionPath: PostgresAcquisitionPath;
  readonly outcome: PostgresClientObservationOutcome;
  readonly connectionTimeoutMillis: number | null;
  readonly poolWaitTimeoutMillis: number | null;
  readonly poolBefore: RuntimePostgresPoolState;
  readonly poolAtAcquire: RuntimePostgresPoolState | null;
  readonly poolAfterRelease: RuntimePostgresPoolState | null;
  readonly discarded: boolean;
  readonly failureSafeCode: string | null;
}

export interface RuntimePostgresClientOptions {
  readonly observe?: (observation: RuntimePostgresClientObservation) => void;
  readonly now?: () => number;
  readonly poolWaitTimeoutMillis?: number;
}

function poolState(pool:Pool):RuntimePostgresPoolState{
  return {total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount};
}

function poolMaximum(pool:Pool):number|null{
  const configured=Number(pool.options.max);
  return Number.isFinite(configured)&&configured>0?configured:null;
}

function configuredConnectionTimeout(pool:Pool):number|null{
  const configured=Number(pool.options.connectionTimeoutMillis);
  return Number.isFinite(configured)&&configured>=0?configured:null;
}

export function classifyPostgresAcquisitionPath(pool:Pool,before:RuntimePostgresPoolState,
  error?:unknown):PostgresAcquisitionPath{
  const message=error!==null&&typeof error==='object'&&typeof (error as {message?:unknown}).message==='string'
    ?(error as {message:string}).message:'';
  if(/timeout exceeded when trying to connect/i.test(message))return 'POOL_QUEUE';
  if(/connection terminated due to connection timeout/i.test(message))return 'NEW_CONNECTION';
  if(before.idle>0)return 'IDLE_REUSE';
  const maximum=poolMaximum(pool);
  if(maximum!==null&&before.total>=maximum)return 'POOL_QUEUE';
  if(maximum!==null&&before.total<maximum)return 'NEW_CONNECTION';
  return 'UNKNOWN';
}

export class PostgresCheckedOutClientLostError extends Error {
  readonly code = 'POSTGRES_CHECKED_OUT_CLIENT_LOST';
  constructor() { super('POSTGRES_CHECKED_OUT_CLIENT_LOST'); }
}

export class PostgresPoolWaitTimeoutError extends Error {
  readonly code='POSTGRES_CONNECTION_ACQUISITION_TIMEOUT';
  constructor(){super('POSTGRES_CONNECTION_ACQUISITION_TIMEOUT');}
}

function connectWithSeparatePoolWaitTimeout(pool:Pool,before:RuntimePostgresPoolState,
  poolWaitTimeoutMillis:number|undefined):Promise<PoolClient>{
  if(poolWaitTimeoutMillis===undefined)return pool.connect();
  const maximum=poolMaximum(pool);
  const queued=before.idle===0&&maximum!==null&&before.total>=maximum;
  if(!queued)return pool.connect();
  const timeout=Math.max(1,Math.trunc(poolWaitTimeoutMillis));
  return new Promise<PoolClient>((resolve,reject)=>{
    let settled=false;
    let timedOut=false;
    const timer=setTimeout(()=>{
      if(settled)return;
      settled=true;timedOut=true;
      reject(new PostgresPoolWaitTimeoutError());
    },timeout);
    void pool.connect().then((client)=>{
      if(timedOut||settled){client.release();return;}
      settled=true;clearTimeout(timer);resolve(client);
    },(error:unknown)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);reject(error);
    });
  });
}

/** Covers the EventEmitter error path, which a pool's idle-client listener cannot see. */
export async function withRuntimePostgresClient<T>(pool: Pool,
  operation: (client: PoolClient, discard: () => void) => Promise<T>,
  options:RuntimePostgresClientOptions={}): Promise<T> {
  const now=options.now??Date.now;
  const requestedAtMs=now();
  const before=poolState(pool);
  let client:PoolClient;
  try{client=await connectWithSeparatePoolWaitTimeout(pool,before,options.poolWaitTimeoutMillis);}
  catch(error){
    const failedAtMs=now();
    options.observe?.({requestedAt:new Date(requestedAtMs).toISOString(),acquiredAt:null,releasedAt:null,
      acquisitionDurationMs:Math.max(0,failedAtMs-requestedAtMs),checkoutDurationMs:null,
      acquisitionPath:classifyPostgresAcquisitionPath(pool,before,error),outcome:'ACQUISITION_FAILED',
      connectionTimeoutMillis:configuredConnectionTimeout(pool),poolWaitTimeoutMillis:options.poolWaitTimeoutMillis??null,
      poolBefore:before,poolAtAcquire:null,
      poolAfterRelease:null,discarded:false,failureSafeCode:classifyPostgresRuntimeError(error).safeCode});
    throw error;
  }
  const acquiredAtMs=now();
  const atAcquire=poolState(pool);
  let broken = false;
  let outcome:PostgresClientObservationOutcome='SUCCEEDED_RELEASED';
  let failureSafeCode:string|null=null;
  const onError = (): void => { broken = true; };
  client.on('error', onError);
  try {
    const result = await operation(client, () => { broken = true; });
    if (broken) throw new PostgresCheckedOutClientLostError();
    return result;
  } catch (error) {
    outcome='OPERATION_FAILED_RELEASED';
    failureSafeCode=classifyPostgresRuntimeError(error).safeCode;
    if (classifyPostgresRuntimeError(error).retryableRead || error instanceof PostgresCheckedOutClientLostError
      || error instanceof PostgresCommitOutcomeUnknownError) broken = true;
    throw error;
  } finally {
    client.removeListener('error', onError);
    client.release(broken);
    const releasedAtMs=now();
    options.observe?.({requestedAt:new Date(requestedAtMs).toISOString(),acquiredAt:new Date(acquiredAtMs).toISOString(),
      releasedAt:new Date(releasedAtMs).toISOString(),acquisitionDurationMs:Math.max(0,acquiredAtMs-requestedAtMs),
      checkoutDurationMs:Math.max(0,releasedAtMs-acquiredAtMs),acquisitionPath:classifyPostgresAcquisitionPath(pool,before),
      outcome,connectionTimeoutMillis:configuredConnectionTimeout(pool),poolWaitTimeoutMillis:options.poolWaitTimeoutMillis??null,
      poolBefore:before,poolAtAcquire:atAcquire,
      poolAfterRelease:poolState(pool),discarded:broken,failureSafeCode});
  }
}

/** A write is never replayed here. A lost COMMIT is only successful when a fresh read proves its identity. */
export async function withRuntimePostgresTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>,
  options: { readonly beginSql?: 'BEGIN' | 'BEGIN TRANSACTION READ ONLY' | 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
    readonly verifyCommitted?: (pool: Pool, outcome: T) => Promise<boolean> } = {}): Promise<T> {
  let outcome: T | undefined;
  let operationCompleted = false;
  let commitStarted = false;
  try {
    return await withRuntimePostgresClient(pool, async (client, discard) => {
      await client.query(options.beginSql ?? 'BEGIN');
      try {
        outcome = await operation(client);
        operationCompleted = true;
        commitStarted = true;
        await client.query('COMMIT');
        return outcome;
      } catch (error) {
        if (commitStarted) discard();
        if (!commitStarted) {
          try { await client.query('ROLLBACK'); }
          catch { discard(); throw new PostgresCheckedOutClientLostError(); }
        }
        throw error;
      }
    });
  } catch (error) {
    if (commitStarted && classifyPostgresRuntimeError(error).retryableRead) {
      if (options.verifyCommitted !== undefined && operationCompleted) {
        try { if (await options.verifyCommitted(pool, outcome as T)) return outcome as T; }
        catch (verificationError) {
          if (!classifyPostgresRuntimeError(verificationError).retryableRead) throw verificationError;
          // A transient verification failure cannot resolve the write outcome.
        }
      }
      throw new PostgresCommitOutcomeUnknownError();
    }
    throw error;
  }
}

export interface PostgresReadRetryReceipt<T> {
  readonly value: T;
  readonly attemptCount: number;
  readonly firstFailureAt: string | null;
  readonly recoveredAt: string | null;
}

/** Only call for read-only operations. Every attempt checks out a fresh client. */
export async function withRuntimePostgresReadRetry<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>,
  options: { readonly maximumAttempts?: number; readonly delayMs?: (attempt: number) => number;
    readonly random?: () => number; readonly clientOptions?:RuntimePostgresClientOptions } = {}): Promise<PostgresReadRetryReceipt<T>> {
  const maximumAttempts = Math.max(1, Math.min(3, options.maximumAttempts ?? 3));
  let firstFailureAt: string | null = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const value = await withRuntimePostgresClient(pool, operation,options.clientOptions);
      return { value, attemptCount: attempt, firstFailureAt, recoveredAt: firstFailureAt === null ? null : new Date().toISOString() };
    } catch (error) {
      if (!classifyPostgresRuntimeError(error).retryableRead || attempt === maximumAttempts) throw error;
      firstFailureAt ??= new Date().toISOString();
      const jitter=Math.max(0,Math.min(1,(options.random??Math.random)()));
      const defaultDelay=attempt===1?500+Math.floor(jitter*500):1_500+Math.floor(jitter*1_000);
      const delay = Math.max(0, Math.min(3_500, options.delayMs?.(attempt) ?? defaultDelay));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('POSTGRES_READ_RETRY_EXHAUSTED');
}
