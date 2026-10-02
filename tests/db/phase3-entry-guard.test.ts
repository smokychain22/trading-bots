import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { readEquivalentEntryInFlight } from '../../src/execution/postgres-master-paper-action-plan-store.js';

// NEW-RISK entry duplicate guard: a resting DAY entry order is what the next scan sees again (new decision id, same contract).
// While another entry plan for the contract is READY / CLAIMED / WAITING_GATE inside its window, or an entry order intent for it is
// non-terminal, a second economically identical entry is not enqueued. Real migrated schema; one rolled-back transaction.
const id = (n: number) => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACCOUNT = id(1), CONTRACT = id(2), OTHER_CONTRACT = id(3);
const NOW = '2026-10-13T14:00:00.000Z';

test('readEquivalentEntryInFlight: plans inside their window and non-terminal entry intents conflict; expired, terminal, other-contract and same-decision do not', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of ['order_intent', 'master_paper_action_plan']) {
      const keys = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid=('trade.'||$1)::regclass AND contype='f'`, [table]);
      for (const row of keys.rows) await client.query(`ALTER TABLE trade.${table} DROP CONSTRAINT ${row.conname}`);
    }
    const plan = (n: number, contract: string, status: string, expiresAt: string, decision = id(100 + n)) => client.query(
      `INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,plan_version,status,plan_json,content_hash,not_before,created_at,updated_at,
        execution_tier,canonical_quantity,paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev,authority_kind,management_input_snapshot_id,
        management_action_frontier_id,action_group_id,leg_sequence,depends_on_action_plan_id)
       VALUES($1,$2,$3,'v',$4,$5::jsonb,$6,$7,$7,$7,'PAPER_EVIDENCE',1,1,false,NULL,'NEW_RISK',NULL,NULL,$1,1,NULL)`,
      [id(n), decision, ACCOUNT, status, JSON.stringify({ action: 'OPEN_CSP', optionContractId: contract, decisionExpiresAt: expiresAt }),
        String(n).padStart(64, 'c'), NOW]);
    const intent = (n: number, contract: string, status: string, decision = id(200 + n)) => client.query(
      `INSERT INTO trade.order_intent(order_intent_id,execution_account_id,decision_id,client_order_id,status,instrument_type,broker_symbol,side,quantity,limit_price,
        time_in_force,theta_action,position_intent,chain_id,underlying_id,option_contract_id,intent_persisted_at,created_at,updated_at,execution_tier,canonical_quantity,paper_evidence_quantity,decision_expires_at)
       VALUES($1,$2,$3,$4,$5::trade.order_intent_status,'OPTION','SPY261120P00600000','sell',1,1.2,'day','OPEN_CSP','SELL_TO_OPEN',$6,$7,$8,$9,$9,$9,'PAPER_EVIDENCE',1,1,$9)`,
      [id(n), ACCOUNT, decision, `entry-guard-${n}`, status, id(50), id(51), contract, NOW]);
    const ask = (decisionId: string, contract = CONTRACT, at = NOW) => readEquivalentEntryInFlight(client, { executionAccountId: ACCOUNT, decisionId, optionContractId: contract, at });

    assert.deepEqual(await ask(id(900)), [], 'nothing in flight yet');
    await plan(10, CONTRACT, 'READY', '2026-10-13T14:10:00.000Z');
    assert.deepEqual(await ask(id(900)), [id(10)], 'a READY entry plan inside its window conflicts');
    assert.deepEqual(await ask(id(110)), [], 'the same decision never conflicts with itself (replay)');
    assert.deepEqual(await ask(id(900), OTHER_CONTRACT), [], 'another contract is independent');
    assert.deepEqual(await ask(id(900), CONTRACT, '2026-10-13T14:20:00.000Z'), [], 'once the window has passed the plan can no longer execute');
    await plan(11, CONTRACT, 'SUBMITTED', '2026-10-13T15:00:00.000Z');
    await plan(12, CONTRACT, 'TERMINAL', '2026-10-13T15:00:00.000Z');
    assert.deepEqual(await ask(id(900)), [id(10)], 'submitted/terminal plans are covered by their order intent, not by the plan row');
    await intent(20, CONTRACT, 'ACKNOWLEDGED');
    assert.deepEqual((await ask(id(900))).sort(), [id(10), id(20)].sort(), 'a resting entry order conflicts');
    await client.query(`UPDATE trade.order_intent SET status='EXPIRED' WHERE order_intent_id=$1`, [id(20)]);
    await client.query(`UPDATE trade.master_paper_action_plan SET status='TERMINAL' WHERE action_plan_id=$1`, [id(10)]);
    assert.deepEqual(await ask(id(900)), [], 'released as soon as the order is terminal (next session may enter again)');
    for (const [index, status] of ['FILLED', 'CANCELED', 'REJECTED'].entries()) {
      await intent(31 + index, CONTRACT, status);
    }
    assert.deepEqual(await ask(id(900)), [], 'terminal order intents never block');
    await intent(40, CONTRACT, 'UNKNOWN_SUBMISSION');
    assert.deepEqual(await ask(id(900)), [id(40)], 'an unknown submission blocks a duplicate until it is reconciled');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
