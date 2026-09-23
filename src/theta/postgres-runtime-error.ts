export type PostgresRuntimeErrorClass =
  | 'TRANSIENT_CONNECTION' | 'TRANSIENT_SERVER_UNAVAILABLE'
  | 'TRANSACTION_ABORTED' | 'CONSTRAINT_ERROR' | 'QUERY_ERROR'
  | 'AUTH_ERROR' | 'UNKNOWN_DATABASE_ERROR';

export interface PostgresRuntimeErrorClassification {
  readonly errorClass: PostgresRuntimeErrorClass;
  readonly safeCode: string;
  readonly retryableRead: boolean;
}

const connectionCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);
const connectionMessages = /(?:socket hang up|connection terminated|server closed the connection unexpectedly|SSL.*EOF|connection ended unexpectedly)/i;

/** Never include a provider message in a receipt: it can contain a connection URL. */
export function classifyPostgresRuntimeError(error: unknown): PostgresRuntimeErrorClassification {
  const value = error !== null && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof value.code === 'string' ? value.code : '';
  if (code === 'POSTGRES_CHECKED_OUT_CLIENT_LOST') return {
    errorClass: 'TRANSIENT_CONNECTION', safeCode: code, retryableRead: true,
  };
  if (code === 'POSTGRES_COMMIT_OUTCOME_UNKNOWN') return {
    errorClass: 'UNKNOWN_DATABASE_ERROR', safeCode: code, retryableRead: false,
  };
  if (code === '57P03' || code === '57P01') return {
    errorClass: 'TRANSIENT_SERVER_UNAVAILABLE', safeCode: `POSTGRES_${code}`, retryableRead: true,
  };
  if (code.startsWith('08') && /^[0-9A-Z]{5}$/.test(code)) return {
    errorClass: 'TRANSIENT_CONNECTION', safeCode: `POSTGRES_${code}`, retryableRead: true,
  };
  if (connectionCodes.has(code) || (typeof value.message === 'string' && connectionMessages.test(value.message))) return {
    errorClass: 'TRANSIENT_CONNECTION', safeCode: connectionCodes.has(code) ? `POSTGRES_${code}` : 'POSTGRES_CONNECTION_TERMINATED',
    retryableRead: true,
  };
  if (code === '25P02' || code === '40001' || code === '40P01') return {
    errorClass: 'TRANSACTION_ABORTED', safeCode: `POSTGRES_${code}`, retryableRead: false,
  };
  if (code.startsWith('23') && /^[0-9A-Z]{5}$/.test(code)) return {
    errorClass: 'CONSTRAINT_ERROR', safeCode: `POSTGRES_${code}`, retryableRead: false,
  };
  if (code === '28P01' || code === '28000') return {
    errorClass: 'AUTH_ERROR', safeCode: `POSTGRES_${code}`, retryableRead: false,
  };
  if (/^[0-9A-Z]{5}$/.test(code)) return {
    errorClass: 'QUERY_ERROR', safeCode: `POSTGRES_${code}`, retryableRead: false,
  };
  return { errorClass: 'UNKNOWN_DATABASE_ERROR', safeCode: 'POSTGRES_UNKNOWN_ERROR', retryableRead: false };
}

export class PostgresCommitOutcomeUnknownError extends Error {
  readonly code = 'POSTGRES_COMMIT_OUTCOME_UNKNOWN';
  constructor() { super('POSTGRES_COMMIT_OUTCOME_UNKNOWN'); }
}
