import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { Pool } from 'pg';
import type { Environment } from '../src/config/environment.js';
import { resolveEffectivePaperExecutionControl } from '../src/execution/paper-execution-authorization.js';
import { assertRecoveryNoSubmitControls, authorizeRecovery, claimRecoveryPermit, executeMasterRecovery, recoveryReadOnlyFetch,
  recoverySignaturePayload, type RecoveryPermit } from '../src/customer/master-credential-recovery.js';

const pair = generateKeyPairSync('ed25519');
const now = Date.now();
const permit: RecoveryPermit = { authorizationId: randomUUID(), sourceSha: 'a'.repeat(40),
  accountHash: 'b'.repeat(64), previousCiphertextHash: 'c'.repeat(64), rollbackFileHash: 'd'.repeat(64),
  ownerPublicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  notBefore: now - 1000, expiresAt: now + 240_000 };
const host = 'synthetic-recovery.vercel.app';
const runtime = { vercelEnvironment: 'production', deploymentHost: host, operatorToken: 'x'.repeat(32), now };
const body = JSON.stringify({ authorizationId: permit.authorizationId, api_key_id: 'synthetic-key', secret_key: 'synthetic-secret' });
const signature = (payload = body, p = permit) => sign(null, recoverySignaturePayload(host, p, payload), pair.privateKey).toString('base64');
const request = { method: 'POST', url: `https://${host}/api/recover-master`, authorization: `Bearer ${runtime.operatorToken}`,
  signature: signature(), body };

test('owner signature pins exact private payload, source, rollback, deployment and one-time permit', () => {
  assert.deepEqual(authorizeRecovery(request, permit, runtime), permit);
  for (const changed of [{ ...request, body: body.replace('synthetic-key', 'different') },
    { ...request, signature: 'a'.repeat(86) + '==' }, { ...request, authorization: 'Bearer wrong' },
    { ...request, url: request.url + '?api_key=forbidden' }, { ...request, url: request.url.replace('https:', 'http:') },
    { ...request, method: 'GET' }, { ...request, url: request.url.replace(host, 'other.vercel.app') }]) {
    assert.throws(() => authorizeRecovery(changed, permit, runtime));
  }
  for (const changed of [{ ...runtime, now: permit.expiresAt }, { ...runtime, now: permit.notBefore - 1 },
    { ...runtime, vercelEnvironment: 'preview' }, { ...runtime, deploymentHost: undefined }])
    assert.throws(() => authorizeRecovery(request, permit, changed));
  assert.throws(() => authorizeRecovery(request, { ...permit, sourceSha: 'e'.repeat(40) }, runtime));
});

test('signed arbitrary selectors, oversized bodies and malformed authorization fail closed', () => {
  for (const extra of [{ accountId: 'arbitrary' }, { control: 'unlock' }, { order: 'buy' }]) {
    const invalid = JSON.stringify({ ...JSON.parse(body), ...extra });
    assert.throws(() => authorizeRecovery({ ...request, body: invalid, signature: signature(invalid) }, permit, runtime));
  }
  assert.throws(() => authorizeRecovery({ ...request, body: ' '.repeat(2049) }, permit, runtime));
  assert.throws(() => authorizeRecovery(request, { ...permit, expiresAt: now + 360_000 }, runtime));
});

test('broker surface cannot submit, close, cancel, follow redirects or call another host', async () => {
  let calls = 0;
  const fetchImpl = recoveryReadOnlyFetch((async (_url, init) => {
    calls++; assert.equal(init?.redirect, 'error'); return Response.json({});
  }) as typeof fetch);
  await fetchImpl('https://paper-api.alpaca.markets/v2/account');
  for (const method of ['POST', 'PATCH', 'DELETE'])
    await assert.rejects(fetchImpl('https://paper-api.alpaca.markets/v2/orders', { method }));
  await assert.rejects(fetchImpl(new Request('https://paper-api.alpaca.markets/v2/orders', { method: 'POST' })));
  await assert.rejects(fetchImpl('https://api.alpaca.markets/v2/account'));
  await assert.rejects(fetchImpl('https://paper-api.alpaca.markets/v2/positions/XLE'));
  assert.equal(calls, 1);
});

