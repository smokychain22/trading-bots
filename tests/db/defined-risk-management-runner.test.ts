import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { seedCapitalPlanForIntent } from '../helpers/capital-plan-fixture.js';
import type { BrokerMutationAuthorization } from '../../src/execution/execution-control.js';
import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from '../../src/execution/broker.js';
import { PaperOrderCoordinator } from '../../src/execution/paper-order-coordinator.js';
import { PostgresPaperOrderStore } from '../../src/execution/postgres-paper-order-store.js';
import { PostgresDefinedRiskPositionStore, type DefinedRiskPositionSnapshot } from '../../src/execution/postgres-defined-risk-position-store.js';
import { PostgresDefinedRiskDecisionRecorder } from '../../src/execution/postgres-defined-risk-decision-recorder.js';
import { blocksNewRisk, runDefinedRiskManagementScan, type DefinedRiskScanInputs } from '../../src/execution/defined-risk-management-runner.js';
import { control } from '../phase3-exec-fixtures.js';
import { NOW, brokerParent, mlegIntent, seedDefinedRiskWorld } from '../helpers/defined-risk-db-fixture.js';

const url = process.env.TEST_DATABASE_URL;

// the shared disposable database also holds spreads created by other tests; scope the scan to the one this test created
class ScopedPositions extends PostgresDefinedRiskPositionStore {
  constructor(pool: Pool, private readonly only: string) { super(pool); }
  override async activePositions(): Promise<readonly DefinedRiskPositionSnapshot[]> { return (await super.activePositions()).filter((position) => position.orderIntentId === this.only); }
}
class CrashBeforeSubmit extends PaperOrderCoordinator {
  override async submit(): Promise<never> { throw new Error('PROCESS_KILLED_BEFORE_SUBMIT'); }
}

class RecordingBroker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const; readonly environment = 'PAPER' as const;
  readonly submitted: BrokerOrderRequest[] = [];
  async getAccount() { return {}; } async getPositions() { return []; } async getOrders() { return []; } async getActivities() { return []; }
  async getOrder() { return null; } async getOrderByClientOrderId() { return null; }
  async submitOrder(request: BrokerOrderRequest, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot> {
    void authorization;
    this.submitted.push(request);
    return { id: `broker-${randomUUID()}`, clientOrderId: request.client_order_id, symbol: request.symbol, qty: request.qty, filledQty: 0, filledAvgPrice: null, side: request.side, positionIntent: null,
      status: 'accepted', limitPrice: Number(request.limit_price), submittedAt: NOW, replacedBy: null, replaces: null, orderClass: 'mleg',
      legs: (request.legs ?? []).map((leg, index) => ({ id: `leg-${index}-${randomUUID()}`, symbol: leg.symbol, side: leg.side, positionIntent: leg.position_intent, ratioQty: leg.ratio_qty, qty: request.qty, filledQty: 0, filledAvgPrice: null, status: 'new' })) };
  }
  async replaceOrder(): Promise<BrokerOrderSnapshot> { throw new Error('NOT_USED'); }
  async cancelOrder(): Promise<void> { throw new Error('NOT_USED'); }
}

