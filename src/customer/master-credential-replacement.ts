import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Environment } from '../config/environment.js';
import { withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { readOnlyMasterCredentialStoreFromPool, type StoredMasterCredential } from './customer-store.js';
import { decryptSecret, encryptSecret, type EncryptedSecret } from './customer-security.js';
import { privatePaperCredentialSchema } from './private-paper-api-key.js';
import { verifyAlpacaPaperAccount } from './alpaca-paper-verification.js';

// Private operational material. Never log or publish prepared replacements or
// rollback records. This module has no HTTP route or automatic runtime caller.
export interface MasterCredentialReplacement {
  readonly customerId: string;
  readonly providerAccountRef: string;
  readonly keyRef: string;
  readonly previousHash: string;
  readonly replacement: EncryptedSecret;
  readonly verifiedAt: number;
}

function fingerprint(secret: EncryptedSecret): string {
  return createHash('sha256').update(secret.iv).update(secret.authTag).update(secret.ciphertext).digest('hex');
}

function assertEncryption(stored: StoredMasterCredential, environment: Environment): void {
  if (stored.keyRef !== environment.PAPER_COPY_TOKEN_KEY_REF)
    throw new Error('MASTER_CREDENTIAL_KEY_VERSION_MISMATCH');
  // Prove this is the existing key before encrypting a replacement. Parsing the
  // decrypted bundle also rejects a valid AES key paired with malformed data.
  let bundle: unknown;
  try { bundle = JSON.parse(decryptSecret(stored, environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ?? '', stored.customerId)); }
  catch { throw new Error('MASTER_EXISTING_ENCRYPTION_UNAVAILABLE'); }
  const value = bundle as { apiKeyId?: unknown; apiSecret?: unknown } | null;
  if (!value || typeof value.apiKeyId !== 'string' || !value.apiKeyId
    || typeof value.apiSecret !== 'string' || !value.apiSecret)
    throw new Error('MASTER_EXISTING_CREDENTIAL_MALFORMED');
}

export async function prepareMasterCredentialReplacement(
  pool: Pool, environment: Environment, raw: unknown, fetchImpl: typeof fetch = fetch,
): Promise<MasterCredentialReplacement> {
  const stored = await readOnlyMasterCredentialStoreFromPool(pool).getMasterCredential();
  if (!stored) throw new Error('MASTER_CREDENTIAL_NOT_FOUND');
  assertEncryption(stored, environment);
  const input = privatePaperCredentialSchema.parse(raw);
  const verified = await verifyAlpacaPaperAccount({ kind: 'MASTER_API_KEY',
    apiKey: input.api_key_id, apiSecret: input.secret_key }, fetchImpl);
  if (verified.account.id !== stored.providerAccountRef) throw new Error('MASTER_IDENTITY_IMMUTABLE');
  if (!verified.ready || verified.account.trading_blocked !== false || verified.account.account_blocked !== false)
    throw new Error('MASTER_REPLACEMENT_ACCOUNT_NOT_QUALIFIED');
  return { customerId: stored.customerId, providerAccountRef: stored.providerAccountRef,
    keyRef: stored.keyRef, previousHash: fingerprint(stored), verifiedAt: Date.now(),
    replacement: encryptSecret(JSON.stringify({ apiKeyId: input.api_key_id, apiSecret: input.secret_key }),
      environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ?? '', stored.customerId) };
}

export async function applyMasterCredentialReplacement(
  pool: Pool, environment: Environment, prepared: MasterCredentialReplacement,
  preserveRollback: (previous: StoredMasterCredential & { readonly tokenSecretId: string }) => Promise<void>,
  beforeWrite?: (client: PoolClient) => Promise<void>,
): Promise<{ readonly credentialUpdated: true }> {
  const age = Date.now() - prepared.verifiedAt;
  if (!Number.isFinite(age) || age < 0 || age > 60_000) throw new Error('MASTER_REPLACEMENT_VERIFICATION_STALE');
  return withRuntimePostgresTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(863801010)');
    const result = await client.query(`SELECT t.token_secret_id,t.customer_id,t.key_ref,t.ciphertext,t.iv,t.auth_tag,
      f.provider_account_ref,f.connection_method,f.connection_status,f.account_ready
      FROM copy.follower_account f JOIN copy.alpaca_oauth_token t ON t.token_secret_id=f.token_secret_id
      WHERE f.account_role='MASTER_THETA_PAPER' AND f.environment='PAPER' AND f.disconnected_at IS NULL
        AND t.revoked_at IS NULL AND t.customer_id=f.customer_id FOR UPDATE OF f,t`);
    if (result.rowCount !== 1) throw new Error('MASTER_CREDENTIAL_AMBIGUOUS');
    const row = result.rows[0];
    const stored: StoredMasterCredential = { customerId: String(row.customer_id),
      providerAccountRef: String(row.provider_account_ref), keyRef: String(row.key_ref),
      connectionMethod: row.connection_method, ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag };
    if (stored.customerId !== prepared.customerId || stored.providerAccountRef !== prepared.providerAccountRef
      || stored.keyRef !== prepared.keyRef || stored.connectionMethod !== 'PAPER_API_KEY_PRIVATE_BETA'
      || row.connection_status !== 'CONNECTED' || row.account_ready !== true)
      throw new Error('MASTER_REPLACEMENT_IDENTITY_CHANGED');
    assertEncryption(stored, environment);
    if (fingerprint(stored) !== prepared.previousHash) throw new Error('MASTER_CREDENTIAL_CONCURRENT_UPDATE');
    // A protected, durable ciphertext-only rollback copy must be verified before
    // any write. A failed preservation callback rolls back without touching data.
    await preserveRollback({ ...stored, tokenSecretId: String(row.token_secret_id) });
    if (Date.now() - prepared.verifiedAt > 60_000) throw new Error('MASTER_REPLACEMENT_VERIFICATION_STALE');
    await beforeWrite?.(client);
    const changed = await client.query(`UPDATE copy.alpaca_oauth_token SET ciphertext=$1,iv=$2,auth_tag=$3
      WHERE token_secret_id=$4 AND customer_id=$5 AND key_ref=$6 AND revoked_at IS NULL
        AND ciphertext=$7 AND iv=$8 AND auth_tag=$9 RETURNING token_secret_id`,
    [prepared.replacement.ciphertext, prepared.replacement.iv, prepared.replacement.authTag,
      row.token_secret_id, stored.customerId, stored.keyRef, stored.ciphertext, stored.iv, stored.authTag]);
    if (changed.rowCount !== 1) throw new Error('MASTER_CREDENTIAL_CONCURRENT_UPDATE');
    return { credentialUpdated: true as const };
  });
}
