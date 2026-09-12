import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Environment } from '../../src/config/environment.js';
import { PostgresCustomerStore, type SaveFollowerInput } from '../../src/customer/customer-store.js';
import { PostgresMasterRoleStore } from '../../src/customer/paper-account-role.js';
import { recommendedCopyPolicy } from '../../src/customer/copy-policy.js';
import { encryptSecret } from '../../src/customer/customer-security.js';
import { runAutonomousRuntimeCycle } from '../../src/theta/autonomous-runtime.js';

test('real disposable PostgreSQL preserves user limits, master role and tenant isolation', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString: url.toString(), max: 3 });
  try {
    const store = new PostgresCustomerStore(pool);
    const customer = await store.createCustomer(`${randomUUID()}@example.invalid`, 'x'.repeat(64));
    const encryptionKey = Buffer.alloc(32, 9).toString('base64');
    const brokerCredential = encryptSecret(JSON.stringify({
      apiKeyId: 'SYNTHETIC_PAPER_KEY', apiSecret: 'SYNTHETIC_PAPER_SECRET',
    }), encryptionKey, customer.customerId);
    const input: SaveFollowerInput = {
      customerId: customer.customerId, providerAccountRef: randomUUID(), maskedAccount: 'synthetic',
      connectionMethod: 'PAPER_API_KEY_PRIVATE_BETA', accountStatus: 'ACTIVE',
      equity: 10000, cash: 10000, buyingPower: 10000, optionsBuyingPower: 10000,
      optionsApprovedLevel: 1, optionsTradingLevel: 1, accountReady: true,
      openPositionCount: 0, openOrderCount: 0, marketIsOpen: false, restrictions: {},
      keyRef: 'synthetic', scope: 'paper', encryptedCredential: brokerCredential,
    };
    await store.saveFollower(input);
    const recommended = recommendedCopyPolicy(10000);
    assert.deepEqual((await store.saveParticipation(customer.customerId, 10000, recommended)).policy, recommended);
    const custom = { ...recommended, limit_mode: 'CUSTOM' as const,
      max_open_positions: 0, max_bot_capital_pct: 25.5, max_slippage_per_contract_usd: 2.75 };
    await store.saveParticipation(customer.customerId, 10000, custom);
    assert.deepEqual((await store.getFollower(customer.customerId))?.policy, custom);
    const follower = await store.getFollower(customer.customerId);
    assert.ok(follower);
    const active = await pool.query(`SELECT count(*)::int AS n FROM copy.follower_policy
      WHERE follower_account_id=$1 AND superseded_at IS NULL`, [follower.followerAccountId]);
    assert.equal(active.rows[0].n, 1);

    const roles = new PostgresMasterRoleStore(pool);
    await assert.rejects(roles.promote(customer.customerId, 'wrong-identity'), /IDENTITY_MISMATCH/);
    await store.createSession(customer.customerId, 'a'.repeat(64), new Date(Date.now() + 60_000));
    assert.equal(await roles.resolveAuthenticatedCustomer(), customer.customerId);
    await roles.promote(customer.customerId, input.providerAccountRef);
    await roles.promote(customer.customerId, input.providerAccountRef); // idempotent
    assert.equal((await store.getFollower(customer.customerId))?.accountRole, 'MASTER_THETA_PAPER');
    await assert.rejects(store.saveParticipation(customer.customerId, 10000, custom));
    await store.saveFollower(input); // key replacement must preserve master role
    assert.equal((await store.getFollower(customer.customerId))?.accountRole, 'MASTER_THETA_PAPER');
    assert.equal((await store.getFollower(customer.customerId))?.participation, 'BLOCKED');
    await assert.rejects(store.saveFollower({ ...input, providerAccountRef: randomUUID() }), /MASTER_IDENTITY_IMMUTABLE/);
    const other = await store.createCustomer(`${randomUUID()}@example.invalid`, 'x'.repeat(64));
    await assert.rejects(store.saveFollower({ ...input, customerId: other.customerId }));
    assert.equal(await store.getFollowerCredential(other.customerId), null);
    assert.ok(await store.getFollowerCredential(customer.customerId));
    await store.disconnectFollower(customer.customerId);
    assert.equal(await store.getFollowerCredential(customer.customerId), null);
    await store.saveFollower(input);
    assert.equal((await store.getFollower(customer.customerId))?.accountRole, 'MASTER_THETA_PAPER');

    const environment = {
      NODE_ENV: 'test', PORT: 3000, DATABASE_URL: url.toString(),
      PRIVATE_PAPER_API_KEY_BETA_ENABLED: true,
      MASTER_PAPER_EXECUTION_ENABLED: false, FOLLOWER_PAPER_EXECUTION_ENABLED: false,
      PAPER_PAUSE_NEW_ORDERS: true, THETA_AUTONOMOUS_WORKER_ENABLED: true,
      THETA_RUNTIME_MODE: 'THETA_SHADOW_ONLY',
      PAPER_COPY_TOKEN_KEY_REF: 'synthetic', PAPER_COPY_TOKEN_ENCRYPTION_KEY: encryptionKey,
    } as Environment;
    const originalFetch = globalThis.fetch;
    const observedMethods: string[] = [];
    const cycleAt = new Date(Date.now() - 60_000);
    const marketDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(cycleAt);
    globalThis.fetch = (async (request, init) => {
      observedMethods.push(init?.method ?? 'GET');
      const requestUrl = new URL(String(request));
      if (requestUrl.pathname === '/v2/account') return Response.json({ id: input.providerAccountRef, status: 'ACTIVE' });
      if (requestUrl.pathname === '/v2/positions') return Response.json([]);
      if (requestUrl.pathname === '/v2/orders') return Response.json([]);
      if (requestUrl.pathname === '/v2/account/activities') return Response.json([]);
      if (requestUrl.pathname === '/v2/clock') return Response.json({
        timestamp: cycleAt.toISOString(), is_open: false,
        next_open: new Date(cycleAt.getTime() + 86_400_000).toISOString(),
        next_close: new Date(cycleAt.getTime() + 3_600_000).toISOString(),
      });
      if (requestUrl.pathname === '/v2/calendar') return Response.json([{ date: marketDate, open: '09:30', close: '16:00' }]);
      throw new Error(`UNEXPECTED_READ_PATH:${requestUrl.pathname}`);
    }) as typeof fetch;
    try {
      const first = await runAutonomousRuntimeCycle(environment, pool, cycleAt);
      const duplicate = await runAutonomousRuntimeCycle(environment, pool, cycleAt);
      assert.equal(first.status, 'SUCCEEDED');
      assert.equal(first.reconciliation?.dataQuality, 'GOOD');
      assert.equal(first.reconciliation?.accountStatus, 'ACTIVE');
      assert.equal(duplicate.status, 'DUPLICATE');
      assert.ok(observedMethods.length > 0);
      assert.deepEqual(new Set(observedMethods), new Set(['GET']));
      assert.equal(first.masterPaperOrdersSubmitted, 0);
      assert.equal(first.followerPaperOrdersSubmitted, 0);
      assert.equal(first.liveOrdersSubmitted, 0);
      const runtimeEvidence = await pool.query(`SELECT
        (SELECT count(*)::int FROM ops.runtime_worker_cycle WHERE correlation_id=$1) AS cycles,
        (SELECT count(*)::int FROM trade.broker_reconciliation_snapshot WHERE correlation_id=$2) AS reconciliations,
        (SELECT count(*)::int FROM trade.broker_order) AS broker_orders`,
      [first.correlationId, `POSITION_RECONCILIATION:${first.correlationId.slice('theta-runtime:'.length)}`]);
      assert.deepEqual(runtimeEvidence.rows[0], { cycles: 1, reconciliations: 1, broker_orders: 0 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally { await pool.end(); }
});
