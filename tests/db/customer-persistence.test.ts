import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresCustomerStore, type SaveFollowerInput } from '../../src/customer/customer-store.js';
import { PostgresMasterRoleStore } from '../../src/customer/paper-account-role.js';
import { recommendedCopyPolicy } from '../../src/customer/copy-policy.js';

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
    const input: SaveFollowerInput = {
      customerId: customer.customerId, providerAccountRef: randomUUID(), maskedAccount: 'synthetic',
      connectionMethod: 'PAPER_API_KEY_PRIVATE_BETA', accountStatus: 'ACTIVE',
      equity: 10000, cash: 10000, buyingPower: 10000, optionsBuyingPower: 10000,
      optionsApprovedLevel: 1, optionsTradingLevel: 1, accountReady: true,
      openPositionCount: 0, openOrderCount: 0, marketIsOpen: false, restrictions: {},
      keyRef: 'synthetic', scope: 'paper',
      encryptedCredential: { ciphertext: Buffer.from('synthetic-ciphertext'), iv: Buffer.alloc(12), authTag: Buffer.alloc(16) },
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
  } finally { await pool.end(); }
});
