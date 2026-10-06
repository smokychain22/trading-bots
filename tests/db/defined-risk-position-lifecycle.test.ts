import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresPaperOrderStore } from '../../src/execution/postgres-paper-order-store.js';
import { PostgresDefinedRiskLifecycleStore } from '../../src/execution/postgres-defined-risk-lifecycle-store.js';
import { PostgresDefinedRiskPositionStore } from '../../src/execution/postgres-defined-risk-position-store.js';
import type { OrderIntentState } from '../../src/theta/order-intent-state.js';
import { NOW, brokerParent, mlegIntent, seedDefinedRiskWorld, type DefinedRiskWorld } from '../helpers/defined-risk-db-fixture.js';

// Real PostgreSQL proof of the whole D position lifecycle (migration 069): state is recomputed from durable per-leg broker truth, so every scenario also survives a restart
// (a brand-new pool/store over the same database must reach the same answer).
const url = process.env.TEST_DATABASE_URL;
const at = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

async function withWorld(run: (ctx: { pool: Pool; world: DefinedRiskWorld; orders: PostgresPaperOrderStore; positions: PostgresDefinedRiskPositionStore; events: PostgresDefinedRiskLifecycleStore;
  restarted: () => Promise<{ positions: PostgresDefinedRiskPositionStore; close: () => Promise<void> }> }) => Promise<void>): Promise<void> {
  assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Disposable local database only');
  // upstream decision/execution-account rows are not what is under test; their foreign keys are relaxed for THIS pool only
  const options = '-c session_replication_role=replica';
  const pool = new Pool({ connectionString: url, max: 4, options });
  try {
    const world = await seedDefinedRiskWorld(pool);
    await run({ pool, world, orders: new PostgresPaperOrderStore(pool), positions: new PostgresDefinedRiskPositionStore(pool), events: new PostgresDefinedRiskLifecycleStore(pool),
      restarted: async () => { const fresh = new Pool({ connectionString: url, max: 2, options }); return { positions: new PostgresDefinedRiskPositionStore(fresh), close: () => fresh.end() }; } });
  } finally { await pool.end(); }
}

async function openSpread(ctx: { pool: Pool; world: DefinedRiskWorld; orders: PostgresPaperOrderStore; positions: PostgresDefinedRiskPositionStore }, quantity = 1) {
  const chainId = randomUUID();
  await ctx.positions.ensureDefinedRiskChain({ chainId, botInstanceId: ctx.world.botInstanceId, underlyingId: ctx.world.underlyingId, openedAt: NOW });
  const intent = mlegIntent(ctx.world, chainId, false, quantity);
  await ctx.orders.insertIntent(intent);
  await ctx.positions.register(intent.orderIntentId);
  return { chainId, intent };
}
async function moveTo(orders: PostgresPaperOrderStore, id: string, path: readonly OrderIntentState[], start: OrderIntentState = 'READY'): Promise<void> {
  let from: OrderIntentState = start;
  for (const to of path) { await orders.transitionIntent(id, from, to); from = to; }
}
const row = async (pool: Pool, sql: string, values: unknown[]) => (await pool.query(sql, values)).rows[0] as Record<string, unknown>;

