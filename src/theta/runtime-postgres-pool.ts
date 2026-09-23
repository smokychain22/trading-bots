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
  return pool;
}
