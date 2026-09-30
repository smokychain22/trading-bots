import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresCustomerStore, type SaveFollowerInput, type FollowerRecord } from '../src/customer/customer-store.js';

const input = {
  customerId: 'synthetic-customer', providerAccountRef: 'synthetic-account',
  encryptedCredential: { ciphertext: Buffer.alloc(0), iv: Buffer.alloc(0), authTag: Buffer.alloc(0) },
  optionsApprovedLevel: 1, optionsTradingLevel: 1, restrictions: {},
} as SaveFollowerInput;

function harness(failAt?: 'QUERY' | 'ROLLBACK' | 'COMMIT') {
  let active = 0, acquired = 0, released = 0, discarded = 0;
  const sqls: string[] = [];
  const pool = { totalCount: 1, idleCount: 1, waitingCount: 0, options: { max: 1 },
    connect: async () => {
      assert.equal(active, 0, 'no nested acquisition'); active++; acquired++;
      const client = Object.assign(new EventEmitter(), {
        query: async (sql: string) => {
          sqls.push(sql);
          if (sql === 'ROLLBACK' && failAt === 'ROLLBACK') throw new Error('rollback failed');
          if (sql === 'COMMIT' && failAt === 'COMMIT') throw Object.assign(new Error('lost commit'), { code: 'ECONNRESET' });
          if (!['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql) && ['QUERY', 'ROLLBACK'].includes(failAt ?? ''))
            throw Object.assign(new Error('query failed'), { code: '23514' });
          return { rows: sql.includes('SELECT provider_account_ref') ? [] : [{ token_secret_id: 'token', follower_account_id: 'follower', policy_version: 'policy' }], rowCount: 1 };
        },
        release: (destroy: boolean) => { assert.equal(active, 1); active--; released++; if (destroy) discarded++; },
      });
      return client;
    },
  } as unknown as Pool;
  const store = new PostgresCustomerStore(pool);
  store.getFollower = async () => {
    assert.equal(active, 0, 'readback must happen after releasing the transaction client');
    return { customerId: input.customerId } as FollowerRecord;
  };
  return { store, sqls, counts: () => ({ active, acquired, released, discarded }) };
}

const operations = [
  (s: PostgresCustomerStore) => s.saveFollower(input),
  (s: PostgresCustomerStore) => s.saveParticipation(input.customerId, 10000),
  (s: PostgresCustomerStore) => s.setParticipation(input.customerId, 'PAUSE_NEW_TRADES'),
  (s: PostgresCustomerStore) => s.disconnectFollower(input.customerId),
];
test('all customer transactions release before readback and acquire exactly once', async () => {
  for (const run of operations) {
    const h = harness(); await run(h.store);
    assert.deepEqual(h.counts(), { active: 0, acquired: 1, released: 1, discarded: 0 });
    assert.equal(h.sqls.filter(sql => sql === 'COMMIT').length, 1);
  }
});
test('query and rollback failures release customer clients without replaying writes', async () => {
  for (const run of operations) for (const fault of ['QUERY', 'ROLLBACK'] as const) {
    const h = harness(fault); await assert.rejects(run(h.store));
    assert.deepEqual(h.counts(), { active: 0, acquired: 1, released: 1, discarded: fault === 'ROLLBACK' ? 1 : 0 });
    assert.equal(h.sqls.filter(sql => sql === 'BEGIN').length, 1);
  }
});
test('lost customer COMMIT is typed unknown and never retried or rolled back as uncommitted', async () => {
  for (const run of operations) {
    const h = harness('COMMIT'); await assert.rejects(run(h.store), /POSTGRES_COMMIT_OUTCOME_UNKNOWN/);
    assert.deepEqual(h.counts(), { active: 0, acquired: 1, released: 1, discarded: 1 });
    assert.equal(h.sqls.includes('ROLLBACK'), false);
  }
});
