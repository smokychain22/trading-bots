import type { Environment } from '../config/environment.js';
import { classifyDatabaseTargetError } from '../database/target-preflight.js';
import { classifyPostgresRuntimeError } from './postgres-runtime-error.js';

/** Convert provider/database failures into bounded receipt codes without exposing messages or URLs. */
export function classifyNoSubmitProbeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/^[A-Z0-9_]{3,100}$/.test(message)) return message;
  const postgres = classifyPostgresRuntimeError(error);
  if (postgres.safeCode !== 'POSTGRES_UNKNOWN_ERROR') return postgres.safeCode;
  const database = classifyDatabaseTargetError(error);
  if (database.failureCode !== 'UNKNOWN')
    return `DATABASE_${database.failureClass}_${database.failureCode}`;
  return 'UNCLASSIFIED_NO_SUBMIT_FAILURE';
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
