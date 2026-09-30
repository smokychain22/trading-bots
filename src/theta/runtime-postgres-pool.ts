import { Pool } from 'pg';
import { classifyPostgresRuntimeError } from './postgres-runtime-error.js';

/** An idle connection can disappear during an Aiven rebalance. pg removes the
 * failed client, but an unhandled pool error would terminate the runtime. */
export interface RuntimePostgresPoolOptions {
  readonly maximumConnections?: number;
  readonly applicationName?: string;
  readonly connectionTimeoutMillis?: number;
}

const containedPools = new WeakSet<Pool>();

/** Attach the same error containment to request-owned pools without changing
 * their capacity, timeout policy, acquisition behavior or lifetime ownership. */
export function containRuntimePostgresPool<T extends Pool>(pool: T,
  report: (code: string) => void = (code) => { console.warn('THETA_RUNTIME_DATABASE_IDLE_CLIENT_ERROR', code); }): T {
  if (containedPools.has(pool)) return pool;
  containedPools.add(pool);
  const safeReport = (code: string): void => {
    try { report(code); }
    catch { console.warn('POSTGRES_ERROR_REPORTER_FAILED'); }
  };
  pool.on('error', (error: Error & { code?: unknown }) => {
    const classification = classifyPostgresRuntimeError(error);
    safeReport(classification.safeCode === 'POSTGRES_UNKNOWN_ERROR'
      ? 'POSTGRES_IDLE_CONNECTION_ERROR' : classification.safeCode);
  });
  // This contains EventEmitter escalation only. The query/wrapper still owns
  // rejection and disposal. No retry, successful result or healthy state is made.
  pool.on('connect', (client) => {
    client.on('error', (error: Error & { code?: unknown }) => {
      const classification = classifyPostgresRuntimeError(error);
      safeReport(classification.safeCode === 'POSTGRES_UNKNOWN_ERROR'
        ? 'POSTGRES_CHECKED_OUT_CONNECTION_ERROR' : classification.safeCode);
    });
  });
  return pool;
}

export function createRuntimePostgresPool(connectionString: string,
  report: (code: string) => void = (code) => { console.warn('THETA_RUNTIME_DATABASE_IDLE_CLIENT_ERROR', code); },
  options: RuntimePostgresPoolOptions = {}): Pool {
  if (options.maximumConnections !== undefined
    && (!Number.isSafeInteger(options.maximumConnections) || options.maximumConnections < 1)) {
    throw new Error('POSTGRES_POOL_MAX_INVALID');
  }
  if (options.connectionTimeoutMillis !== undefined
    && (!Number.isSafeInteger(options.connectionTimeoutMillis) || options.connectionTimeoutMillis < 1)) {
    throw new Error('POSTGRES_CONNECTION_TIMEOUT_INVALID');
  }
  const maximumConnections=Math.max(1,Math.min(4,options.maximumConnections??2));
  const pool = new Pool({ connectionString,
    idleTimeoutMillis: 10_000, maxLifetimeSeconds: 60,
    application_name:options.applicationName??'theta-runtime',
    max:maximumConnections,connectionTimeoutMillis:options.connectionTimeoutMillis??8_000 });
  return containRuntimePostgresPool(pool, report);
}
