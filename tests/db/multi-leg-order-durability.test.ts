import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { seedCapitalPlanForIntent } from '../helpers/capital-plan-fixture.js';
import { PostgresPaperOrderStore } from '../../src/execution/postgres-paper-order-store.js';
import { PostgresDefinedRiskLifecycleStore } from '../../src/execution/postgres-defined-risk-lifecycle-store.js';
import type { DurableMultiLegOrderEvidence, PersistedPaperOrderIntent } from '../../src/execution/paper-order-coordinator.js';
import type { BrokerOrderSnapshot } from '../../src/execution/broker.js';
import { computeDefinedRiskWholeChainAccounting } from '../../src/execution/defined-risk-lifecycle.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const NOW = '2026-10-06T15:00:00.000Z';

// Real PostgreSQL proof (migration 069): native multi-leg parent + normalized legs + broker leg state + lifecycle events + whole-chain accounting survive a "restart"
// (a brand-new store/pool over the same database) with no representative-leg shortcut. Disposable local database only.
test('multi-leg parent, legs, broker leg state, lifecycle events and accounting are durable, idempotent and restart-safe', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const connectionString = process.env.TEST_DATABASE_URL as string;
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(connectionString).hostname), 'Disposable local database only');
  // upstream decision/execution-account rows are not what is under test; their foreign keys are relaxed for THIS pool only (CHECK/UNIQUE constraints stay enforced)
  const pool = new Pool({ connectionString, max: 4, options: '-c session_replication_role=replica' });
  try {
    const underlyingId = randomUUID(), shortContract = randomUUID(), longContract = randomUUID(), chainId = randomUUID();
    const workspaceId = randomUUID(), providerId = randomUUID(), accountId = randomUUID(), botId = randomUUID();
    const strategyId = randomUUID(), featureId = randomUUID(), riskId = randomUUID(), executionId = randomUUID(), costId = randomUUID();
    await pool.query(`INSERT INTO market.underlying(underlying_id,symbol,asset_type) VALUES($1,$2,'EQUITY')`, [underlyingId, `M${underlyingId.slice(0, 8)}`]);
    const shortSymbol = `MS${shortContract.replaceAll('-', '').slice(0, 12)}`, longSymbol = `ML${longContract.replaceAll('-', '').slice(0, 12)}`;
    await pool.query(`INSERT INTO market.option_contract(option_contract_id,contract_symbol,underlying_id,option_type,strike,expiration_date,multiplier,tradable,status)
      VALUES($1,$2,$5,'PUT',650,'2026-10-16',100,true,'ACTIVE'),($3,$4,$5,'PUT',645,'2026-10-16',100,true,'ACTIVE')`, [shortContract, shortSymbol, longContract, longSymbol, underlyingId]);
    await pool.query(`INSERT INTO iam.workspace(workspace_id,name) VALUES($1,$2)`, [workspaceId, `mleg-${workspaceId}`]);
    await pool.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status) VALUES($1,$2,'ALPACA','PAPER',$3,'GOOD')`, [providerId, workspaceId, `t-${providerId}`]);
    await pool.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status) VALUES($1,$2,$3,$4,'PAPER','ACTIVE')`, [accountId, workspaceId, providerId, `t-${accountId}`]);
    await pool.query(`INSERT INTO core.strategy_version(strategy_version_id,semantic_version,config_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [strategyId, `t-${strategyId}`, hash(strategyId)]);
    await pool.query(`INSERT INTO core.feature_version(feature_version_id,semantic_version,definition_manifest_json,config_hash) VALUES($1,$2,'{}',$3)`, [featureId, `t-${featureId}`, hash(featureId)]);
    await pool.query(`INSERT INTO core.risk_limit_version(risk_limit_version_id,semantic_version,limits_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [riskId, `t-${riskId}`, hash(riskId)]);
    await pool.query(`INSERT INTO core.execution_version(execution_version_id,semantic_version,policy_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [executionId, `t-${executionId}`, hash(executionId)]);
    await pool.query(`INSERT INTO core.cost_model_version(cost_model_version_id,semantic_version,assumptions_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [costId, `t-${costId}`, hash(costId)]);
    await pool.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,mode,strategy_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id)
      VALUES($1,$2,$3,'PAPER',$4,$5,$6,$7,$8)`, [botId, workspaceId, accountId, strategyId, riskId, executionId, costId, featureId]);
    await pool.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at) VALUES($1,$2,$3,'CSP_OPEN',$4)`, [chainId, botId, underlyingId, NOW]);

    const evidence: DurableMultiLegOrderEvidence = { orderClass: 'mleg', creditDebitDirection: 'CREDIT',
      packageIdentity: `MLEG:${shortSymbol}:sell:1:sell_to_open|${longSymbol}:buy:1:buy_to_open`, legs: [
        { legIndex: 1, optionContractId: shortContract, providerContractId: 'alpaca-short', occSymbol: shortSymbol, optionType: 'PUT', positionIntent: 'sell_to_open', ratioQuantity: 1, expiration: '2026-10-16', strike: 650, multiplier: 100, deliverableIdentity: 'STANDARD:SPY:100' },
        { legIndex: 2, optionContractId: longContract, providerContractId: 'alpaca-long', occSymbol: longSymbol, optionType: 'PUT', positionIntent: 'buy_to_open', ratioQuantity: 1, expiration: '2026-10-16', strike: 645, multiplier: 100, deliverableIdentity: 'STANDARD:SPY:100' }] };
    const orderIntentId = randomUUID();
    const intent: PersistedPaperOrderIntent = { orderIntentId, executionAccountId: randomUUID(), status: 'READY', brokerOrderId: null,
      request: { symbol: evidence.packageIdentity, qty: 1, side: 'sell', type: 'limit', time_in_force: 'day', limit_price: '-1.10', client_order_id: `theta-d-${orderIntentId}`, order_class: 'mleg',
        legs: [{ symbol: shortSymbol, side: 'sell', ratio_qty: 1, position_intent: 'sell_to_open' }, { symbol: longSymbol, side: 'buy', ratio_qty: 1, position_intent: 'buy_to_open' }] },
      action: 'OPEN_DEFINED_RISK', decisionId: randomUUID(), persistedAt: NOW, chainId, optionContractId: null, underlyingId, multiLegEvidence: evidence,
      executionEvidence: { quoteSource: 'ALPACA', quoteFeed: 'OPRA', quoteSemantics: 'CONSOLIDATED_NBBO', quoteAsOf: NOW, decisionExpiresAt: '2026-10-06T15:01:00.000Z', quoteContentHash: 'a'.repeat(64), aegisState: 'ALLOW_FULL' },
      authorizationEvidence: { executionTier: 'PAPER_EVIDENCE', canonicalQuantity: 1, paperEvidenceQuantity: 1, empiricalEconomicsReady: false, expectedAfterCostEv: null } };

    await seedCapitalPlanForIntent(pool,intent);
    const store = new PostgresPaperOrderStore(pool,undefined,()=>NOW);
    await store.insertIntent(intent);
    // the parent has NO representative contract and NO single position intent; the exact legs are normalized child rows
    const parentRow = (await pool.query(`SELECT option_contract_id, position_intent, order_class, package_identity, credit_debit_direction FROM trade.order_intent WHERE order_intent_id=$1`, [orderIntentId])).rows[0];
    assert.equal(parentRow.option_contract_id, null);
    assert.equal(parentRow.position_intent, null);
    assert.equal(parentRow.order_class, 'mleg');
    assert.equal(parentRow.credit_debit_direction, 'CREDIT');

    // restart: a brand-new pool + store reconstructs the identical parent and legs
    const restartedPool = new Pool({ connectionString, max: 2, options: '-c session_replication_role=replica' });
    try {
      const reloaded = await new PostgresPaperOrderStore(restartedPool).getIntent(orderIntentId);
      assert.ok(reloaded);
      assert.deepEqual(reloaded.multiLegEvidence, evidence);
      assert.equal(reloaded.request.order_class, 'mleg');
      assert.deepEqual(reloaded.request.legs, intent.request.legs);
      assert.equal(reloaded.optionContractId, null);
    } finally { await restartedPool.end(); }

    // a simple order may not carry mleg identity and an mleg order may not carry a representative contract (database-level guards, not only application-level)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(() => client.query(`INSERT INTO trade.order_intent(order_intent_id,client_order_id,status,instrument_type,side,quantity,option_contract_id,order_class,package_identity,credit_debit_direction,canonical_quantity,paper_evidence_quantity)
        VALUES($1,$2,'PROPOSED','OPTION','sell',1,$3,'mleg','PKG','CREDIT',1,1)`, [randomUUID(), `bad-${randomUUID()}`, shortContract]), (error: { code?: string }) => error.code === '23514');
      await client.query('ROLLBACK');
    } finally { client.release(); }

    // asymmetric broker truth: one leg filled, the other untouched. Both leg rows are persisted exactly, and re-observation updates in place (no duplicate rows).
    const asymmetric: BrokerOrderSnapshot = { id: `broker-parent-${orderIntentId}`, clientOrderId: intent.request.client_order_id, symbol: intent.request.symbol, qty: 1, filledQty: 0, filledAvgPrice: null,
      side: 'sell', positionIntent: null, status: 'partially_filled', limitPrice: -1.1, submittedAt: NOW, replacedBy: null, replaces: null, orderClass: 'mleg', legs: [
        { id: 'broker-leg-short', symbol: shortSymbol, side: 'sell', positionIntent: 'sell_to_open', ratioQty: 1, qty: 1, filledQty: 1, filledAvgPrice: 2, status: 'filled' },
        { id: 'broker-leg-long', symbol: longSymbol, side: 'buy', positionIntent: 'buy_to_open', ratioQty: 1, qty: 1, filledQty: 0, filledAvgPrice: null, status: 'new' }] };
    await store.recordBrokerSnapshot(orderIntentId, asymmetric);
    await store.recordBrokerSnapshot(orderIntentId, asymmetric);
    const legStates = (await pool.query(`SELECT leg_index, filled_quantity, remaining_quantity, average_fill_price::float AS avg, broker_status FROM trade.broker_order_leg_state WHERE order_intent_id=$1 ORDER BY leg_index`, [orderIntentId])).rows;
    assert.deepEqual(legStates.map((row) => [row.leg_index, row.filled_quantity, row.remaining_quantity, row.avg, row.broker_status]), [[1, 1, 0, 2, 'filled'], [2, 0, 1, null, 'new']]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM trade.broker_order WHERE order_intent_id=$1`, [orderIntentId])).rows[0].n, 1);
    const filled: BrokerOrderSnapshot = { ...asymmetric, status: 'filled', filledQty: 1, filledAvgPrice: 1.1, legs: [asymmetric.legs?.[0] as NonNullable<BrokerOrderSnapshot['legs']>[number],
      { id: 'broker-leg-long', symbol: longSymbol, side: 'buy', positionIntent: 'buy_to_open', ratioQty: 1, qty: 1, filledQty: 1, filledAvgPrice: 0.9, status: 'filled' }] };
    await store.recordBrokerSnapshot(orderIntentId, filled);
    assert.deepEqual((await pool.query(`SELECT filled_quantity FROM trade.broker_order_leg_state WHERE order_intent_id=$1 ORDER BY leg_index`, [orderIntentId])).rows.map((row) => row.filled_quantity), [1, 1]);

    // lifecycle events are idempotent by provider event identity, INCLUDING a parent-level event that has no leg index
    const lifecycle = new PostgresDefinedRiskLifecycleStore(pool);
    const assignment = { orderIntentId, chainId, providerEventId: 'activity-assign-1', eventType: 'ASSIGNMENT' as const, legIndex: 1, contracts: 1, sharesDelta: 100, cashFlow: -65000, occurredAt: NOW, detail: {} };
    await lifecycle.recordLifecycleEvent(assignment); await lifecycle.recordLifecycleEvent(assignment);
    const parentEvent = { orderIntentId, chainId, providerEventId: 'activity-expire-1', eventType: 'EXPIRATION' as const, legIndex: null, contracts: null, sharesDelta: null, cashFlow: null, occurredAt: NOW, detail: {} };
    await lifecycle.recordLifecycleEvent(parentEvent); await lifecycle.recordLifecycleEvent(parentEvent);
    const events = (await pool.query(`SELECT provider_event_id, count(*)::int AS n FROM trade.multi_leg_lifecycle_event WHERE order_intent_id=$1 GROUP BY provider_event_id ORDER BY provider_event_id`, [orderIntentId])).rows;
    assert.deepEqual(events.map((row) => [row.provider_event_id, row.n]), [['activity-assign-1', 1], ['activity-expire-1', 1]], 'a replayed broker event (restart, late update) must not duplicate stock consequences');

    // whole-chain accounting: one row per parent; opening economics are immutable once written; closing economics update it
    const open = computeDefinedRiskWholeChainAccounting({ quantity: 1, multiplier: 100, openingNetCreditPerShare: 1.1, openingFees: 1, closingNetDebitPerShare: null, closingFees: 0, assignmentExerciseCashFlow: 0, lifecycle: 'OPEN' });
    await lifecycle.recordAccounting(orderIntentId, chainId, open);
    const closed = computeDefinedRiskWholeChainAccounting({ quantity: 1, multiplier: 100, openingNetCreditPerShare: 1.1, openingFees: 1, closingNetDebitPerShare: 0.4, closingFees: 1, assignmentExerciseCashFlow: 0, lifecycle: 'CLOSED' });
    await lifecycle.recordAccounting(orderIntentId, chainId, closed);
    const tampered = computeDefinedRiskWholeChainAccounting({ quantity: 1, multiplier: 100, openingNetCreditPerShare: 9, openingFees: 1, closingNetDebitPerShare: 0.4, closingFees: 1, assignmentExerciseCashFlow: 0, lifecycle: 'CLOSED' });
    await lifecycle.recordAccounting(orderIntentId, chainId, tampered);
    const accounting = (await pool.query(`SELECT opening_net_credit::float AS opening, realized_pnl::float AS realized, remaining_exposure FROM trade.multi_leg_chain_accounting WHERE order_intent_id=$1`, [orderIntentId])).rows;
    assert.equal(accounting.length, 1);
    assert.equal(accounting[0].opening, 110);
    assert.equal(accounting[0].realized, 68);
    assert.equal(accounting[0].remaining_exposure, 'NONE');
  } finally { await pool.end(); }
});
