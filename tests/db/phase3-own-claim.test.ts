import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { PostgresMasterPaperActionPlanStore } from '../../src/execution/postgres-master-paper-action-plan-store.js';

// A plan can be released back to WAITING_GATE only by the invocation that still holds its claim. An invocation whose claim expired
// (and was reclaimed by another) must never clear the other invocation's claim. Real migrated schema; one rolled-back transaction.
const id = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-13T14:00:00.000Z';

test('releaseOwnClaimOn releases only a claim held by that worker and leaves another worker claim untouched', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid='trade.master_paper_action_plan'::regclass AND contype='f'`);
    for (const row of keys.rows) await client.query(`ALTER TABLE trade.master_paper_action_plan DROP CONSTRAINT ${row.conname}`);
    await client.query(
      `INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,plan_version,status,plan_json,content_hash,not_before,created_at,updated_at,
        execution_tier,canonical_quantity,paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev,authority_kind,management_input_snapshot_id,
        management_action_frontier_id,action_group_id,leg_sequence,depends_on_action_plan_id,claimed_by,claimed_at,claim_expires_at)
       VALUES($1,$2,$3,'v','CLAIMED','{}'::jsonb,$4,$5,$5,$5,'PAPER_EVIDENCE',1,1,false,NULL,'NEW_RISK',NULL,NULL,$1,1,NULL,'worker-B',$5,$6)`,
      [id(1), id(2), id(3), 'd'.repeat(64), NOW, '2026-10-13T14:02:00.000Z']);
    const store = new PostgresMasterPaperActionPlanStore(pool);
    // worker-A lost its claim to worker-B: nothing may change
    assert.equal(await store.releaseOwnClaimOn(client, id(1), 'worker-A', ['MUTATION_FENCE_LOST:PLAN_CLAIM_NOT_HELD'], NOW, NOW), false);
    let row = (await client.query(`SELECT status,claimed_by FROM trade.master_paper_action_plan WHERE action_plan_id=$1`, [id(1)])).rows[0];
    assert.deepEqual({ status: row.status, claimedBy: row.claimed_by }, { status: 'CLAIMED', claimedBy: 'worker-B' });
    // the real holder can release it
    assert.equal(await store.releaseOwnClaimOn(client, id(1), 'worker-B', ['MUTATION_FENCE_LOST:REQUEST_MUTATION_WINDOW_EXPIRED'], NOW, NOW), true);
    row = (await client.query(`SELECT status,claimed_by,claim_expires_at FROM trade.master_paper_action_plan WHERE action_plan_id=$1`, [id(1)])).rows[0];
    assert.equal(row.status, 'WAITING_GATE');
    assert.equal(row.claimed_by, null);
    assert.equal(row.claim_expires_at, null);
    const events = await client.query(`SELECT state FROM trade.master_paper_action_plan_event WHERE action_plan_id=$1`, [id(1)]);
    assert.deepEqual(events.rows.map((event) => event.state), ['WAITING_GATE']);
    // a plan that is no longer CLAIMED cannot be released again
    assert.equal(await store.releaseOwnClaimOn(client, id(1), 'worker-B', [], NOW, NOW), false);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