test('open: a naked short while the long leg is unfilled is an emergency, a full hedged fill is OPEN, accounting uses the ACTUAL leg fills', { skip: !url }, async () => {
  await withWorld(async (ctx) => {
    const { chainId, intent } = await openSpread(ctx);
    await moveTo(ctx.orders, intent.orderIntentId, ['SUBMITTING', 'SUBMITTED', 'PARTIAL']);
    await ctx.orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, 'p1', { filled: 1, avg: 2.0 }, { filled: 0, avg: null }, 'partially_filled'));
    const emergency = await ctx.positions.refresh(intent.orderIntentId, at(1));
    assert.equal(emergency.state, 'DIVERGED_EMERGENCY');
    assert.deepEqual(emergency.reasons, ['NAKED_SHORT_PUT_EXPOSURE']);
    assert.equal(emergency.exposure.nakedShortContracts, 1);

    await moveTo(ctx.orders, intent.orderIntentId, ['FILLED'], 'PARTIAL');
    await ctx.orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, 'p1', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    const healed = await ctx.positions.refresh(intent.orderIntentId, at(2));
    assert.equal(healed.state, 'OPEN', 'the emergency clears only because broker truth now shows both legs');
    assert.equal(healed.exposure.hedgedSpreads, 1);
    const accounting = await row(ctx.pool, `SELECT opening_net_credit::float AS credit, pnl_state, remaining_exposure FROM trade.multi_leg_chain_accounting WHERE order_intent_id=$1`, [intent.orderIntentId]);
    assert.equal(accounting.credit, 110, '(2.00 - 0.90) x 100 from the actual per-leg average fills, not from the requested -1.10 limit');
    assert.equal(accounting.pnl_state, 'OPEN');
    assert.equal(accounting.remaining_exposure, 'OPEN_SPREAD');
    // the Wheel loaders can not see this chain (chain_kind) and the spread has no Wheel lifecycle state of its own
    assert.equal((await row(ctx.pool, `SELECT chain_kind, lifecycle_state::text AS s FROM trade.economic_chain WHERE chain_id=$1`, [chainId])).chain_kind, 'DEFINED_RISK');

    // restart: a brand-new store derives the identical state from durable rows alone
    const fresh = await ctx.restarted();
    try { assert.equal((await fresh.positions.refresh(intent.orderIntentId, at(3))).state, 'OPEN'); } finally { await fresh.close(); }
    assert.deepEqual((await ctx.positions.activePositions()).filter((position) => position.orderIntentId === intent.orderIntentId).map((position) => position.state), ['OPEN']);
  });
});

test('registration sweep: a D open becomes a managed position once the broker fills any leg (a naked short is caught at once); no fill is no position; replay registers nothing new', { skip: !url }, async () => {
  await withWorld(async (ctx) => {
    const chainId = randomUUID();
    await ctx.positions.ensureDefinedRiskChain({ chainId, botInstanceId: ctx.world.botInstanceId, underlyingId: ctx.world.underlyingId, openedAt: NOW });
    const intent = mlegIntent(ctx.world, chainId, false, 1);
    await ctx.orders.insertIntent(intent);
    await moveTo(ctx.orders, intent.orderIntentId, ['SUBMITTING', 'SUBMITTED']);
    assert.ok(!(await ctx.positions.registerFilledOpens(at(1))).includes(intent.orderIntentId), 'a working order with no fill is pending exposure, not a position');
    await moveTo(ctx.orders, intent.orderIntentId, ['PARTIAL'], 'SUBMITTED');
    await ctx.orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, 'p-sweep', { filled: 1, avg: 2.0 }, { filled: 0, avg: null }, 'partially_filled'));
    assert.ok((await ctx.positions.registerFilledOpens(at(2))).includes(intent.orderIntentId));
    assert.equal((await ctx.positions.get(intent.orderIntentId)).state, 'DIVERGED_EMERGENCY', 'the sweep refreshes at once: a filled short without its long is an emergency now');
    assert.ok(await ctx.positions.hasEmergency(), 'and it blocks new risk');
    assert.ok(!(await ctx.positions.registerFilledOpens(at(3))).includes(intent.orderIntentId), 'idempotent');
    await moveTo(ctx.orders, intent.orderIntentId, ['FILLED'], 'PARTIAL');
    await ctx.orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, 'p-sweep', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    assert.equal((await ctx.positions.refresh(intent.orderIntentId, at(4))).state, 'OPEN');
  });
});