test('durable one-time claim rejects replay and contains no credentials in audit parameters', async () => {
  let consumed = false; let releases = 0;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql.includes('SELECT operator_audit')) return { rowCount: consumed ? 1 : 0, rows: [] };
    if (sql.includes('INSERT INTO')) { consumed = true; assert.ok(!JSON.stringify(values).includes('synthetic-secret')); }
    return { rowCount: 1, rows: [] };
  };
  const pool = { connect: async () => ({ query, on() {}, removeListener() {}, release() { releases++; } }) } as unknown as Pool;
  await claimRecoveryPermit(pool, permit);
  await assert.rejects(claimRecoveryPermit(pool, permit), /ALREADY_CONSUMED/);
  assert.equal(releases, 2);
});

test('unknown and active execution controls cannot be interpreted as a credential-recovery lock', async () => {
  const locked = { MASTER_PAPER_EXECUTION_ENABLED: false, FOLLOWER_PAPER_EXECUTION_ENABLED: false,
    PAPER_PAUSE_NEW_ORDERS: true } as Environment;
  for (const row of [undefined, {}, { pause_new_orders: true, master_execution_enabled: true, follower_execution_enabled: false }]) {
    const pool = { query: async () => ({ rowCount: row ? 1 : 0, rows: row ? [row] : [] }) } as unknown as Pool;
    await assert.rejects(executeMasterRecovery(pool, locked, permit, JSON.parse(body)), /DURABLE_EXECUTION_NOT_LOCKED/);
  }
});

test('durable full lock blocks entry and management with unchanged known Production environment flags', () => {
  const row = { pause_new_orders: true, master_execution_enabled: false, follower_execution_enabled: false };
  for (const master of [true, false]) for (const pause of [true, false]) {
    assert.doesNotThrow(() => assertRecoveryNoSubmitControls({ MASTER_PAPER_EXECUTION_ENABLED: master,
      FOLLOWER_PAPER_EXECUTION_ENABLED: false, PAPER_PAUSE_NEW_ORDERS: pause }, row));
    const effective = resolveEffectivePaperExecutionControl({ environmentMasterEnabled: master,
      environmentFollowerEnabled: false, environmentPauseNewOrders: pause,
      persisted: { pauseNewOrders: true, masterExecutionEnabled: false, followerExecutionEnabled: false,
        authorizationEventId: 'synthetic-existing-authority' }, operatorNewEntriesPaused: false,
      operatorEmergencyExecutionLock: false });
    assert.equal(effective.newRiskSubmissionEnabled, false);
    assert.equal(effective.managementSubmissionEnabled, false);
    assert.equal(effective.followerEnabled, false);
  }
  for (const rowChange of [{ ...row, master_execution_enabled: true }, { ...row, pause_new_orders: false },
    { ...row, follower_execution_enabled: true }, { ...row, master_execution_enabled: 'false' }, {}, null])
    assert.throws(() => assertRecoveryNoSubmitControls({ MASTER_PAPER_EXECUTION_ENABLED: true,
      FOLLOWER_PAPER_EXECUTION_ENABLED: false, PAPER_PAUSE_NEW_ORDERS: false }, rowChange), /DURABLE_EXECUTION_NOT_LOCKED/);
  for (const changes of [{ MASTER_PAPER_EXECUTION_ENABLED: undefined }, { FOLLOWER_PAPER_EXECUTION_ENABLED: true },
    { PAPER_PAUSE_NEW_ORDERS: undefined }])
    assert.throws(() => assertRecoveryNoSubmitControls({ MASTER_PAPER_EXECUTION_ENABLED: true,
      FOLLOWER_PAPER_EXECUTION_ENABLED: false, PAPER_PAUSE_NEW_ORDERS: false, ...changes } as Environment, row),
    /CONTROL_UNKNOWN_OR_ACTIVE/);
});
