import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { actionPlanContentHash } from '../../src/execution/action-plan-integrity.js';
import { evaluateStockExitFreeze, listStockPartialExitChains, readStockTerminalExitEvidence } from '../../src/execution/management-chain-inflight.js';
import { sweepTerminalSubmittedPlans } from '../../src/execution/management-order-repricing.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from '../../src/execution/master-paper-action-handoff.js';

// Phase 3 cross-session sweep and the terminal partial stock exit freeze (owner Paper policy P-A), against the real migrated schema.
// All data lives in one transaction that is always rolled back; foreign keys of the touched tables are dropped inside it only.
const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-13T14:00:00.000Z';
const T1 = '2026-10-13T20:30:00.000Z';
const ACCOUNT = id(4);

const planFor = (n: number, chainId: string): ApprovedMasterPaperActionPlan => ({
  contractVersion: masterPaperActionPlanVersion, actionPlanId: id(n), decisionAuthority: 'MANAGEMENT',
  managementInputSnapshotId: id(n + 1), managementActionFrontierId: id(n + 2), actionGroupId: id(n), legSequence: 1, dependsOnActionPlanId: null,
  executionAccountId: ACCOUNT, decisionId: id(n + 3), candidateId: `management:${id(n + 2)}:SELL_STOCK`, strategyVersion: 'theta-recovery-v1',
  chainId, optionContractId: null, underlyingId: id(7), underlying: 'AAPL', optionType: null, symbol: 'AAPL',
  quantity: 100, canonicalQuantity: 100, paperEvidenceQuantity: 100, paperEvidenceRiskCap: 100, paperEvidenceCapReason: 'CANONICAL_QUANTITY_LOWER',
  executionTier: 'PAPER_EVIDENCE', multiplier: 1, action: 'SELL_STOCK', economicBoundary: 190, economicsRemainPositive: true,
  expectedAfterCostEv: null, empiricalEconomicsReady: false, selectedByCanonicalAuthority: true, hardValidityPassed: true,
  accountVerified: true, optionsCapabilityVerified: true, noEquivalentExposureConflict: true, aegisState: 'ALLOW_FULL', killSwitchActive: false,
  decisionExpiresAt: '2026-10-13T14:00:30.000Z', pricingPolicy: { waitIntervalMs: 5000, maxAttempts: 3, concessionFractions: [0, 0.5, 1], tickSize: 0.01 },
  pricingAttempt: 0, previousLimit: null, committedShortCallContracts: 0, brokerConfirmedShares: 100, accountLedgerShares: 100, freeSellableShares: 100,
});