test('close: partial two-leg close is CLOSE_PENDING, both legs closed is CLOSED, and after-fee P&L stays UNKNOWN until a fee is recorded (never zero)', { skip: !url }, async () => {
  await withWorld(async (ctx) => {
    const { chainId, intent } = await openSpread(ctx);
    await moveTo(ctx.orders, intent.orderIntentId, ['SUBMITTING', 'SUBMITTED', 'FILLED']);
    await ctx.orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, 'o1', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    await ctx.positions.refresh(intent.orderIntentId, at(1));

    const close = mlegIntent(ctx.world, chainId, true);
    await ctx.orders.insertIntent(close);
    await moveTo(ctx.orders, close.orderIntentId, ['SUBMITTING', 'SUBMITTED']);
    const pending = await ctx.positions.refresh(intent.orderIntentId, at(2));
    assert.equal(pending.state, 'CLOSE_PENDING', 'a working close order means the spread is not simply OPEN');

    await moveTo(ctx.orders, close.orderIntentId, ['FILLED'], 'SUBMITTED');
    await ctx.orders.recordBrokerSnapshot(close.orderIntentId, brokerParent(close, 'c1', { filled: 1, avg: 1.0 }, { filled: 1, avg: 0.6 }, 'filled'));
    const closed = await ctx.positions.refresh(intent.orderIntentId, at(3));
    assert.equal(closed.state, 'CLOSED');
    const before = await row(ctx.pool, `SELECT realized_pnl, realized_pnl_before_fees::float AS before_fees, pnl_state, remaining_exposure, closing_net_debit::float AS debit FROM trade.multi_leg_chain_accounting WHERE order_intent_id=$1`, [intent.orderIntentId]);
    assert.equal(before.debit, 40, 'closing debit = (1.00 - 0.60) x 100 from the two actual close fills');
    assert.equal(before.before_fees, 70);
    assert.equal(before.realized_pnl, null, 'fees are unknown: the after-fee figure is UNKNOWN, not zero-fee');
    assert.equal(before.pnl_state, 'REALIZED_BEFORE_FEES');
    assert.equal(before.remaining_exposure, 'NONE');

    await ctx.pool.query(`INSERT INTO trade.fee_event(chain_id,fee_type,amount,incurred_at) VALUES($1,'REGULATORY',2.5,$2)`, [chainId, at(3)]);
    await ctx.positions.refresh(intent.orderIntentId, at(4));
    const after = await row(ctx.pool, `SELECT realized_pnl::float AS realized, pnl_state FROM trade.multi_leg_chain_accounting WHERE order_intent_id=$1`, [intent.orderIntentId]);
    assert.equal(after.realized, 67.5);
    assert.equal(after.pnl_state, 'REALIZED');
    // a terminal state is never left, even if a stale snapshot later disagrees
    await ctx.orders.recordBrokerSnapshot(close.orderIntentId, brokerParent(close, 'c1', { filled: 0, avg: null }, { filled: 0, avg: null }, 'new'));
    assert.equal((await ctx.positions.refresh(intent.orderIntentId, at(5))).state, 'CLOSED');
    assert.equal((await ctx.positions.activePositions()).some((position) => position.orderIntentId === intent.orderIntentId), false);
  });
});

test('expiry: a broker-confirmed parent expiration is EXPIRED_WORTHLESS and replaying the same broker event changes nothing', { skip: !url }, async () => {
  await withWorld(async (ctx) => {
    const { chainId, intent } = await openSpread(ctx);
    await moveTo(ctx.orders, intent.orderIntentId, ['SUBMITTING', 'SUBMITTED', 'FILLED']);
    await ctx.orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, 'e1', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    assert.equal((await ctx.positions.refresh(intent.orderIntentId, at(1))).state, 'OPEN');
    const expiration = { orderIntentId: intent.orderIntentId, chainId, providerEventId: 'opexp-1', eventType: 'EXPIRATION' as const, legIndex: null, contracts: null, sharesDelta: null, cashFlow: null, occurredAt: at(10), detail: {} };
    await ctx.events.recordLifecycleEvent(expiration); await ctx.events.recordLifecycleEvent(expiration);
    const result = await ctx.positions.refresh(intent.orderIntentId, at(11));
    assert.equal(result.state, 'EXPIRED_WORTHLESS');
    assert.equal(result.stockChainId, null);
    const accounting = await row(ctx.pool, `SELECT realized_pnl_before_fees::float AS before_fees, closing_net_debit::float AS debit FROM trade.multi_leg_chain_accounting WHERE order_intent_id=$1`, [intent.orderIntentId]);
    assert.equal(accounting.debit, 0, 'an expiry has no closing order: the closing debit is zero by definition');
    assert.equal(accounting.before_fees, 110, 'the full opening credit is kept');
  });
});

