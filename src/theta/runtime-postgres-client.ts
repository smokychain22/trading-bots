import type { Pool, PoolClient } from 'pg';
import { classifyPostgresRuntimeError, PostgresCommitOutcomeUnknownError } from './postgres-runtime-error.js';

export class PostgresCheckedOutClientLostError extends Error {
  readonly code = 'POSTGRES_CHECKED_OUT_CLIENT_LOST';
  constructor() { super('POSTGRES_CHECKED_OUT_CLIENT_LOST'); }
}

/** Covers the EventEmitter error path, which a pool's idle-client listener cannot see. */
export async function withRuntimePostgresClient<T>(pool: Pool, operation: (client: PoolClient, discard: () => void) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  const onError = (): void => { broken = true; };
  client.on('error', onError);
  try {
    const result = await operation(client, () => { broken = true; });
    if (broken) throw new PostgresCheckedOutClientLostError();
    return result;
  } catch (error) {
    if (classifyPostgresRuntimeError(error).retryableRead || error instanceof PostgresCheckedOutClientLostError
      || error instanceof PostgresCommitOutcomeUnknownError) broken = true;
    throw error;
  } finally {
    client.removeListener('error', onError);
    client.release(broken);
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
    readonly random?: () => number } = {}): Promise<PostgresReadRetryReceipt<T>> {
  const maximumAttempts = Math.max(1, Math.min(3, options.maximumAttempts ?? 3));
  let firstFailureAt: string | null = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const value = await withRuntimePostgresClient(pool, operation);
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
