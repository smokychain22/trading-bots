import type { Pool, PoolClient } from 'pg';
import { classifyPostgresRuntimeError, PostgresCommitOutcomeUnknownError } from './postgres-runtime-error.js';

export type PostgresAcquisitionPath = 'IDLE_REUSE' | 'POOL_QUEUE' | 'NEW_CONNECTION' | 'UNKNOWN';
export type PostgresClientObservationOutcome = 'SUCCEEDED_RELEASED' | 'OPERATION_FAILED_RELEASED' | 'ACQUISITION_FAILED';
export type PostgresAcquisitionFailureClass = 'POOL_QUEUE_TIMEOUT' | 'PHYSICAL_CONNECTION_TIMEOUT'
  | 'DNS_RESOLUTION_FAILURE' | 'TCP_CONNECTION_FAILURE' | 'TLS_FAILURE' | 'POSTGRES_STARTUP_FAILURE'
  | 'AUTHENTICATION_FAILURE' | 'SERVER_REJECTION' | 'POOL_SHUTDOWN_FALLOUT'
  | 'UNKNOWN_POSTGRES_ACQUISITION_FAILURE';

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
  readonly acquisitionFailureClass: PostgresAcquisitionFailureClass | null;
  readonly poolWaitTimerArmed: boolean;
  readonly poolQueueDurationMs: number | null;
  readonly physicalConnectionDurationMs: number | null;
  readonly outcome: PostgresClientObservationOutcome;
  readonly connectionTimeoutMillis: number | null;
  readonly poolWaitTimeoutMillis: number | null;
  readonly poolBefore: RuntimePostgresPoolState;
  readonly poolAfterRequest: RuntimePostgresPoolState | null;
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
  const finite=(value:unknown):number=>Number.isFinite(Number(value))?Number(value):0;
  return {total:finite(pool.totalCount),idle:finite(pool.idleCount),waiting:finite(pool.waitingCount)};
}

function poolMaximum(pool:Pool):number|null{
  const configured=Number((pool as Pool&{options?:{max?:unknown}}).options?.max);
  return Number.isFinite(configured)&&configured>0?configured:null;
}

function configuredConnectionTimeout(pool:Pool):number|null{
  const configured=Number((pool as Pool&{options?:{connectionTimeoutMillis?:unknown}}).options?.connectionTimeoutMillis);
  return Number.isFinite(configured)&&configured>=0?configured:null;
}

export function classifyPostgresAcquisitionPath(pool:Pool,before:RuntimePostgresPoolState,
  error?:unknown):PostgresAcquisitionPath{
  if(error instanceof PostgresPoolWaitTimeoutError)return 'POOL_QUEUE';
  const maximum=poolMaximum(pool);
  const unpromisedIdle=Math.max(0,before.idle-before.waiting);
  if(unpromisedIdle>0)return 'IDLE_REUSE';
  if(maximum!==null&&before.total>=maximum)return 'POOL_QUEUE';
  if(maximum!==null&&before.total<maximum)return 'NEW_CONNECTION';
  return 'UNKNOWN';
}

function errorCode(error:unknown):string{
  return error!==null&&typeof error==='object'&&typeof (error as {code?:unknown}).code==='string'
    ?(error as {code:string}).code:'';
}

function errorMessage(error:unknown):string{
  return error!==null&&typeof error==='object'&&typeof (error as {message?:unknown}).message==='string'
    ?(error as {message:string}).message:'';
}