test('assignment: short assigned + long open is ASYMMETRIC; once the long leg is gone the broker-delivered shares become ONE Wheel recovery chain that keeps the origin chain id', { skip: !url }, async () => {
  await withWorld(async (ctx) => {
    const { chainId, intent } = await openSpread(ctx);
    await moveTo(ctx.orders, intent.orderIntentId, ['SUBMITTING', 'SUBMITTED', 'FILLED']);
    await ctx.orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, 'a1', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    await ctx.positions.refresh(intent.orderIntentId, at(1));
    await ctx.events.recordLifecycleEvent({ orderIntentId: intent.orderIntentId, chainId, providerEventId: 'opasn-1', eventType: 'ASSIGNMENT', legIndex: 1, contracts: 1, sharesDelta: 100, cashFlow: -65000, occurredAt: at(10), detail: {} });
    const asymmetric = await ctx.positions.refresh(intent.orderIntentId, at(11));
    assert.equal(asymmetric.state, 'ASYMMETRIC_OPEN');
    assert.deepEqual(asymmetric.reasons, ['SHORT_LEG_ASSIGNED_LONG_LEG_STILL_OPEN']);
    assert.equal(asymmetric.stockChainId, null, 'no stock record while a leg is still open at the broker');
    await ctx.events.recordLifecycleEvent({ orderIntentId: intent.orderIntentId, chainId, providerEventId: 'opexp-long', eventType: 'EXPIRATION', legIndex: 2, contracts: 1, sharesDelta: null, cashFlow: null, occurredAt: at(12), detail: {} });
    const settled = await ctx.positions.refresh(intent.orderIntentId, at(13));
    assert.equal(settled.state, 'STOCK_FROM_ASSIGNMENT');
    assert.equal(settled.stockShares, 100);
    assert.ok(settled.stockChainId);
    // replay (restart + late duplicate broker event) must not create a second chain or lot
    const fresh = await ctx.restarted();
    try { assert.equal((await fresh.positions.refresh(intent.orderIntentId, at(14))).stockChainId, settled.stockChainId); } finally { await fresh.close(); }
    const stock = await row(ctx.pool, `SELECT (SELECT count(*)::int FROM trade.economic_chain WHERE origin_chain_id=$1) AS chains,
      (SELECT lifecycle_state::text FROM trade.economic_chain WHERE chain_id=$2) AS state, (SELECT chain_kind FROM trade.economic_chain WHERE chain_id=$2) AS kind,
      (SELECT count(*)::int FROM trade.stock_lot WHERE chain_id=$2) AS lots, (SELECT shares::int FROM trade.stock_lot WHERE chain_id=$2) AS shares,
      (SELECT economic_basis_per_share::float FROM trade.stock_lot WHERE chain_id=$2) AS basis`, [chainId, settled.stockChainId]);
    assert.deepEqual({ ...stock }, { chains: 1, state: 'RECOVERY_WAIT', kind: 'WHEEL', lots: 1, shares: 100, basis: 650 });
  });
});

