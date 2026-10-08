import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Environment } from '../config/environment.js';
import { withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { readOnlyMasterCredentialStoreFromPool } from './customer-store.js';
import { MasterEncryptedStoreBrokerCredentialProvider } from './broker-credential-provider.js';
import { verifyAlpacaPaperAccount } from './alpaca-paper-verification.js';
import { applyMasterCredentialReplacement, prepareMasterCredentialReplacement } from './master-credential-replacement.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const recoveryPermitSchema = z.object({
  authorizationId: z.string().uuid(), sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  accountHash: digest, previousCiphertextHash: digest, rollbackFileHash: digest,
  ownerPublicKey: z.string().min(40).max(500), notBefore: z.number().int(), expiresAt: z.number().int(),
}).strict();
export type RecoveryPermit = z.infer<typeof recoveryPermitSchema>;
const bodySchema = z.object({ authorizationId: z.string().uuid(),
  api_key_id: z.string().min(1).max(256), secret_key: z.string().min(1).max(256) }).strict();

export function recoverySignaturePayload(host: string, permit: RecoveryPermit, body: string): Buffer {
  return Buffer.from(JSON.stringify(['THETA_MASTER_RECOVERY_V1', host, permit, hash(body)]));
}

/** No public application route imports this module. Its standalone deployment
 * must be protected by Vercel Authentication and a private owner signing key. */
export function authorizeRecovery(input: {
  method: string; url: string; authorization: string; signature: string; body: string;
}, permitInput: unknown, runtime: {
  vercelEnvironment: string | undefined; deploymentHost: string | undefined;
  operatorToken: string | undefined; now: number;
}): RecoveryPermit {
  const permit = recoveryPermitSchema.parse(permitInput);
  if (runtime.vercelEnvironment !== 'production' || !runtime.deploymentHost)
    throw new Error('RECOVERY_PRODUCTION_TARGET_REQUIRED');
  const url = new URL(input.url);
  if (input.method !== 'POST' || url.protocol !== 'https:' || url.host !== runtime.deploymentHost
    || url.pathname !== '/api/recover-master' || url.search || url.hash || url.username || url.password)
    throw new Error('RECOVERY_TRANSPORT_REJECTED');
  const expected = runtime.operatorToken ?? '';
  const actual = input.authorization.startsWith('Bearer ') ? input.authorization.slice(7) : '';
  if (expected.length < 32 || actual.length !== expected.length
    || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new Error('RECOVERY_OWNER_AUTH_REQUIRED');
  if (!Number.isSafeInteger(runtime.now) || permit.expiresAt <= permit.notBefore
    || permit.expiresAt - permit.notBefore > 300_000
    || runtime.now < permit.notBefore || runtime.now >= permit.expiresAt) throw new Error('RECOVERY_PERMIT_EXPIRED');
  if (Buffer.byteLength(input.body) > 2048 || !/^[A-Za-z0-9+/]{86}==$/.test(input.signature))
    throw new Error('RECOVERY_REQUEST_REJECTED');
  let valid = false;
  try {
    if (createPublicKey(permit.ownerPublicKey).asymmetricKeyType !== 'ed25519')
      throw new Error('RECOVERY_SIGNATURE_ALGORITHM_REJECTED');
    valid = verify(null, recoverySignaturePayload(url.host, permit, input.body), permit.ownerPublicKey,
      Buffer.from(input.signature, 'base64'));
  } catch { /* Never include crypto errors or request values in a response. */ }
  if (!valid) throw new Error('RECOVERY_SIGNATURE_REJECTED');
  const body = bodySchema.parse(JSON.parse(input.body));
  if (body.authorizationId !== permit.authorizationId) throw new Error('RECOVERY_AUTHORIZATION_MISMATCH');
  return permit;
}

/** Burn the permit before any provider call or credential write. An interrupted
 * or failed attempt cannot be replayed on another serverless instance. This
 * audit insertion requires explicit approval in the deployment plan. */
export async function claimRecoveryPermit(pool: Pool, permit: RecoveryPermit): Promise<void> {
  await withRuntimePostgresTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(863801010)');
    const previous = await client.query(`SELECT operator_audit_event_id FROM copy.operator_audit_event
      WHERE action='MASTER_CREDENTIAL_RECOVERY_CLAIM' AND request_id=$1`, [permit.authorizationId]);
    if (previous.rowCount !== 0) throw new Error('RECOVERY_PERMIT_ALREADY_CONSUMED');
    await client.query(`INSERT INTO copy.operator_audit_event
      (operator_subject,action,target_type,target_id,request_id,result,metadata_json)
      VALUES ('SIGNED_OWNER','MASTER_CREDENTIAL_RECOVERY_CLAIM','EXISTING_MASTER',NULL,$1,'CONSUMED',$2::jsonb)`,
    [permit.authorizationId, JSON.stringify({ sourceSha: permit.sourceSha, accountHash: permit.accountHash,
      previousCiphertextHash: permit.previousCiphertextHash, rollbackFileHash: permit.rollbackFileHash })]);
  });
}

