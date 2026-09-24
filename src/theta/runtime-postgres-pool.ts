import { Pool } from 'pg';
import { classifyPostgresRuntimeError } from './postgres-runtime-error.js';

/** An idle connection can disappear during an Aiven rebalance. pg removes the
 * failed client, but an unhandled pool error would terminate the runtime. */
export function createRuntimePostgresPool(connectionString: string,
  report: (code: string) => void = (code) => { console.warn('THETA_RUNTIME_DATABASE_IDLE_CLIENT_ERROR', code); }): Pool {
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 10_000, maxLifetimeSeconds: 60 });
  pool.on('error', (error: Error & { code?: unknown }) => {
    const classification = classifyPostgresRuntimeError(error);
    report(classification.safeCode === 'POSTGRES_UNKNOWN_ERROR'
      ? 'POSTGRES_IDLE_CONNECTION_ERROR' : classification.safeCode);
  });
  // Pool-level `error` covers only idle clients. Aiven can terminate a client
  // while it is checked out by pool.query or a runtime store. Without an
  // explicit client listener, EventEmitter escalates that provider failure to
  // uncaughtException before the awaited operation can reject and enter the
  // database-independent fallback. This listener only reports a safe code.
  // The query/wrapper still owns rejection and broken-client disposal.
  pool.on('connect', (client) => {
    client.on('error', (error: Error & { code?: unknown }) => {
      const classification = classifyPostgresRuntimeError(error);
      report(classification.safeCode === 'POSTGRES_UNKNOWN_ERROR'
        ? 'POSTGRES_CHECKED_OUT_CONNECTION_ERROR' : classification.safeCode);
    });
  });
  return pool;
}
