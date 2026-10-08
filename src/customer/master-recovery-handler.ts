import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { loadEnvironment } from '../config/environment.js';
import { createRuntimePostgresPool } from '../theta/runtime-postgres-pool.js';
import { classifyPostgresRuntimeError } from '../theta/postgres-runtime-error.js';
import { AlpacaPaperBrokerError } from '../execution/broker.js';
import { authorizeRecovery, executeMasterRecovery, type RecoveryPermit } from './master-credential-recovery.js';

const safeReasons = new Set([
  'RECOVERY_REQUEST_REJECTED', 'RECOVERY_PRODUCTION_TARGET_REQUIRED', 'RECOVERY_TRANSPORT_REJECTED',
  'RECOVERY_OWNER_AUTH_REQUIRED', 'RECOVERY_PERMIT_EXPIRED', 'RECOVERY_SIGNATURE_REJECTED',
  'RECOVERY_AUTHORIZATION_MISMATCH', 'RECOVERY_DATABASE_UNAVAILABLE', 'RECOVERY_PERMIT_ALREADY_CONSUMED',
  'RECOVERY_EXECUTION_CONTROL_UNKNOWN_OR_ACTIVE', 'RECOVERY_EXECUTION_NOT_LOCKED',
  'RECOVERY_DURABLE_EXECUTION_NOT_LOCKED', 'RECOVERY_PINNED_IDENTITY_OR_ROLLBACK_CHANGED',
  'RECOVERY_ROLLBACK_PIN_MISMATCH', 'RECOVERY_POST_WRITE_IDENTITY_FAILED', 'RECOVERY_POST_WRITE_VERIFICATION_FAILED',
  'MASTER_CREDENTIAL_NOT_FOUND', 'MASTER_CREDENTIAL_AMBIGUOUS', 'MASTER_CREDENTIAL_KEY_VERSION_MISMATCH',
  'MASTER_EXISTING_ENCRYPTION_UNAVAILABLE', 'MASTER_EXISTING_CREDENTIAL_MALFORMED', 'MASTER_IDENTITY_IMMUTABLE',
  'MASTER_REPLACEMENT_ACCOUNT_NOT_QUALIFIED', 'MASTER_REPLACEMENT_VERIFICATION_STALE',
  'MASTER_REPLACEMENT_IDENTITY_CHANGED', 'MASTER_CREDENTIAL_CONCURRENT_UPDATE',
]);
/** Validate a received redacted receipt without trusting arbitrary server text. */
export function sanitizeRecoveryReceiptReason(reason: string): string {
  if (safeReasons.has(reason) || reason === 'RECOVERY_FAILURE_UNCLASSIFIED') return reason;
  if (/^ALPACA_(INVALID_AUTH|NOT_ENTITLED|RATE_LIMITED|BROKER_REJECTED|AMBIGUOUS_NETWORK|MALFORMED_RESPONSE)$/.test(reason))
    return reason;
  if (reason.startsWith('POSTGRES_')) {
    if (['POSTGRES_CONNECTION_TERMINATED', 'POSTGRES_CHECKED_OUT_CLIENT_LOST',
      'POSTGRES_COMMIT_OUTCOME_UNKNOWN', 'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT', 'POSTGRES_UNKNOWN_ERROR'].includes(reason))
      return reason;
    const classified = classifyPostgresRuntimeError({ code: reason.slice('POSTGRES_'.length) });
    if (classified.safeCode === reason) return reason;
  }
  return 'RECOVERY_FAILURE_UNCLASSIFIED';
}
export function recoveryFailureReason(error: unknown): string {
  if (error instanceof Error && safeReasons.has(error.message)) return error.message;
  if (error instanceof AlpacaPaperBrokerError) {
    // Category is a closed adapter enum, never include the provider message.
    return `ALPACA_${error.category}`;
  }
  const postgres = classifyPostgresRuntimeError(error);
  return postgres.safeCode === 'POSTGRES_UNKNOWN_ERROR' ? 'RECOVERY_FAILURE_UNCLASSIFIED' : postgres.safeCode;
}