async function setup() {
  assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString: url, max: 4, options: '-c session_replication_role=replica' });
  const world = await seedDefinedRiskWorld(pool);
  const orders = new PostgresPaperOrderStore(pool,undefined,()=>NOW), recorder = new PostgresDefinedRiskDecisionRecorder(pool);
  const broker = new RecordingBroker();
  const coordinator = new PaperOrderCoordinator(broker, orders, control({ masterEnabled: true, pauseNewOrders: false }));
  const chainId = randomUUID();
  const base = new PostgresDefinedRiskPositionStore(pool);
  await base.ensureDefinedRiskChain({ chainId, botInstanceId: world.botInstanceId, underlyingId: world.underlyingId, openedAt: NOW });
  const open = mlegIntent(world, chainId, false);
  await seedCapitalPlanForIntent(pool,open);
  await orders.insertIntent(open);
  await pool.query(`INSERT INTO trade.decision(decision_id,fusion_snapshot_id,decision_kind,action_code,quantity,decided_at,status) VALUES($1,$2,'NEW_RISK','OPEN_DEFINED_RISK',1,$3,'READY')`, [open.decisionId, randomUUID(), NOW]);
  await base.register(open.orderIntentId);
  const positions = new ScopedPositions(pool, open.orderIntentId);
  for (const [from, to] of [['READY', 'SUBMITTING'], ['SUBMITTING', 'SUBMITTED'], ['SUBMITTED', 'FILLED']] as const) await orders.transitionIntent(open.orderIntentId, from, to);
  await orders.recordBrokerSnapshot(open.orderIntentId, brokerParent(open, 'open', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
  const executionAccountId = open.executionAccountId;
  const inputs = (patch: Partial<DefinedRiskScanInputs> = {}): DefinedRiskScanInputs => ({ brokerOpenContracts: { short: 1, long: 1 },
    shortQuote: { symbol: world.shortSymbol, bid: 1.9, ask: 2.0, observedAt: NOW }, longQuote: { symbol: world.longSymbol, bid: 0.8, ask: 0.9, observedAt: NOW }, spot: 670, dte: 1, marketOpen: true,
    context: { eventState: 'CLEAR', aegisState: 'ALLOW_FULL', executionQuality: 'GOOD' }, aegisState: 'ALLOW_FULL', executionAccountId, ...patch });
  const deps = (load: (position: DefinedRiskPositionSnapshot, at: string) => Promise<DefinedRiskScanInputs>) => ({ positions, orders, coordinator, loadInputs: load,
    recordDecision: (decision: Parameters<PostgresDefinedRiskDecisionRecorder['record']>[0], position: DefinedRiskPositionSnapshot, frontier: Parameters<PostgresDefinedRiskDecisionRecorder['record']>[2]) => recorder.record(decision, position, frontier),
    nextCloseAttempt: (id: string) => recorder.nextCloseAttempt(id), pinBandPct: 0.002, maximumQuoteAgeSeconds: 30, decisionWindowSeconds: 60, mayClose: true, now: () => NOW });
  return { pool, world, orders, positions, broker, coordinator, open, chainId, inputs, deps };
}

test('a safety trigger closes the spread through the coordinator exactly once; a second scan, and a restart, never submit a second close', { skip: !url }, async () => {
  const ctx = await setup();
  try {
    const first = await runDefinedRiskManagementScan(ctx.deps(async () => ctx.inputs()));
    const mine = first.find((result) => result.orderIntentId === ctx.open.orderIntentId);
    assert.ok(mine);
    assert.equal(mine.action, 'CLOSE_FULL');
    assert.ok(mine.closeIntentId);
    assert.equal(ctx.broker.submitted.length, 1, 'one native package, one broker mutation');
    const request = ctx.broker.submitted[0] as BrokerOrderRequest;
    assert.equal(request.order_class, 'mleg');
    assert.equal(Number(request.limit_price), 1.2, 'short ask 2.00 - long bid 0.80 (the store reloads numeric(20,8), so compare numerically)');
    assert.deepEqual(request.legs?.map((leg) => leg.position_intent), ['buy_to_close', 'sell_to_close']);
    // the decision is a durable, auditable trade.decision the close references
    const decisionRow = (await ctx.pool.query(`SELECT d.decision_kind, d.action_code, d.receipt_json->>'evidenceSnapshotSource' AS source FROM trade.order_intent oi JOIN trade.decision d ON d.decision_id=oi.decision_id WHERE oi.order_intent_id=$1`, [mine.closeIntentId])).rows[0];
    assert.deepEqual({ ...decisionRow }, { decision_kind: 'MANAGEMENT', action_code: 'CLOSE_DEFINED_RISK', source: 'ENTRY_DECISION_FUSION_SNAPSHOT' });

    // second scan: the close is in flight, so the decision is HOLD (CLOSE_ORDER_IN_FLIGHT) and the broker sees nothing new
    const second = await runDefinedRiskManagementScan(ctx.deps(async () => ctx.inputs()));
    const again = second.find((result) => result.orderIntentId === ctx.open.orderIntentId);
    assert.equal(again?.action, 'HOLD');
    assert.deepEqual(again?.reasons, ['CLOSE_ORDER_IN_FLIGHT']);
    assert.equal(ctx.broker.submitted.length, 1);
    // restart: a brand-new coordinator/store/runner over the same database
    const restartedPool = new Pool({ connectionString: url, max: 2, options: '-c session_replication_role=replica' });
    try {
      const restartedOrders = new PostgresPaperOrderStore(restartedPool), restartedPositions = new ScopedPositions(restartedPool, ctx.open.orderIntentId);
      const restartedRecorder = new PostgresDefinedRiskDecisionRecorder(restartedPool);
      const restarted = await runDefinedRiskManagementScan({ ...ctx.deps(async () => ctx.inputs()), positions: restartedPositions, orders: restartedOrders,
        coordinator: new PaperOrderCoordinator(ctx.broker, restartedOrders, control({ masterEnabled: true, pauseNewOrders: false })),
        recordDecision: (decision, position, frontier) => restartedRecorder.record(decision, position, frontier), nextCloseAttempt: (id) => restartedRecorder.nextCloseAttempt(id) });
      assert.equal(restarted.find((result) => result.orderIntentId === ctx.open.orderIntentId)?.action, 'HOLD');
      assert.equal(ctx.broker.submitted.length, 1);
    } finally { await restartedPool.end(); }
  } finally { await ctx.pool.end(); }
});

test('a crash after the close intent was persisted but before submit resumes at the READY intent: no second prepare, exactly one submit', { skip: !url }, async () => {
  const ctx = await setup();
  try {
    const crashing = new CrashBeforeSubmit(ctx.broker, ctx.orders, control({ masterEnabled: true, pauseNewOrders: false }));
    // pass 1 persists the close intent, then the process dies before anything reaches the broker
    await assert.rejects(() => runDefinedRiskManagementScan({ ...ctx.deps(async () => ctx.inputs()), coordinator: crashing }), /PROCESS_KILLED_BEFORE_SUBMIT/);
    assert.equal(ctx.broker.submitted.length, 0);
    const persisted = (await ctx.pool.query(`SELECT order_intent_id::text AS id, status::text AS status FROM trade.order_intent WHERE chain_id=$1 AND theta_action='CLOSE_DEFINED_RISK'`, [ctx.chainId])).rows as Array<{ id: string; status: string }>;
    assert.deepEqual(persisted.map((row) => row.status), ['READY'], 'exactly one durable, never-submitted close intent');
    // restart: the SAME intent (deterministic id) is submitted once; nothing is prepared twice
    const resumed = await runDefinedRiskManagementScan(ctx.deps(async () => ctx.inputs()));
    assert.equal(resumed.find((result) => result.orderIntentId === ctx.open.orderIntentId)?.closeIntentId, persisted[0]?.id);
    assert.equal(ctx.broker.submitted.length, 1);
    assert.equal((await ctx.pool.query(`SELECT count(*)::int AS n FROM trade.order_intent WHERE chain_id=$1 AND theta_action='CLOSE_DEFINED_RISK'`, [ctx.chainId])).rows[0].n, 1);
    const after = await runDefinedRiskManagementScan(ctx.deps(async () => ctx.inputs()));
    assert.equal(after.find((result) => result.orderIntentId === ctx.open.orderIntentId)?.action, 'HOLD');
    assert.equal(ctx.broker.submitted.length, 1);
  } finally { await ctx.pool.end(); }
});

test('a missing hedge is an emergency: escalated, persisted, blocks new risk, and NO improvised order is sent; unknown inputs are UNKNOWN, never a pass', { skip: !url }, async () => {
  const ctx = await setup();
  try {
    const emergency = await runDefinedRiskManagementScan(ctx.deps(async () => ctx.inputs({ brokerOpenContracts: { short: 1, long: 0 } })));
    const mine = emergency.find((result) => result.orderIntentId === ctx.open.orderIntentId);
    assert.equal(mine?.action, 'EMERGENCY_UNHEDGED_SHORT');
    assert.equal(mine?.selectedAction, 'EMERGENCY_RISK_REDUCTION', 'the v3 management frontier, not the producer, makes the final selection');
    const persisted = (await ctx.pool.query(`SELECT action_code, receipt_json->'managementActionFrontier'->>'contractVersion' AS version,
        receipt_json->'managementActionFrontier'->>'lifecycleState' AS lifecycle FROM trade.decision
      WHERE decision_kind='MANAGEMENT' AND receipt_json->>'orderIntentId'=$1 AND action_code='EMERGENCY_RISK_REDUCTION'`, [ctx.open.orderIntentId])).rows[0];
    assert.deepEqual(persisted, { action_code: 'EMERGENCY_RISK_REDUCTION', version: 'theta-management-action-frontier-v3', lifecycle: 'DEFINED_RISK_OPEN' });
    assert.equal(mine?.escalate, true);
    assert.equal(mine?.closeIntentId, null);
    assert.equal(blocksNewRisk(emergency), true);
    assert.equal(ctx.broker.submitted.length, 0);

    const unknown = await runDefinedRiskManagementScan(ctx.deps(async () => { throw new Error('PROVIDER_DOWN'); }));
    const unknownMine = unknown.find((result) => result.orderIntentId === ctx.open.orderIntentId);
    assert.equal(unknownMine?.action, 'WAIT_FOR_BROKER_TRUTH');
    assert.ok(unknownMine?.reasons.includes('MANAGEMENT_INPUTS_UNAVAILABLE'));
    assert.equal(unknownMine?.escalate, true);
    assert.equal(ctx.broker.submitted.length, 0);
    const recorded = (await ctx.pool.query(`SELECT count(*)::int AS n FROM trade.decision WHERE decision_kind='MANAGEMENT' AND receipt_json->>'orderIntentId'=$1`, [ctx.open.orderIntentId])).rows[0] as { n: number };
    assert.ok(recorded.n >= 2, 'every pass leaves a durable decision, including the unknown-input one');
  } finally { await ctx.pool.end(); }
});

test('an inert scan: with no active spread the runner does nothing at all', { skip: !url }, async () => {
  assert.ok(url);
  const pool = new Pool({ connectionString: url, max: 2, options: '-c session_replication_role=replica' });
  try {
    const orders = new PostgresPaperOrderStore(pool), recorder = new PostgresDefinedRiskDecisionRecorder(pool);
    const broker = new RecordingBroker();
    // only terminal / absent positions remain for this assertion: filter to a fresh empty world by checking no result references an unknown id
    const results = await runDefinedRiskManagementScan({ positions: new ScopedPositions(pool, randomUUID()), orders,
      coordinator: new PaperOrderCoordinator(broker, orders, control({ masterEnabled: true, pauseNewOrders: false })), loadInputs: async () => { throw new Error('MUST_NOT_BE_CALLED'); },
      recordDecision: (decision, position, frontier) => recorder.record(decision, position, frontier), nextCloseAttempt: (id) => recorder.nextCloseAttempt(id), pinBandPct: 0.002, maximumQuoteAgeSeconds: 30, decisionWindowSeconds: 60, mayClose: true, now: () => NOW });
    assert.deepEqual(results, []);
    assert.equal(broker.submitted.length, 0);
  } finally { await pool.end(); }
});
