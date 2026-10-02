import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { applyConfirmedFillLifecycle } from '../../src/execution/postgres-broker-fill-lifecycle-orchestrator.js';
import { applyConfirmedTerminalLifecycle } from '../../src/execution/postgres-broker-lifecycle-orchestrator.js';
import { PostgresLifecycleApplicationStore } from '../../src/theta/postgres-lifecycle-application-store.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

test('multi-lot stock disposal and call-away: every open lot is disposed with its own basis, atomically, and a partial coverage rolls back', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  const now = '2026-09-12T15:00:00.000Z';
  try {
    const workspaceId = randomUUID(), providerId = randomUUID(), accountId = randomUUID(), botId = randomUUID();
    const strategyId = randomUUID(), featureId = randomUUID(), riskId = randomUUID(), executionId = randomUUID(), costId = randomUUID();
    const underlyingId = randomUUID();
    await pool.query(`INSERT INTO iam.workspace(workspace_id,name) VALUES($1,$2)`, [workspaceId, `lots-${workspaceId}`]);
    await pool.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status)
      VALUES($1,$2,'ALPACA','PAPER',$3,'GOOD')`, [providerId, workspaceId, `test-${providerId}`]);
    await pool.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status)
      VALUES($1,$2,$3,$4,'PAPER','ACTIVE')`, [accountId, workspaceId, providerId, `test-${accountId}`]);
    await pool.query(`INSERT INTO core.strategy_version(strategy_version_id,semantic_version,config_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [strategyId, `test-${strategyId}`, hash(strategyId)]);
    await pool.query(`INSERT INTO core.feature_version(feature_version_id,semantic_version,definition_manifest_json,config_hash) VALUES($1,$2,'{}',$3)`, [featureId, `test-${featureId}`, hash(featureId)]);
    await pool.query(`INSERT INTO core.risk_limit_version(risk_limit_version_id,semantic_version,limits_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [riskId, `test-${riskId}`, hash(riskId)]);
    await pool.query(`INSERT INTO core.execution_version(execution_version_id,semantic_version,policy_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [executionId, `test-${executionId}`, hash(executionId)]);
    await pool.query(`INSERT INTO core.cost_model_version(cost_model_version_id,semantic_version,assumptions_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [costId, `test-${costId}`, hash(costId)]);
    await pool.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,mode,strategy_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id)
      VALUES($1,$2,$3,'PAPER',$4,$5,$6,$7,$8)`, [botId, workspaceId, accountId, strategyId, riskId, executionId, costId, featureId]);
    await pool.query(`INSERT INTO market.underlying(underlying_id,symbol,asset_type) VALUES($1,$2,'EQUITY')`, [underlyingId, `L${underlyingId.slice(0, 8)}`]);
    const callContract = randomUUID();
    await pool.query(`INSERT INTO market.option_contract(option_contract_id,contract_symbol,underlying_id,option_type,strike,expiration_date,multiplier,tradable,status)
      VALUES($1,$2,$3,'CALL',55,'2026-11-20',100,true,'ACTIVE')`, [callContract, `C${callContract.replaceAll('-', '')}`, underlyingId]);

    const store = new PostgresLifecycleApplicationStore(pool);
    const makeChain = async (state: 'RECOVERY_WAIT' | 'CC_OPEN', lots: readonly [string, number, number][]) => {
      const chainId = randomUUID();
      await pool.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at) VALUES($1,$2,$3,$4,$5)`, [chainId, botId, underlyingId, state, now]);
      for (const [index, [lotId, shares, basis]] of lots.entries()) {
        await pool.query(`INSERT INTO trade.stock_lot(stock_lot_id,chain_id,underlying_id,shares,economic_basis_per_share,acquired_at) VALUES($1,$2,$3,$4,$5,$6)`,
          [lotId, chainId, underlyingId, shares, basis, new Date(Date.parse(now) + index * 60_000).toISOString()]);
      }
      return chainId;
    };
    const lotRows = async (chainId: string) => (await pool.query(
      `SELECT stock_lot_id::text AS id, disposed_at, disposed_price_per_share::float8 AS price, realized_pnl::float8 AS pnl FROM trade.stock_lot WHERE chain_id=$1 ORDER BY acquired_at`, [chainId])).rows;
    const state = async (chainId: string) => (await pool.query(`SELECT lifecycle_state, closed_at FROM trade.economic_chain WHERE chain_id=$1`, [chainId])).rows[0];

    // --- multi-lot full-position sale: 100@50 + 150@52 sold at 49
    const [a, b] = [randomUUID(), randomUUID()];
    const chain = await makeChain('RECOVERY_WAIT', [[a, 100, 50], [b, 150, 52]]);
    const sale = { eventKind: 'STOCK_DISPOSAL' as const, evidenceKey: hash('sale-' + chain), chainId: chain, occurredAt: now, decisionId: null,
      providerActivityRefHash: null, stockLotId: a, disposedPricePerShare: 49, realizedStockPnl: -100,
      additionalStockLots: [{ stockLotId: b, realizedStockPnl: -450 }] };

    // a disposal that covers only the first lot would close the chain over live stock: rejected and rolled back
    await assert.rejects(() => store.apply({ ...sale, evidenceKey: hash('partial-' + chain), additionalStockLots: undefined }), /STOCK_DISPOSAL_LEAVES_OPEN_LOTS/);
    assert.deepEqual((await lotRows(chain)).map((r) => r.disposed_at), [null, null], 'rolled back: no lot disposed');
    assert.equal((await state(chain)).lifecycle_state, 'RECOVERY_WAIT');
    // wrong lot P&L (one basis applied to all) is rejected
    await assert.rejects(() => store.apply({ ...sale, evidenceKey: hash('blend-' + chain), realizedStockPnl: -250, additionalStockLots: [{ stockLotId: b, realizedStockPnl: -300 }] }), /STOCK_DISPOSAL_ECONOMICS_INVALID/);
    // the same lot twice, and a lot from another chain, are rejected
    await assert.rejects(() => store.apply({ ...sale, evidenceKey: hash('dup-' + chain), additionalStockLots: [{ stockLotId: a, realizedStockPnl: -100 }] }), /OPEN_STOCK_LOT_NOT_FOUND/);
    assert.deepEqual((await lotRows(chain)).map((r) => r.disposed_at), [null, null]);

    const applied = await store.apply(sale);
    assert.equal(applied.finalState, 'CLOSED');
    const rows = await lotRows(chain);
    assert.deepEqual(rows.map((r) => [r.id, r.price, r.pnl]), [[a, 49, -100], [b, 49, -450]]);
    assert.ok(rows.every((r) => r.disposed_at !== null));
    const total = await pool.query(`SELECT sum(realized_pnl)::float8 AS pnl FROM trade.stock_lot WHERE chain_id=$1`, [chain]);
    assert.equal(total.rows[0].pnl, -550, 'whole-chain stock P&L is the sum of the lot allocations');
    assert.equal((await store.apply(sale)).duplicate, true, 'replay of the same fill set is idempotent');
    assert.deepEqual((await lotRows(chain)).map((r) => r.pnl), [-100, -450]);

    // --- multi-lot call-away: 2 contracts deliver 200 shares from two 100-share lots
    const [c, d] = [randomUUID(), randomUUID()];
    const callChain = await makeChain('CC_OPEN', [[c, 100, 50], [d, 100, 52]]);
    const callLeg = randomUUID();
    await pool.query(`INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,side,quantity,entry_price_per_share,entry_credit_debit,opened_at)
      VALUES($1,$2,$3,'SHORT',2,1,200,$4)`, [callLeg, callChain, callContract, now]);
    const callAway = { eventKind: 'COVERED_CALL_ASSIGNMENT' as const, evidenceKey: hash('callaway-' + callChain), chainId: callChain, occurredAt: now, decisionId: null,
      providerActivityRefHash: hash('activity-' + callChain), optionLegId: callLeg, stockLotId: c, shares: 200, strikePrice: 55, realizedOptionPnl: 200,
      realizedStockPnl: 500, additionalStockLots: [{ stockLotId: d, realizedStockPnl: 300 }] };
    await assert.rejects(() => store.apply({ ...callAway, evidenceKey: hash('callaway-partial-' + callChain), additionalStockLots: undefined }), /(STOCK_DISPOSAL_LEAVES_OPEN_LOTS|CALL_AWAY_STOCK_ECONOMICS_INVALID)/);
    assert.equal((await state(callChain)).lifecycle_state, 'CC_OPEN');
    assert.deepEqual((await lotRows(callChain)).map((r) => r.disposed_at), [null, null]);
    const away = await store.apply(callAway);
    assert.equal(away.finalState, 'CLOSED');
    assert.deepEqual((await lotRows(callChain)).map((r) => [r.price, r.pnl]), [[55, 500], [55, 300]]);
    const events = await pool.query(`SELECT stock_lot_id::text AS id, shares::float8 AS shares FROM trade.assignment_event WHERE option_leg_id=$1 ORDER BY stock_lot_id`, [callLeg]);
    assert.equal(events.rows.reduce((sum, row) => sum + row.shares, 0), 200, 'assigned shares allocated exactly once across the lots');

    // --- the two orchestrator queries (aggregated open lots) compile and run against the migrated schema
    const none = '00000000-0000-0000-0000-000000000000';
    const fillReport = await applyConfirmedFillLifecycle(pool, none, now);
    assert.equal(fillReport.inspected, 0);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      const snapshotSql = `INSERT INTO trade.broker_reconciliation_snapshot(reconciliation_snapshot_id,connection_id,correlation_id,environment,broker_host,observed_at,data_quality,payload_hash)
        VALUES($1,$2,$3,'PAPER','paper-api.alpaca.markets',$4,'GOOD',$5)`;
      await client.query(snapshotSql, [randomUUID(), none, 'lots-prev', new Date(Date.parse(now) - 60_000).toISOString(), 'b'.repeat(64)]);
      const current = randomUUID();
      await client.query(snapshotSql, [current, none, 'lots-current', now, 'c'.repeat(64)]);
      const terminal = await applyConfirmedTerminalLifecycle({ query: (text: string, values?: unknown[]) => client.query(text, values) } as never, none, current, now);
      assert.equal(terminal.inspected, 0);
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
  } finally { await pool.end(); }
});