test('cross-session sweep closes finished plans with typed reasons; a terminal partial stock exit freezes the chain until shares reconcile', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  const query = { query: (text: string, values?: unknown[]) => client.query(text, values) };
  try {
    await client.query('BEGIN');
    for (const table of ['order_intent', 'master_paper_action_plan', 'economic_chain', 'management_input_snapshot', 'broker_order', 'fill', 'stock_lot']) {
      const keys = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid=('trade.'||$1)::regclass AND contype='f'`, [table]);
      for (const row of keys.rows) await client.query(`ALTER TABLE trade.${table} DROP CONSTRAINT ${row.conname}`);
    }
    const seed = async (n: number, chain: string, statuses: Array<{ status: string; filled: number; key: number }>) => {
      const plan = planFor(n, chain);
      await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at) VALUES($1,$2,$3,'RECOVERY_WAIT',$4)
        ON CONFLICT DO NOTHING`, [chain, id(8), plan.underlyingId, T0]);
      await client.query(`INSERT INTO trade.management_input_snapshot(management_input_snapshot_id,reconciliation_snapshot_id,fusion_snapshot_id,chain_id,observed_at,
        lifecycle_state,input_json,unknown_fields_json,change_json,content_hash) VALUES($1,$2,$3,$4,$5,'RECOVERY_WAIT','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,$6)`,
      [plan.managementInputSnapshotId, id(9), id(10), chain, T0, String(n).padStart(64, 'a')]);
      await client.query(`INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,plan_version,status,plan_json,content_hash,not_before,
        created_at,updated_at,execution_tier,canonical_quantity,paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev,authority_kind,
        management_input_snapshot_id,management_action_frontier_id,action_group_id,leg_sequence,depends_on_action_plan_id,execution_order_intent_id)
        VALUES($1,$2,$3,$4,'SUBMITTED',$5::jsonb,$6,$7,$7,$7,$8,100,100,false,NULL,'MANAGEMENT',$9,$10,$11,1,NULL,$12)`,
      [plan.actionPlanId, plan.decisionId, ACCOUNT, plan.contractVersion, JSON.stringify(plan), actionPlanContentHash(plan), T0, plan.executionTier,
        plan.managementInputSnapshotId, plan.managementActionFrontierId, plan.actionGroupId, id(statuses[0]?.key ?? 0)]);
      let minute = 0;
      for (const item of statuses) {
        minute += 1;
        const at = `2026-10-13T14:0${minute}:00.000Z`;
        await client.query(`INSERT INTO trade.order_intent(order_intent_id,execution_account_id,decision_id,client_order_id,status,instrument_type,broker_symbol,side,quantity,
          limit_price,time_in_force,theta_action,chain_id,underlying_id,intent_persisted_at,created_at,updated_at,execution_tier,canonical_quantity,paper_evidence_quantity,decision_expires_at)
          VALUES($1,$2,$3,$4,$5::trade.order_intent_status,'STOCK','AAPL','sell',100,190,'day','SELL_STOCK',$6,$7,$8,$8,$8,'PAPER_EVIDENCE',100,100,$9)`,
        [id(item.key), ACCOUNT, plan.decisionId, `sweep-${item.key}`, item.status, chain, plan.underlyingId, at, '2026-10-13T14:00:30.000Z']);
        await client.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id,broker_status) VALUES($1,$2,$3,'x')`,
          [id(item.key + 500), id(item.key), `prov-${item.key}`]);
        if (item.filled > 0) await client.query(`INSERT INTO trade.fill(broker_order_id,provider_fill_id,quantity,price_per_share,filled_at) VALUES($1,$2,$3,190,$4)`,
          [id(item.key + 500), `fill-${item.key}`, item.filled, at]);
      }
      return plan;
    };

    const partial = await seed(100, id(61), [{ status: 'EXPIRED', filled: 40, key: 110 }]);          // 40 of 100 sold, then the DAY order expired
    const filled = await seed(120, id(62), [{ status: 'CANCELED', filled: 0, key: 130 }, { status: 'FILLED', filled: 100, key: 131 }]); // replaced predecessor + filled
    const unfilled = await seed(140, id(63), [{ status: 'EXPIRED', filled: 0, key: 150 }]);
    const working = await seed(160, id(64), [{ status: 'ACKNOWLEDGED', filled: 0, key: 170 }]);
    // an open ledger lot for the partial chain: the ledger has not recorded the part sale
    await client.query(`INSERT INTO trade.stock_lot(stock_lot_id,chain_id,underlying_id,shares,economic_basis_per_share,acquired_at) VALUES($1,$2,$3,100,195,$4)`,
      [id(180), id(61), partial.underlyingId, T0]);

    const report = await sweepTerminalSubmittedPlans(query, ACCOUNT, T1);
    const byPlan = new Map(report.closed.map((item) => [item.actionPlanId, item]));
    assert.equal(byPlan.get(partial.actionPlanId)?.reason, 'ORDER_TERMINAL_PARTIAL_FILL');
    assert.equal(byPlan.get(filled.actionPlanId)?.reason, 'ORDER_FILLED');
    assert.equal(byPlan.get(unfilled.actionPlanId)?.reason, 'ORDER_EXPIRED_UNFILLED');
    assert.equal(byPlan.has(working.actionPlanId), false, 'a plan whose order is still working is never swept');
    const statuses = await client.query(`SELECT action_plan_id::text AS id, status FROM trade.master_paper_action_plan ORDER BY action_plan_id`);
    const statusOf = (planId: string) => statuses.rows.find((row: { id: string }) => row.id === planId)?.status;
    assert.equal(statusOf(partial.actionPlanId), 'TERMINAL');
    assert.equal(statusOf(working.actionPlanId), 'SUBMITTED');
    const event = await client.query(`SELECT detail_json FROM trade.master_paper_action_plan_event WHERE action_plan_id=$1 AND state='TERMINAL'`, [partial.actionPlanId]);
    assert.equal(event.rows[0].detail_json.realizedPnlAttribution, 'UNKNOWN_PENDING_RECONCILIATION', 'no lot-level P&L is fabricated for a partial exit');
    assert.equal(event.rows[0].detail_json.followUp, 'STOCK_PARTIAL_EXIT_PENDING_RECONCILIATION');
    assert.equal((await sweepTerminalSubmittedPlans(query, ACCOUNT, T1)).closed.length, 0, 'the sweep is idempotent');

    // freeze evidence from persisted rows
    const listed = await listStockPartialExitChains(query, ACCOUNT);
    assert.equal(listed.state, 'KNOWN');
    assert.deepEqual(listed.state === 'KNOWN' ? listed.chains.map((chain) => [chain.chainId, chain.filledQuantity, chain.orderedQuantity]) : null, [[id(61), 40, 100]]);
    const evidence = await readStockTerminalExitEvidence(query, ACCOUNT, id(61));
    assert.equal(evidence.state, 'KNOWN');
    assert.equal(evidence.state === 'KNOWN' ? evidence.exits[0]?.filledQuantity : null, 40);
    const replacedChain = await readStockTerminalExitEvidence(query, ACCOUNT, id(62));
    assert.equal(replacedChain.state, 'KNOWN');
    assert.ok(replacedChain.state === 'KNOWN' && replacedChain.exits.every((exit) => exit.filledQuantity === 0),
      'a replaced, unfilled predecessor is not a partial fill; the fully filled exit adds nothing');

    const broker = (quantity: number | null) => ({ state: quantity === null ? 'UNKNOWN' as const : 'KNOWN' as const, quantity, observedAt: quantity === null ? null : T1,
      reason: quantity === null ? 'BROKER_POSITION_UNAVAILABLE' as const : null });
    const freeze = (ledgerShares: number, brokerShares: number | null) => evaluateStockExitFreeze({ evidence, ledgerShares, broker: broker(brokerShares),
      reconciliationQuality: 'GOOD', now: T1 });
    assert.equal(freeze(100, 60).state, 'FROZEN', 'broker holds 60, the ledger still says 100: frozen');
    assert.equal(freeze(100, null).state, 'FROZEN', 'unknown broker truth never clears a freeze');
    assert.equal(freeze(60, 60).state, 'CLEAR', 'cleared only once ledger and broker shares agree again');
    assert.equal(evaluateStockExitFreeze({ evidence: replacedChain, ledgerShares: 100, broker: broker(100), reconciliationQuality: 'GOOD', now: T1 }).state, 'CLEAR',
      'an unfilled predecessor with agreeing shares is not a freeze');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