export function classifyPostgresAcquisitionFailure(error:unknown,path:PostgresAcquisitionPath):
PostgresAcquisitionFailureClass{
  if(error instanceof PostgresPoolWaitTimeoutError)return 'POOL_QUEUE_TIMEOUT';
  const code=errorCode(error).toUpperCase();
  const message=errorMessage(error);
  if(/cannot use a pool after calling end|pool is draining|pool is closed/i.test(message))return 'POOL_SHUTDOWN_FALLOUT';
  if(code==='EAI_AGAIN'||code==='ENOTFOUND')return 'DNS_RESOLUTION_FAILURE';
  if(code==='ETIMEDOUT'||code==='ECONNREFUSED'||code==='EHOSTUNREACH'||code==='ENETUNREACH'){
    return code==='ETIMEDOUT'&&path==='NEW_CONNECTION'?'PHYSICAL_CONNECTION_TIMEOUT':'TCP_CONNECTION_FAILURE';
  }
  if(/certificate|self[- ]signed|tls|ssl/i.test(message))return 'TLS_FAILURE';
  if(code==='28P01'||code==='28000')return 'AUTHENTICATION_FAILURE';
  if(code==='57P03'||code==='53300'||code==='53000')return 'SERVER_REJECTION';
  if(path==='POOL_QUEUE'&&/timeout exceeded when trying to connect/i.test(message))return 'POOL_QUEUE_TIMEOUT';
  if(path==='NEW_CONNECTION'&&/timeout exceeded when trying to connect|connection terminated due to connection timeout/i.test(message)){
    return 'PHYSICAL_CONNECTION_TIMEOUT';
  }
  if(path==='NEW_CONNECTION')return 'POSTGRES_STARTUP_FAILURE';
  return 'UNKNOWN_POSTGRES_ACQUISITION_FAILURE';
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
  poolWaitTimeoutMillis:number|undefined):{readonly client:Promise<PoolClient>;
    readonly poolAfterRequest:RuntimePostgresPoolState;readonly poolWaitTimerArmed:boolean}{
  const pending=pool.connect();
  const poolAfterRequest=poolState(pool);
  if(poolWaitTimeoutMillis===undefined)return {client:pending,poolAfterRequest,poolWaitTimerArmed:false};
  const maximum=poolMaximum(pool);
  const unpromisedIdle=Math.max(0,before.idle-before.waiting);
  const queued=unpromisedIdle===0&&maximum!==null&&before.total>=maximum;
  if(!queued)return {client:pending,poolAfterRequest,poolWaitTimerArmed:false};
  const timeout=Math.max(1,Math.trunc(poolWaitTimeoutMillis));
  const client=new Promise<PoolClient>((resolve,reject)=>{
    let settled=false;
    let timedOut=false;
    const timer=setTimeout(()=>{
      if(settled)return;
      settled=true;timedOut=true;
      reject(new PostgresPoolWaitTimeoutError());
    },timeout);
    void pending.then((acquired)=>{
      if(timedOut||settled){acquired.release();return;}
      settled=true;clearTimeout(timer);resolve(acquired);
    },(error:unknown)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);reject(error);
    });
  });
  return {client,poolAfterRequest,poolWaitTimerArmed:true};
}

/** Covers the EventEmitter error path, which a pool's idle-client listener cannot see. */
export async function withRuntimePostgresClient<T>(pool: Pool,
  operation: (client: PoolClient, discard: () => void) => Promise<T>,
  options:RuntimePostgresClientOptions={}): Promise<T> {
  const now=options.now??Date.now;
  const requestedAtMs=now();
  const before=poolState(pool);
  let afterRequest:RuntimePostgresPoolState|null=null;
  let poolWaitTimerArmed=false;
  let client:PoolClient;
  try{
    const acquisition=connectWithSeparatePoolWaitTimeout(pool,before,options.poolWaitTimeoutMillis);
    afterRequest=acquisition.poolAfterRequest;
    poolWaitTimerArmed=acquisition.poolWaitTimerArmed;
    client=await acquisition.client;
  }
  catch(error){
    const failedAtMs=now();
    const acquisitionPath=classifyPostgresAcquisitionPath(pool,before,error);
    const acquisitionDurationMs=Math.max(0,failedAtMs-requestedAtMs);
    options.observe?.({requestedAt:new Date(requestedAtMs).toISOString(),acquiredAt:null,releasedAt:null,
      acquisitionDurationMs,checkoutDurationMs:null,acquisitionPath,
      acquisitionFailureClass:classifyPostgresAcquisitionFailure(error,acquisitionPath),poolWaitTimerArmed,
      poolQueueDurationMs:acquisitionPath==='POOL_QUEUE'||acquisitionPath==='IDLE_REUSE'?acquisitionDurationMs:null,
      physicalConnectionDurationMs:acquisitionPath==='NEW_CONNECTION'?acquisitionDurationMs:null,
      outcome:'ACQUISITION_FAILED',
      connectionTimeoutMillis:configuredConnectionTimeout(pool),poolWaitTimeoutMillis:options.poolWaitTimeoutMillis??null,
      poolBefore:before,poolAfterRequest:afterRequest,poolAtAcquire:null,
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
      acquisitionFailureClass:null,poolWaitTimerArmed,
      poolQueueDurationMs:['POOL_QUEUE','IDLE_REUSE'].includes(classifyPostgresAcquisitionPath(pool,before))
        ?Math.max(0,acquiredAtMs-requestedAtMs):null,
      physicalConnectionDurationMs:classifyPostgresAcquisitionPath(pool,before)==='NEW_CONNECTION'
        ?Math.max(0,acquiredAtMs-requestedAtMs):null,
      outcome,connectionTimeoutMillis:configuredConnectionTimeout(pool),poolWaitTimeoutMillis:options.poolWaitTimeoutMillis??null,
      poolBefore:before,poolAfterRequest:afterRequest,poolAtAcquire:atAcquire,
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