test('assignment AND exercise is net flat (CLOSED); a long-leg exercise WITHOUT assignment would leave SHORT stock and is an emergency with no stock record', { skip: !url }, async () => {
  await withWorld(async (ctx) => {
    const flat = await openSpread(ctx);
    await moveTo(ctx.orders, flat.intent.orderIntentId, ['SUBMITTING', 'SUBMITTED', 'FILLED']);
    await ctx.orders.recordBrokerSnapshot(flat.intent.orderIntentId, brokerParent(flat.intent, 'f1', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    await ctx.positions.refresh(flat.intent.orderIntentId, at(1));
    await ctx.events.recordLifecycleEvent({ orderIntentId: flat.intent.orderIntentId, chainId: flat.chainId, providerEventId: 'asn', eventType: 'ASSIGNMENT', legIndex: 1, contracts: 1, sharesDelta: 100, cashFlow: -65000, occurredAt: at(5), detail: {} });
    await ctx.events.recordLifecycleEvent({ orderIntentId: flat.intent.orderIntentId, chainId: flat.chainId, providerEventId: 'exc', eventType: 'EXERCISE', legIndex: 2, contracts: 1, sharesDelta: -100, cashFlow: 64500, occurredAt: at(5), detail: {} });
    const net = await ctx.positions.refresh(flat.intent.orderIntentId, at(6));
    assert.equal(net.state, 'CLOSED');
    assert.equal(net.stockChainId, null);
    const cash = await row(ctx.pool, `SELECT assignment_exercise_cash_flow::float AS cash, realized_pnl_before_fees::float AS before_fees FROM trade.multi_leg_chain_accounting WHERE order_intent_id=$1`, [flat.intent.orderIntentId]);
    assert.equal(cash.cash, -500, 'buy at 650, sell at 645: the spread width loss is carried in the whole-chain accounting');

    const oneLeg = await openSpread(ctx);
    await moveTo(ctx.orders, oneLeg.intent.orderIntentId, ['SUBMITTING', 'SUBMITTED', 'FILLED']);
    await ctx.orders.recordBrokerSnapshot(oneLeg.intent.orderIntentId, brokerParent(oneLeg.intent, 'g1', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    await ctx.events.recordLifecycleEvent({ orderIntentId: oneLeg.intent.orderIntentId, chainId: oneLeg.chainId, providerEventId: 'exc-only', eventType: 'EXERCISE', legIndex: 2, contracts: 1, sharesDelta: -100, cashFlow: 64500, occurredAt: at(5), detail: {} });
    const shortStock = await ctx.positions.refresh(oneLeg.intent.orderIntentId, at(6));
    assert.equal(shortStock.state, 'DIVERGED_EMERGENCY');
    assert.deepEqual(shortStock.reasons, ['SHORT_STOCK_FROM_LONG_LEG_EXERCISE_WITHOUT_ASSIGNMENT']);
    assert.equal(shortStock.stockChainId, null);
    assert.equal((await row(ctx.pool, `SELECT count(*)::int AS n FROM trade.economic_chain WHERE origin_chain_id=$1`, [oneLeg.chainId])).n, 0);
  });
});

test('isolation + contradictions: a Wheel chain id can not host a spread, and contradictory broker truth is a typed emergency, not a crash', { skip: !url }, async () => {
  await withWorld(async (ctx) => {
    const wheelChain = randomUUID();
    await ctx.pool.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at) VALUES($1,$2,$3,'CSP_OPEN',$4)`, [wheelChain, ctx.world.botInstanceId, ctx.world.underlyingId, NOW]);
    await assert.rejects(() => ctx.positions.ensureDefinedRiskChain({ chainId: wheelChain, botInstanceId: ctx.world.botInstanceId, underlyingId: ctx.world.underlyingId, openedAt: NOW }), /BELONGS_TO_A_WHEEL_CHAIN/);
    const contradictory = await openSpread(ctx);
    await moveTo(ctx.orders, contradictory.intent.orderIntentId, ['SUBMITTING', 'SUBMITTED', 'FILLED']);
    await ctx.orders.recordBrokerSnapshot(contradictory.intent.orderIntentId, brokerParent(contradictory.intent, 'h1', { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
    await ctx.events.recordLifecycleEvent({ orderIntentId: contradictory.intent.orderIntentId, chainId: contradictory.chainId, providerEventId: 'asn-2', eventType: 'ASSIGNMENT', legIndex: 1, contracts: 2, sharesDelta: 200, cashFlow: null, occurredAt: at(5), detail: {} });
    const result = await ctx.positions.refresh(contradictory.intent.orderIntentId, at(6));
    assert.equal(result.state, 'DIVERGED_EMERGENCY');
    assert.deepEqual(result.reasons, ['LEG_TRUTH_INCONSISTENT']);
  });
});
