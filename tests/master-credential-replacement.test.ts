import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { Environment } from '../src/config/environment.js';
import { encryptSecret, decryptSecret } from '../src/customer/customer-security.js';
import { prepareMasterCredentialReplacement, applyMasterCredentialReplacement } from '../src/customer/master-credential-replacement.js';

const key = Buffer.alloc(32, 12).toString('base64');
const environment = { PAPER_COPY_TOKEN_KEY_REF: 'synthetic-key', PAPER_COPY_TOKEN_ENCRYPTION_KEY: key } as Environment;
function fixture() {
  const old = encryptSecret(JSON.stringify({ apiKeyId: 'synthetic-old', apiSecret: 'synthetic-secret' }), key, 'customer');
  let row = { customer_id: 'customer', provider_account_ref: 'original', key_ref: 'synthetic-key',
    token_secret_id: 'token', connection_method: 'PAPER_API_KEY_PRIVATE_BETA', connection_status: 'CONNECTED',
    account_ready: true, ...old, auth_tag: old.authTag };
  const sql: string[] = []; let released = 0;
  const query = async (statement: string, parameters?: unknown[]) => {
    sql.push(statement);
    if (statement.startsWith('SELECT t.') || statement.includes('FOR UPDATE OF')) return { rows: [row], rowCount: 1 };
    if (statement.startsWith('UPDATE copy.alpaca_oauth_token')) {
      assert.ok(parameters); row = { ...row, ciphertext: parameters[0] as Buffer, iv: parameters[1] as Buffer,
        auth_tag: parameters[2] as Buffer }; return { rows: [{ token_secret_id: 'token' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, on() {}, off() {}, removeListener() {}, release() { released++; } }),
    totalCount: 1, idleCount: 1, waitingCount: 0 } as unknown as Pool;
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    assert.equal(init?.method ?? 'GET', 'GET');
    const url = new URL(String(input)); assert.equal(url.origin, 'https://paper-api.alpaca.markets');
    if (url.pathname === '/v2/account') return Response.json({ id: 'original', status: 'ACTIVE', equity: '10000',
      cash: '10000', buying_power: '10000', options_buying_power: '10000', options_trading_level: 1,
      account_blocked: false, trading_blocked: false });
    if (url.pathname === '/v2/clock') return Response.json({ is_open: false });
    return Response.json([]);
  }) as typeof fetch;
  return { pool, sql, fetchImpl, row: () => row, released: () => released };
}
const credentials = { api_key_id: 'synthetic-new', secret_key: 'synthetic-new-secret' };

test('credential-only replacement prepares read-only, preserves rollback before write, and keeps key and identity', async () => {
  const f = fixture(); const prepared = await prepareMasterCredentialReplacement(f.pool, environment, credentials, f.fetchImpl);
  assert.ok(f.sql.every(sql => sql.startsWith('SELECT')));
  const old = Buffer.from(f.row().ciphertext);
  const result = await applyMasterCredentialReplacement(f.pool, environment, prepared, async previous => {
    assert.deepEqual(previous.ciphertext, old);
    assert.equal(f.sql.filter(sql => sql.startsWith('UPDATE')).length, 0);
  });
  assert.equal(result.credentialUpdated, true); assert.equal(f.released(), 1);
  assert.equal(f.sql.at(-1), 'COMMIT');
  const updates = f.sql.filter(sql => sql.startsWith('UPDATE'));
  assert.equal(updates.length, 1); const update = updates[0]; assert.ok(update);
  assert.match(update, /SET ciphertext=\$1,iv=\$2,auth_tag=\$3/);
  assert.doesNotMatch(update, /SET.*(key_ref|customer_id|created_at|scope|last_used_at)\s*=/);
  const row = f.row();
  assert.deepEqual(JSON.parse(decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, key, 'customer')),
    { apiKeyId: credentials.api_key_id, apiSecret: credentials.secret_key });
});

test('wrong account, wrong existing encryption key, and unknown restrictions fail before any write', async () => {
  for (const variation of ['account', 'encryption', 'restriction']) {
    const f = fixture();
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const response = await f.fetchImpl(input as string, init);
      if (new URL(String(input)).pathname !== '/v2/account') return response;
      const body = await response.json();
      if (variation === 'account') body.id = 'dot-other-account';
      if (variation === 'restriction') delete body.account_blocked;
      return Response.json(body);
    }) as typeof fetch;
    const env = variation === 'encryption' ? { ...environment, PAPER_COPY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString('base64') } : environment;
    await assert.rejects(prepareMasterCredentialReplacement(f.pool, env, credentials, fetchImpl));
    assert.equal(f.sql.filter(sql => /UPDATE|INSERT|DELETE/.test(sql)).length, 0);
  }
});

test('rollback preservation failure, stale verification, changed identity and concurrent replacement never write', async () => {
  for (const variation of ['rollback', 'stale', 'identity', 'concurrent']) {
    const f = fixture(); let prepared = await prepareMasterCredentialReplacement(f.pool, environment, credentials, f.fetchImpl);
    if (variation === 'stale') prepared = { ...prepared, verifiedAt: Date.now() - 61_000 };
    if (variation === 'identity') prepared = { ...prepared, providerAccountRef: 'different' };
    if (variation === 'concurrent') prepared = { ...prepared, previousHash: 'different' };
    await assert.rejects(applyMasterCredentialReplacement(f.pool, environment, prepared,
      async () => { if (variation === 'rollback') throw new Error('ROLLBACK_COPY_FAILED'); }));
    assert.equal(f.sql.filter(sql => sql.startsWith('UPDATE')).length, 0);
    if (variation !== 'stale') { assert.equal(f.sql.at(-1), 'ROLLBACK'); assert.equal(f.released(), 1); }
  }
});
