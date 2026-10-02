import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { actionPlanContentHash } from '../../src/execution/action-plan-integrity.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from '../../src/execution/master-paper-action-handoff.js';
import { expireStaleReadyOrderIntents, PostgresManagementRepriceStore } from '../../src/execution/management-order-repricing.js';

const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-13T14:00:00.000Z';

const plan: ApprovedMasterPaperActionPlan = {
  contractVersion: masterPaperActionPlanVersion, actionPlanId: id(1), decisionAuthority: 'MANAGEMENT',
  managementInputSnapshotId: id(2), managementActionFrontierId: id(3), actionGroupId: id(1), legSequence: 1, dependsOnActionPlanId: null,
  executionAccountId: id(4), decisionId: id(5), candidateId: `management:${id(3)}:SELL_STOCK`, strategyVersion: 'theta-recovery-v1',
  chainId: id(6), optionContractId: null, underlyingId: id(7), underlying: 'AAPL', optionType: null, symbol: 'AAPL',
  quantity: 100, canonicalQuantity: 100, paperEvidenceQuantity: 100, paperEvidenceRiskCap: 100, paperEvidenceCapReason: 'CANONICAL_QUANTITY_LOWER',
  executionTier: 'PAPER_EVIDENCE', multiplier: 1, action: 'SELL_STOCK', economicBoundary: 190, economicsRemainPositive: true,
  expectedAfterCostEv: null, empiricalEconomicsReady: false, selectedByCanonicalAuthority: true, hardValidityPassed: true,
  accountVerified: true, optionsCapabilityVerified: true, noEquivalentExposureConflict: true, aegisState: 'ALLOW_FULL', killSwitchActive: false,
  decisionExpiresAt: '2026-10-13T14:00:30.000Z', pricingPolicy: { waitIntervalMs: 5000, maxAttempts: 3, concessionFractions: [0, 0.5, 1], tickSize: 0.01 },
  pricingAttempt: 0, previousLimit: null, committedShortCallContracts: 0, brokerConfirmedShares: 100, accountLedgerShares: 100, freeSellableShares: 100,
};

