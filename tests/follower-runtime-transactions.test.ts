import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresFollowerPaperRuntimeStore } from '../src/customer/postgres-follower-paper-runtime.js';
import type { FollowerPaperActionPlan } from '../src/customer/follower-paper-runtime.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';

// Transaction behavior only. No broker/provider/database connection is made.
const plan = { actionPlanId: 'plan', followerOrderIntentId: 'intent', followerCopyEventId: 'copy',
  workspaceId: 'workspace', followerAccountId: 'follower', clientOrderId: 'client', quantity: 1, limitPrice: 1,
  executionAuthorized: false, executionGate: 'FOLLOWER_EXECUTION_DISABLED' } as FollowerPaperActionPlan;
const at = '2026-10-01T00:00:00.000Z';
const calls = [
  (store: PostgresFollowerPaperRuntimeStore) => store.persistLockedActionPlan(plan, at),
  (store: PostgresFollowerPaperRuntimeStore) => store.recordOrderReconciliation({ plan, brokerOrder: null, observedAt: at }),
];

function harness(fault?: 'QUERY' | 'ROLLBACK' | 'COMMIT') {
  const sqls: string[] = [];
  let active = 0, acquired = 0, released = 0, discarded = 0;
  const pool = { totalCount: 1, idleCount: 1, waitingCount: 0, options: { max: 1 }, connect: async () => {
    assert.equal(active, 0); acquired++; active++;
    return Object.assign(new EventEmitter(), { query: async (sql: string) => {
      sqls.push(sql);
      if (sql === 'ROLLBACK' && fault === 'ROLLBACK') throw new Error('rollback failure');
      if (sql === 'COMMIT' && fault === 'COMMIT') throw Object.assign(new Error('lost commit'), { code: 'ECONNRESET' });
      if (!['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql) && ['QUERY', 'ROLLBACK'].includes(fault ?? ''))
        throw Object.assign(new Error('constraint failure'), { code: '23514' });
      return { rowCount: 1, rows: [{ workspace_id: plan.workspaceId, follower_account_id: plan.followerAccountId,
        execution_authorized: false, execution_gate: plan.executionGate, copy_state: 'EXECUTION_DISABLED', state: 'PLANNED',
        client_order_id: plan.clientOrderId, quantity: plan.quantity, limit_price: plan.limitPrice,
        content_hash: createHash('sha256').update(canonicalJson(plan)).digest('hex') }] };
    }, release: (destroy: boolean) => { assert.equal(active, 1); active--; released++; if (destroy) discarded++; } });
  } } as unknown as Pool;
  return { store: new PostgresFollowerPaperRuntimeStore(pool), sqls, counts: () => ({ active, acquired, released, discarded }) };
}

test('follower runtime transactions acquire once and release on success and query failure', async () => {
  for (const run of calls) for (const fault of [undefined, 'QUERY'] as const) {
    const h = harness(fault);
    if (fault) await assert.rejects(run(h.store)); else await run(h.store);
    assert.deepEqual(h.counts(), { active: 0, acquired: 1, released: 1, discarded: 0 });
    assert.equal(h.sqls.filter(sql => sql === 'BEGIN').length, 1);
    assert.equal(h.sqls.at(-1), fault ? 'ROLLBACK' : 'COMMIT');
  }
});

test('follower rollback failure discards the client and lost COMMIT is unknown without automatic retry', async () => {
  for (const run of calls) for (const fault of ['ROLLBACK', 'COMMIT'] as const) {
    const h = harness(fault);
    if (fault === 'COMMIT') await assert.rejects(run(h.store), /POSTGRES_COMMIT_OUTCOME_UNKNOWN/);
    else await assert.rejects(run(h.store));
    assert.deepEqual(h.counts(), { active: 0, acquired: 1, released: 1, discarded: 1 });
    assert.equal(h.sqls.filter(sql => sql === 'BEGIN').length, 1);
    assert.equal(h.sqls.includes('ROLLBACK'), fault === 'ROLLBACK');
  }
});