/** Vercel's Node helper restores consumed raw bytes by replacing read/on, not
 * the original stream's ended/destroyed state. Event reads preserve those
 * bytes. Async iteration over that original stream can silently yield nothing.
 * Never reconstruct signed bytes from the parsed request.body object. */
export function readRecoveryBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = []; let size = 0; let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      request.removeListener('error', failed);
      request.removeListener('aborted', failed);
      if (error) { buffers.length = 0; reject(error); }
      else resolve(Buffer.concat(buffers).toString('utf8'));
    };
    const failed = () => finish(new Error('RECOVERY_REQUEST_REJECTED'));
    const deadline = setTimeout(failed, 10_000);
    request.on('error', failed);
    request.on('aborted', failed);
    request.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 2048) { failed(); return; }
      buffers.push(buffer);
    });
    request.on('end', () => finish());
  });
}

/** Imported only by the private recovery artifact, never api/ or index.ts. */
export function createMasterRecoveryHandler(permit: RecoveryPermit, runtime: NodeJS.ProcessEnv,
  poolFactory: typeof createRuntimePostgresPool = createRuntimePostgresPool) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let pool: Pool | undefined;
    let phase = 'AUTHORIZATION';
    try {
      if (request.headers['x-forwarded-proto'] !== 'https') throw new Error('RECOVERY_TRANSPORT_REJECTED');
      if (request.headers['content-type'] !== 'application/json') throw new Error('RECOVERY_REQUEST_REJECTED');
      const body = await readRecoveryBody(request);
      const approved = authorizeRecovery({ method: request.method ?? '',
        url: `https://${request.headers.host}${request.url}`, body,
        authorization: String(request.headers.authorization ?? ''),
        signature: String(request.headers['x-theta-recovery-signature'] ?? '') }, permit, {
        vercelEnvironment: runtime.VERCEL_ENV, deploymentHost: runtime.VERCEL_URL,
        operatorToken: runtime.CRON_SECRET, now: Date.now(),
      });
      // Validate raw flags before the configuration parser can supply defaults.
      // Durable controls must still prove a full lock inside the recovery path.
      if (!['true', 'false'].includes(runtime.MASTER_PAPER_EXECUTION_ENABLED ?? '')
        || runtime.FOLLOWER_PAPER_EXECUTION_ENABLED !== 'false'
        || !['true', 'false'].includes(runtime.PAPER_PAUSE_NEW_ORDERS ?? ''))
        throw new Error('RECOVERY_EXECUTION_CONTROL_UNKNOWN_OR_ACTIVE');
      const environment = loadEnvironment(runtime);
      const url = environment.DATABASE_RUNTIME_AUTHORITY === 'AIVEN'
        ? environment.AIVEN_DATABASE_URL : environment.DATABASE_URL;
      if (!url) throw new Error('RECOVERY_DATABASE_UNAVAILABLE');
      phase = 'RECOVERY';
      pool = poolFactory(url, () => {}, { maximumConnections: 1, applicationName: 'theta-credential-recovery' });
      const result = await executeMasterRecovery(pool, environment, approved, JSON.parse(body));
      response.statusCode = 200;
      response.end(JSON.stringify(result));
    } catch (error) {
      // No raw exception, request, provider body, DB parameters or secrets.
      // Any recovery failure requires read-only diagnosis, never blind replay.
      response.statusCode = phase === 'AUTHORIZATION' ? 403 : 409;
      response.end(JSON.stringify({ status: 'REJECTED_OR_INCOMPLETE', phase,
        reason: recoveryFailureReason(error),
        credentialWriteMayHaveCommitted: phase === 'RECOVERY', automaticRetry: false, brokerMutations: 0 }));
    } finally {
      if (pool) { try { await pool.end(); } catch { /* No raw errors in runtime logs. */ } }
    }
  };
}
