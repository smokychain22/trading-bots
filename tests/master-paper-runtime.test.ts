import assert from 'node:assert/strict';
import test from 'node:test';
import type { Environment } from '../src/config/environment.js';
import { encryptSecret } from '../src/customer/customer-security.js';
import type { CustomerStore, FollowerVerificationUpdate, MasterCredentialStore } from '../src/customer/customer-store.js';
import { masterOptionsAccountReady, verifyStoredMasterPaperConnection } from '../src/customer/master-paper-runtime.js';

const NOW = new Date('2026-09-11T15:00:00.000Z');
const customerId = 'synthetic-master-customer';
const accountId = 'synthetic-paper-account-14e7';
const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const encrypted = encryptSecret(JSON.stringify({ apiKeyId: 'SYNTHETIC_KEY', apiSecret: 'SYNTHETIC_SECRET' }), encryptionKey, customerId);
const environment = {
  NODE_ENV: 'test', PORT: 3000, PRIVATE_PAPER_API_KEY_BETA_ENABLED: true,
  MASTER_PAPER_EXECUTION_ENABLED: false, FOLLOWER_PAPER_EXECUTION_ENABLED: false, PAPER_PAUSE_NEW_ORDERS: true,
  PAPER_COPY_TOKEN_KEY_REF: 'private-beta-v1', PAPER_COPY_TOKEN_ENCRYPTION_KEY: encryptionKey,
} as Environment;

test('master options readiness needs current trading permission and known restrictions, independently of followers', () => {
  const input = {status:'ACTIVE',approvedLevel:3,tradingLevel:3,tradingBlocked:false};
  assert.equal(masterOptionsAccountReady(input),true);
  for (const tradingLevel of [null,0,-1,1.5]) {
    assert.equal(masterOptionsAccountReady({...input,tradingLevel}),false);
  }
  assert.equal(masterOptionsAccountReady({...input,approvedLevel:null}),false);
  assert.equal(masterOptionsAccountReady({...input,tradingBlocked:null}),false);
  assert.equal(masterOptionsAccountReady({...input,tradingBlocked:true}),false);
});

test('stored master readiness verifies exact identity, refreshes read-only state, and keeps order submission locked', async () => {
  let update: FollowerVerificationUpdate | null = null;
  const store = {
    getMasterCredential: async () => ({ ...encrypted, customerId, providerAccountRef: accountId, keyRef: 'private-beta-v1' as const, connectionMethod: 'PAPER_API_KEY_PRIVATE_BETA' as const }),
    updateFollowerVerification: async (_customerId: string, input: FollowerVerificationUpdate) => { update = input; return {} as never; },
    markFollowerNeedsAttention: async () => undefined,
  } as unknown as CustomerStore & MasterCredentialStore;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/v2/account') return Response.json({ id: accountId, status: 'ACTIVE', equity: '100000', cash: '50000', buying_power: '200000', options_buying_power: '100000', options_approved_level: 3, options_trading_level: 3, trading_blocked: false, transfers_blocked: false });
    if (url.pathname === '/v2/positions') return Response.json([]);
    if (url.pathname === '/v2/orders') return Response.json([]);
    if (url.pathname === '/v2/clock') return Response.json({ timestamp: NOW.toISOString(), is_open: false, next_open: '2026-09-14T13:30:00Z', next_close: '2026-09-14T20:00:00Z' });
    if (url.pathname === '/v2/calendar') return Response.json([{ date: '2026-09-11', open: '09:30', close: '16:00' }]);
    throw new Error(`UNEXPECTED_READ_ONLY_PATH:${url.pathname}`);
  }) as typeof fetch;
  try {
    const result = await verifyStoredMasterPaperConnection(environment, store, NOW);
    assert.equal(result.connectionState, 'CONNECTED');
    assert.equal(result.brokerIdentityVerified, true);
    assert.equal(result.maskedAccount, '••••14e7');
    assert.equal(result.openPositions, 0);
    assert.equal(result.openOrders, 0);
    assert.equal(result.calendarSessionConfirmed, true);
    assert.equal(result.orderSubmission, 'LOCKED');
    assert.equal(update?.accountReady, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stored master readiness rejects an exact broker identity mismatch', async () => {
  let needsAttention = 0;
  const store = {
    getMasterCredential: async () => ({ ...encrypted, customerId, providerAccountRef: accountId, keyRef: 'private-beta-v1' as const, connectionMethod: 'PAPER_API_KEY_PRIVATE_BETA' as const }),
    markFollowerNeedsAttention: async () => { needsAttention += 1; },
  } as unknown as CustomerStore & MasterCredentialStore;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ id: 'different-paper-account', status: 'ACTIVE' })) as typeof fetch;
  try {
    const result = await verifyStoredMasterPaperConnection(environment, store, NOW);
    assert.equal(result.connectionState, 'INVALID');
    assert.equal(result.reasonCode, 'MASTER_BROKER_IDENTITY_MISMATCH');
    assert.equal(result.orderSubmission, 'LOCKED');
    assert.equal(needsAttention, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
