import type { Environment } from '../config/environment.js';
import { classifyDatabaseTargetError } from '../database/target-preflight.js';
import { classifyPostgresRuntimeError } from './postgres-runtime-error.js';

/** Convert provider/database failures into bounded receipt codes without exposing messages or URLs. */
export function classifyNoSubmitProbeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/^[A-Z0-9_]{3,100}$/.test(message)) return message;
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code).toUpperCase() : '';
  // Preserve the established target-level DNS category in operator receipts.
  // The shared runtime classifier still treats EAI_AGAIN as a transient
  // connection error for bounded read retry and broken-client disposal.
  if (code === 'EAI_AGAIN') return 'DATABASE_DNS_EAI_AGAIN';
  const postgres = classifyPostgresRuntimeError(error);
  if (postgres.safeCode !== 'POSTGRES_UNKNOWN_ERROR') return postgres.safeCode;
  const database = classifyDatabaseTargetError(error);
  if (database.failureClass !== 'UNKNOWN')
    return `DATABASE_${database.failureClass}_${database.failureCode}`;
  // Never echo a provider payload or exception message. These families retain
  // the failed decision stage while the probe receipt separately records its
  // bounded probeStage.
  const normalized = `${error instanceof Error ? error.name : ''} ${message}`.toUpperCase();
  if (/QUOTE|\bBBO\b|OPTION SNAPSHOT|MARKET SNAPSHOT|EXECUTABLE PRICE/.test(normalized))
    return 'QUOTE_PIPELINE_FAILURE';
  if (/EARNINGS|CORPORATE ACTION|CORPORATE_ACTION|DIVIDEND|\bEVENT\b/.test(normalized))
    return 'EVENT_EVIDENCE_FAILURE';
  if (/AEGIS|STRESS BASELINE|STRESS DETECTOR/.test(normalized)) return 'AEGIS_FAILURE';
  if (/SIZING|QUANTITY|COLLATERAL CAPACITY|ASSIGNMENT CAPACITY/.test(normalized))
    return 'SIZING_FAILURE';
  if (/PAPER PLAN|PAPER_PLAN|ACTION PLAN|ACTION_PLAN|PLAN ASSEMBLY/.test(normalized))
    return 'PAPER_PLAN_FAILURE';
  if (/ZODERROR|VALIDATION|MALFORMED RESPONSE|RESPONSE INVALID/.test(normalized))
    return 'PROVIDER_RESPONSE_VALIDATION_FAILURE';
  if (/FETCH|NETWORK|SOCKET|TIMEOUT|HTTP|ALPACA|OPTIONOMICS/.test(normalized)
    || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR/.test(code)) return 'PROVIDER_TRANSPORT_FAILURE';
  return 'UNCLASSIFIED_NO_SUBMIT_FAILURE';
}

/** A bounded safe category can survive an intermediate wrapper that did not
 * retain the original driver `code`. Keep this family aligned with the local
 * supervisor and never retry SQL, auth, or ambiguous COMMIT failures. */
export function isRetryableNoSubmitDatabaseFailure(error:unknown,safeCategory?:string):boolean{
  if(classifyPostgresRuntimeError(error).retryableRead)return true;
  const category=safeCategory??classifyNoSubmitProbeError(error);
  return /^POSTGRES_(?:57P03|57P01|08[0-9A-Z]{3}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|CONNECTION_TERMINATED|CHECKED_OUT_CLIENT_LOST)$/.test(category);
}

/** Bound an operational diagnostic stage. A timeout remains a typed failure.
 * The caller must persist it and keep broker mutation disabled. */
export async function runNoSubmitStageWithDeadline<T>(
  operation:Promise<T>,milliseconds:number,code:string,
):Promise<T>{
  if(!Number.isInteger(milliseconds)||milliseconds<1||!/^[A-Z0-9_]{3,100}$/.test(code))
    throw new Error('NO_SUBMIT_PROBE_DEADLINE_CONFIGURATION_INVALID');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<T>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error(code)),milliseconds);
    timer.unref?.();
  })]);}finally{if(timer!==undefined)clearTimeout(timer);}
}

/** A source-level lock independent of persisted authorization or operator UI. */
export function assertNoSubmitProbeGuard(environment: Pick<Environment,
  'THETA_RUNTIME_MODE' | 'MASTER_PAPER_EXECUTION_ENABLED' | 'FOLLOWER_PAPER_EXECUTION_ENABLED'
  | 'PAPER_PAUSE_NEW_ORDERS' | 'ALPACA_BASE_URL' | 'DATABASE_URL' | 'AIVEN_DATABASE_URL'>): void {
  if (environment.THETA_RUNTIME_MODE !== 'MASTER_THETA_PAPER'
    || environment.MASTER_PAPER_EXECUTION_ENABLED !== false
    || environment.FOLLOWER_PAPER_EXECUTION_ENABLED !== false
    || environment.PAPER_PAUSE_NEW_ORDERS !== true) {
    throw new Error('NO_SUBMIT_PROBE_EXECUTION_LOCKS_REQUIRED');
  }
  let broker: URL, runtimeDatabase: URL, aiven: URL;
  try {
    broker = new URL(environment.ALPACA_BASE_URL ?? '');
    runtimeDatabase = new URL(environment.DATABASE_URL ?? '');
    aiven = new URL(environment.AIVEN_DATABASE_URL ?? '');
  } catch {
    throw new Error('NO_SUBMIT_PROBE_TARGET_INVALID');
  }
  if (broker.protocol !== 'https:' || broker.hostname !== 'paper-api.alpaca.markets'
    || broker.port || !['', '/'].includes(broker.pathname) || broker.search || broker.hash) {
    throw new Error('NO_SUBMIT_PROBE_PAPER_BROKER_REQUIRED');
  }
  if (runtimeDatabase.protocol !== 'postgres:' && runtimeDatabase.protocol !== 'postgresql:')
    throw new Error('NO_SUBMIT_PROBE_AIVEN_DATABASE_REQUIRED');
  if (runtimeDatabase.host !== aiven.host || runtimeDatabase.pathname !== aiven.pathname) {
    throw new Error('NO_SUBMIT_PROBE_AIVEN_DATABASE_REQUIRED');
  }
}
