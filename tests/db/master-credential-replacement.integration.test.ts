import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import type { Environment } from '../../src/config/environment.js';
import { encryptSecret } from '../../src/customer/customer-security.js';
import { MasterEncryptedStoreBrokerCredentialProvider } from '../../src/customer/broker-credential-provider.js';
import { readOnlyMasterCredentialStoreFromPool } from '../../src/customer/customer-store.js';
import { prepareMasterCredentialReplacement, applyMasterCredentialReplacement } from '../../src/customer/master-credential-replacement.js';

test('isolated PostgreSQL credential rotation serializes competitors, preserves identity and rolls back failed updates', {
  skip: !process.env.THETA_CREDENTIAL_ROTATION_TEST_DATABASE_URL,
}, async () => {
  const connection = process.env.THETA_CREDENTIAL_ROTATION_TEST_DATABASE_URL; assert.ok(connection);
  const url = new URL(connection);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.pathname, '/theta_credential_rotation_ci');
  const pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 8000 });
  const customer = randomUUID(), token = randomUUID(), follower = randomUUID(), broker = randomUUID();
  const key = Buffer.alloc(32, 12).toString('base64');
  const env = { PAPER_COPY_TOKEN_KEY_REF: 'synthetic-key', PAPER_COPY_TOKEN_ENCRYPTION_KEY: key } as Environment;
  const old = encryptSecret(JSON.stringify({ apiKeyId: 'synthetic-old', apiSecret: 'synthetic-old-secret' }), key, customer);
  const fakeGet = (async (input: unknown, init?: RequestInit) => {
    assert.equal(init?.method ?? 'GET', 'GET');
    const url = new URL(String(input)); assert.equal(url.origin, 'https://paper-api.alpaca.markets');
    if (url.pathname === '/v2/account') return Response.json({ id: broker, status: 'ACTIVE', equity: '10000', cash: '10000',
      buying_power: '10000', options_buying_power: '10000', options_trading_level: 1,
      trading_blocked: false, account_blocked: false });
    if (url.pathname === '/v2/clock') return Response.json({ is_open: false });
    return Response.json([]);
  }) as typeof fetch;
  try {
    // Minimal synthetic schema in this dedicated database. Production migrations
    // and connections are never invoked by this concurrency reproduction.
    await pool.query(`CREATE SCHEMA copy;
      CREATE TABLE copy.alpaca_oauth_token(token_secret_id uuid PRIMARY KEY,customer_id uuid,key_ref text,
        ciphertext bytea,iv bytea,auth_tag bytea,revoked_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE copy.follower_account(follower_account_id uuid PRIMARY KEY,customer_id uuid,token_secret_id uuid,
        provider_account_ref text,account_role text,environment text,connection_method text,connection_status text,
        account_ready boolean,disconnected_at timestamptz,participation text);`);
    await pool.query(`INSERT INTO copy.alpaca_oauth_token(token_secret_id,customer_id,key_ref,ciphertext,iv,auth_tag)
      VALUES($1,$2,$3,$4,$5,$6)`, [token,customer,'synthetic-key',old.ciphertext,old.iv,old.authTag]);
    await pool.query(`INSERT INTO copy.follower_account VALUES($1,$2,$3,$4,'MASTER_THETA_PAPER','PAPER',
      'PAPER_API_KEY_PRIVATE_BETA','CONNECTED',true,NULL,'STOP_NEW_TRADES_MANAGE_EXISTING')`, [follower,customer,token,broker]);
    const before = (await pool.query('SELECT * FROM copy.follower_account')).rows;
    const credentialBefore = (await pool.query('SELECT * FROM copy.alpaca_oauth_token')).rows[0];
    const prepare = () => prepareMasterCredentialReplacement(pool, env,
      { api_key_id: 'synthetic-new', secret_key: 'synthetic-new-secret' }, fakeGet);
    const failed = await prepare();
    await assert.rejects(applyMasterCredentialReplacement(pool,env,failed,async()=>{throw new Error('DISK_WRITE_FAILED');}),/DISK_WRITE_FAILED/);
    assert.deepEqual((await pool.query('SELECT * FROM copy.alpaca_oauth_token')).rows[0],credentialBefore);
    const first = await prepare(), second = await prepare(); let preserved = 0;
    const outcomes = await Promise.allSettled([first,second].map(prepared=>applyMasterCredentialReplacement(pool,env,prepared,async previous=>{
      assert.deepEqual(previous.ciphertext,old.ciphertext); assert.equal(previous.tokenSecretId,token); preserved++;
    })));
    assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);
    const rejection=outcomes.find(row=>row.status==='rejected'); assert.ok(rejection&&rejection.status==='rejected');
    assert.match(String(rejection.reason),/MASTER_CREDENTIAL_CONCURRENT_UPDATE/); assert.equal(preserved,1);
    assert.deepEqual((await pool.query('SELECT * FROM copy.follower_account')).rows,before);
    const tokenAfter=(await pool.query('SELECT * FROM copy.alpaca_oauth_token')).rows[0];
    for(const field of ['token_secret_id','customer_id','key_ref','revoked_at','created_at'])assert.deepEqual(tokenAfter[field],credentialBefore[field]);
    const auth=await new MasterEncryptedStoreBrokerCredentialProvider(readOnlyMasterCredentialStoreFromPool(pool),env).getAuthentication();
    assert.equal(auth?.providerAccountRef,broker); assert.equal(auth?.authentication.apiKey,'synthetic-new');
    assert.equal(pool.waitingCount,0);
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS copy CASCADE');
    await pool.end();
  }
});