/** GET-only, fixed-host, no redirects, even if a future adapter gains mutations. */
export function recoveryReadOnlyFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method !== 'GET' || url.origin !== 'https://paper-api.alpaca.markets'
      || !['/v2/account', '/v2/positions', '/v2/orders', '/v2/clock', '/v2/calendar'].includes(url.pathname))
      throw new Error('RECOVERY_BROKER_SURFACE_REJECTED');
    return fetchImpl(input, { ...init, redirect: 'error' });
  }) as typeof fetch;
}

export async function executeMasterRecovery(pool: Pool, environment: Environment, permit: RecoveryPermit,
  raw: unknown, fetchImpl: typeof fetch = fetch): Promise<{ status: 'VERIFIED'; identity: 'ORIGINAL_MASTER'; brokerMutations: 0 }> {
  const input = bodySchema.parse(raw);
  if (input.authorizationId !== permit.authorizationId) throw new Error('RECOVERY_AUTHORIZATION_MISMATCH');
  // Require a known, complete no-submit state. A provider outage is not a lock.
  if (environment.MASTER_PAPER_EXECUTION_ENABLED !== false || environment.FOLLOWER_PAPER_EXECUTION_ENABLED !== false
    || environment.PAPER_PAUSE_NEW_ORDERS !== true) throw new Error('RECOVERY_EXECUTION_NOT_LOCKED');
  const control = await pool.query(`SELECT pause_new_orders,master_execution_enabled,follower_execution_enabled
    FROM ops.paper_execution_control WHERE singleton=true`);
  if (control.rowCount !== 1 || control.rows[0].pause_new_orders !== true
    || control.rows[0].master_execution_enabled !== false || control.rows[0].follower_execution_enabled !== false)
    throw new Error('RECOVERY_DURABLE_EXECUTION_NOT_LOCKED');
  const readOnly = recoveryReadOnlyFetch(fetchImpl);
  const stored = await readOnlyMasterCredentialStoreFromPool(pool).getMasterCredential();
  if (!stored || hash(stored.providerAccountRef) !== permit.accountHash
    || createHash('sha256').update(stored.iv).update(stored.authTag).update(stored.ciphertext).digest('hex') !== permit.previousCiphertextHash)
    throw new Error('RECOVERY_PINNED_IDENTITY_OR_ROLLBACK_CHANGED');
  await claimRecoveryPermit(pool, permit);
  const prepared = await prepareMasterCredentialReplacement(pool, environment, {
    api_key_id: input.api_key_id, secret_key: input.secret_key,
  }, readOnly);
  if (hash(prepared.providerAccountRef) !== permit.accountHash || prepared.previousHash !== permit.previousCiphertextHash)
    throw new Error('RECOVERY_PINNED_IDENTITY_OR_ROLLBACK_CHANGED');
  await applyMasterCredentialReplacement(pool, environment, prepared, async previous => {
    const previousHash = createHash('sha256').update(previous.iv).update(previous.authTag).update(previous.ciphertext).digest('hex');
    if (previousHash !== permit.previousCiphertextHash || hash(previous.providerAccountRef) !== permit.accountHash)
      throw new Error('RECOVERY_ROLLBACK_PIN_MISMATCH');
  }, async client => {
    if (Date.now() >= permit.expiresAt) throw new Error('RECOVERY_PERMIT_EXPIRED');
    const locked = await client.query(`SELECT pause_new_orders,master_execution_enabled,follower_execution_enabled
      FROM ops.paper_execution_control WHERE singleton=true FOR SHARE`);
    if (locked.rowCount !== 1 || locked.rows[0].pause_new_orders !== true
      || locked.rows[0].master_execution_enabled !== false || locked.rows[0].follower_execution_enabled !== false)
      throw new Error('RECOVERY_DURABLE_EXECUTION_NOT_LOCKED');
  });
  const auth = await new MasterEncryptedStoreBrokerCredentialProvider(readOnlyMasterCredentialStoreFromPool(pool), environment)
    .getAuthentication();
  if (!auth || hash(auth.providerAccountRef) !== permit.accountHash) throw new Error('RECOVERY_POST_WRITE_IDENTITY_FAILED');
  const verified = await verifyAlpacaPaperAccount(auth.authentication, readOnly);
  if (hash(verified.account.id) !== permit.accountHash || !verified.ready)
    throw new Error('RECOVERY_POST_WRITE_VERIFICATION_FAILED');
  return { status: 'VERIFIED', identity: 'ORIGINAL_MASTER', brokerMutations: 0 };
}
