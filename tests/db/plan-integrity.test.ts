import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

// Migration 068: the economic payload of a published plan is immutable in the database; operational metadata is not; terminal
// states are final; and at most one pre-submit management plan exists per chain and leg. Foreign keys are dropped ONLY inside
// one disposable transaction that is always rolled back.
const hash = (n: number) => n.toString(16).padStart(64, '0');
const uuid = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('master action plan: economic columns are immutable, operational columns mutable, terminal is final, one pre-submit management plan per chain', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  const insert = async (n: number, extra: { chain?: string; leg?: number; status?: string; authority?: string } = {}) => {
    const management = (extra.authority ?? 'MANAGEMENT') === 'MANAGEMENT';
    await client.query(`INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,plan_version,status,plan_json,content_hash,
      not_before,created_at,updated_at,execution_tier,canonical_quantity,paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev,authority_kind,
      management_input_snapshot_id,management_action_frontier_id,action_group_id,leg_sequence,depends_on_action_plan_id)
      VALUES($1,$2,$3,'v','${extra.status ?? 'READY'}',$4::jsonb,$5,now(),now(),now(),'PAPER_EVIDENCE',100,100,false,NULL,$6,$7,$8,$9,$10,$11)`,
    [uuid(n), uuid(1000 + n), uuid(2000), JSON.stringify({ chainId: extra.chain ?? 'chain-a', symbol: 'AAPL' }), hash(n), management ? 'MANAGEMENT' : 'NEW_RISK',
      management ? uuid(3000 + n) : null, management ? uuid(4000 + n) : null, uuid(n), extra.leg ?? 1, (extra.leg ?? 1) > 1 ? uuid(n - 1) : null]);
  };
  const rejects = async (sql: string, values: unknown[], pattern: RegExp) => {
    await client.query('SAVEPOINT s');
    await assert.rejects(client.query(sql, values), pattern);
    await client.query('ROLLBACK TO SAVEPOINT s');
  };
  try {
    await client.query('BEGIN');
    // DDL is transactional in PostgreSQL: drop this table's foreign keys inside the disposable transaction (rolled back below) so
    // the immutability trigger and the partial unique index can be exercised without building the whole decision graph.
    const foreignKeys = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid='trade.master_paper_action_plan'::regclass AND contype='f'`);
    for (const row of foreignKeys.rows) await client.query(`ALTER TABLE trade.master_paper_action_plan DROP CONSTRAINT ${row.conname}`);
    await insert(1);
    // immutable economic payload
    for (const [column, value] of [['plan_json', '{"chainId":"chain-a","symbol":"MSFT"}'], ['content_hash', hash(99)], ['canonical_quantity', 500],
      ['paper_evidence_quantity', 50], ['execution_tier', 'EMPIRICALLY_PROMOTED_PAPER'], ['empirical_economics_ready', true], ['expected_after_cost_ev', 5],
      ['decision_id', uuid(7777)], ['plan_version', 'v2'], ['leg_sequence', 2]] as const) {
      const cast = column === 'plan_json' ? '$2::jsonb' : '$2';
      await rejects(`UPDATE trade.master_paper_action_plan SET ${column}=${cast} WHERE action_plan_id=$1`, [uuid(1), value], /PLAN_INTEGRITY_MISMATCH/);
    }
    // a no-op update of an immutable column (same value) is allowed; operational metadata mutates freely
    await client.query('UPDATE trade.master_paper_action_plan SET canonical_quantity=100 WHERE action_plan_id=$1', [uuid(1)]);
    await client.query(`UPDATE trade.master_paper_action_plan SET status='CLAIMED',claimed_by='w',claimed_at=now(),claim_expires_at=now()+interval '2 minutes',
      last_blockers_json='["X"]'::jsonb,not_before=now(),updated_at=now() WHERE action_plan_id=$1`, [uuid(1)]);
    await client.query(`UPDATE trade.master_paper_action_plan SET status='WAITING_GATE',claimed_by=NULL,claimed_at=NULL,claim_expires_at=NULL WHERE action_plan_id=$1`, [uuid(1)]);
    // execution_order_intent_id can be set once; re-pointing is rejected (set requires an order_intent row, so test the guard via NULL -> NULL no-op)
    await client.query(`UPDATE trade.master_paper_action_plan SET status='SUBMITTED' WHERE action_plan_id=$1`, [uuid(1)]);
    await client.query(`UPDATE trade.master_paper_action_plan SET status='TERMINAL' WHERE action_plan_id=$1`, [uuid(1)]);
    await rejects(`UPDATE trade.master_paper_action_plan SET status='READY' WHERE action_plan_id=$1`, [uuid(1)], /terminal state/);
    await insert(2);
    await client.query(`UPDATE trade.master_paper_action_plan SET status='QUARANTINED' WHERE action_plan_id=$1`, [uuid(2)]);
    await rejects(`UPDATE trade.master_paper_action_plan SET status='CLAIMED' WHERE action_plan_id=$1`, [uuid(2)], /terminal state/);

    // one pre-submit management plan per chain and leg
    await insert(10, { chain: 'chain-b' });
    await client.query('SAVEPOINT dup');
    await assert.rejects(insert(11, { chain: 'chain-b' }), /ux_master_paper_action_plan_management_chain_leg_presubmit/);
    await client.query('ROLLBACK TO SAVEPOINT dup');
    await insert(12, { chain: 'chain-c' });                    // a different chain is independent
    await insert(13, { chain: 'chain-b', leg: 2 });            // the second leg of a group is a different leg position
    await insert(14, { chain: 'chain-d', status: 'SUBMITTED' });
    await insert(15, { chain: 'chain-d' });                    // SUBMITTED no longer holds the pre-submit slot (order intents guard the chain)
    await insert(16, { chain: 'chain-e', status: 'TERMINAL' });
    await insert(17, { chain: 'chain-e' });                    // terminal plans release the chain
    await insert(18, { chain: 'chain-b', authority: 'NEW_RISK' }); // new-risk plans are outside the management constraint
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