// Every statement the store issues must compile against the migrated schema and the candidate join must really find a working
// management order, rebuild its attempt state from persisted rows and verify the sealed plan. All seed data lives in one
// transaction that is always rolled back; foreign keys of the touched tables are dropped inside it only.
test('management repricing store: statements compile, candidate join reconstructs attempt state, closePlan and the stale-READY sweep work', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of ['order_intent', 'master_paper_action_plan', 'economic_chain', 'management_input_snapshot', 'execution_price_event', 'broker_order']) {
      const keys = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid=('trade.'||$1)::regclass AND contype='f'`, [table]);
      for (const row of keys.rows) await client.query(`ALTER TABLE trade.${table} DROP CONSTRAINT ${row.conname}`);
    }
    const store = new PostgresManagementRepriceStore({ query: (text: string, values?: unknown[]) => client.query(text, values) });
    assert.deepEqual(await store.loadCandidates(plan.executionAccountId), [], 'nothing seeded yet');

    await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at) VALUES($1,$2,$3,'RECOVERY_WAIT',$4)`,
      [plan.chainId, id(8), plan.underlyingId, T0]);
    await client.query(`INSERT INTO trade.management_input_snapshot(management_input_snapshot_id,reconciliation_snapshot_id,fusion_snapshot_id,chain_id,observed_at,
      lifecycle_state,input_json,unknown_fields_json,change_json,content_hash) VALUES($1,$2,$3,$4,$5,'RECOVERY_WAIT','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,$6)`,
    [plan.managementInputSnapshotId, id(9), id(10), plan.chainId, T0, 'a'.repeat(64)]);
    await client.query(`INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,plan_version,status,plan_json,content_hash,not_before,
      created_at,updated_at,execution_tier,canonical_quantity,paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev,authority_kind,
      management_input_snapshot_id,management_action_frontier_id,action_group_id,leg_sequence,depends_on_action_plan_id)
      VALUES($1,$2,$3,$4,'SUBMITTED',$5::jsonb,$6,$7,$7,$7,$8,100,100,false,NULL,'MANAGEMENT',$9,$10,$11,1,NULL)`,
    [plan.actionPlanId, plan.decisionId, plan.executionAccountId, plan.contractVersion, JSON.stringify(plan), actionPlanContentHash(plan), T0, plan.executionTier,
      plan.managementInputSnapshotId, plan.managementActionFrontierId, plan.actionGroupId]);
    const intent = (n: number, clientId: string, status: string, limit: number, persistedAt: string) => client.query(
      `INSERT INTO trade.order_intent(order_intent_id,execution_account_id,decision_id,client_order_id,status,instrument_type,broker_symbol,side,quantity,limit_price,
        time_in_force,theta_action,chain_id,underlying_id,intent_persisted_at,created_at,updated_at,execution_tier,canonical_quantity,paper_evidence_quantity,decision_expires_at)
       VALUES($1,$2,$3,$4,$5::trade.order_intent_status,'STOCK','AAPL','sell',100,$6,'day','SELL_STOCK',$7,$8,$9,$9,$9,'PAPER_EVIDENCE',100,100,$10)`,
      [id(n), plan.executionAccountId, plan.decisionId, clientId, status, limit, plan.chainId, plan.underlyingId, persistedAt, '2026-10-13T14:00:30.000Z']);
    await intent(40, 'reprice-test-1', 'CANCELED', 190.1, T0);                       // replaced predecessor
    await intent(41, 'reprice-test-2', 'ACKNOWLEDGED', 190.05, '2026-10-13T14:00:06.000Z'); // the working order
    await client.query(`INSERT INTO trade.execution_price_event(order_intent_id,event_type,event_time,provider,source_semantics,received_at,bid,ask,attempt_no,reason_code,content_hash)
      VALUES($1,'REPLACEMENT','2026-10-13T14:00:12.000Z','ALPACA','TRUSTED_TWO_SIDED_ORDER_PRICING','2026-10-13T14:00:12.000Z',190,190.1,3,'ADAPTIVE_LIMIT_KEEP',$2)`, [id(41), 'b'.repeat(64)]);

    const [candidate, ...rest] = await store.loadCandidates(plan.executionAccountId);
    assert.equal(rest.length, 0);
    assert.equal(candidate?.orderIntentId, id(41));
    assert.equal(candidate?.limitPrice, 190.05);
    assert.equal(candidate?.attemptsSoFar, 3, '2 intents + 1 persisted KEEP evidence row: a kept attempt is never lost and an attempt number is never reused');
    assert.equal(candidate?.lastActionAt, '2026-10-13T14:00:12.000Z', 'last action time includes the recorded KEEP');
    assert.deepEqual(candidate?.plan, plan, 'the sealed plan verified from the stored row');
    assert.equal(candidate?.decisionStillCurrent, true);

    // chain moved on => the decision is no longer current
    await client.query(`UPDATE trade.economic_chain SET lifecycle_state='CC_OPEN' WHERE chain_id=$1`, [plan.chainId]);
    assert.equal((await store.loadCandidates(plan.executionAccountId))[0]?.decisionStillCurrent, false);
    await client.query(`UPDATE trade.economic_chain SET lifecycle_state='RECOVERY_WAIT' WHERE chain_id=$1`, [plan.chainId]);
    // a tampered stored payload verifies to no plan
    await client.query('ALTER TABLE trade.master_paper_action_plan DISABLE TRIGGER reject_master_paper_action_plan_economic_mutation');
    await client.query(`UPDATE trade.master_paper_action_plan SET plan_json=jsonb_set(plan_json,'{economicBoundary}','1') WHERE action_plan_id=$1`, [plan.actionPlanId]);
    assert.equal((await store.loadCandidates(plan.executionAccountId))[0]?.plan, null);
    await client.query(`UPDATE trade.master_paper_action_plan SET plan_json=$2::jsonb WHERE action_plan_id=$1`, [plan.actionPlanId, JSON.stringify(plan)]);
    await client.query('ALTER TABLE trade.master_paper_action_plan ENABLE TRIGGER reject_master_paper_action_plan_economic_mutation');

    // closing the plan: SUBMITTED -> TERMINAL with the typed reason, event recorded, repeat is a no-op
    await store.closePlan(plan.actionPlanId, id(41), 'MAX_ATTEMPTS_REACHED', '2026-10-13T14:00:20.000Z');
    const closed = await client.query(`SELECT status,last_blockers_json FROM trade.master_paper_action_plan WHERE action_plan_id=$1`, [plan.actionPlanId]);
    assert.deepEqual([closed.rows[0].status, closed.rows[0].last_blockers_json], ['TERMINAL', ['MAX_ATTEMPTS_REACHED']]);
    await store.closePlan(plan.actionPlanId, id(41), 'MAX_ATTEMPTS_REACHED', '2026-10-13T14:00:21.000Z');
    const events = await client.query(`SELECT count(*)::int AS n FROM trade.master_paper_action_plan_event WHERE action_plan_id=$1 AND state='TERMINAL'`, [plan.actionPlanId]);
    assert.equal(events.rows[0].n, 1);

    // stale READY sweep: expired, never-submitted intents become EXPIRED; intents with a broker order or a live window are untouched
    await intent(50, 'reprice-test-ready-stale', 'READY', 190, T0);
    await intent(51, 'reprice-test-ready-live', 'READY', 190, '2026-10-13T14:00:50.000Z');
    await client.query(`UPDATE trade.order_intent SET decision_expires_at=$2 WHERE order_intent_id=$1`, [id(51), '2026-10-13T15:00:00.000Z']);
    await intent(52, 'reprice-test-ready-sent', 'READY', 190, T0);
    await client.query(`INSERT INTO trade.broker_order(order_intent_id,provider_order_id,broker_status) VALUES($1,'broker-x','accepted')`, [id(52)]);
    assert.equal(await expireStaleReadyOrderIntents({ query: (text: string, values?: unknown[]) => client.query(text, values) }, plan.executionAccountId, '2026-10-13T14:10:00.000Z'), 1);
    const statuses = await client.query(`SELECT order_intent_id::text AS id, status::text AS status FROM trade.order_intent WHERE order_intent_id = ANY($1::uuid[]) ORDER BY order_intent_id`,
      [[id(50), id(51), id(52)]]);
    assert.deepEqual(statuses.rows.map((row) => row.status), ['EXPIRED', 'READY', 'READY']);
  } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); await pool.end(); }
});
