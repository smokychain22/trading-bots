import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresPaperOrderStore } from '../../src/execution/postgres-paper-order-store.js';
import { PostgresDefinedRiskPositionStore } from '../../src/execution/postgres-defined-risk-position-store.js';
import { applyDefinedRiskBrokerFacts } from '../../src/execution/defined-risk-broker-facts.js';
import { NOW, brokerParent, mlegIntent, seedDefinedRiskWorld, type DefinedRiskWorld } from '../helpers/defined-risk-db-fixture.js';

const url = process.env.TEST_DATABASE_URL;
const at = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
// provider activity identities are globally unique; literal ids would collide with a previous run on the same (persistent) disposable database
const RUN = randomUUID().slice(0, 8);
const activityId = (label: string): string => `${label}-${RUN}`;

async function filledSpread(pool: Pool, world: DefinedRiskWorld, positions: PostgresDefinedRiskPositionStore, orders: PostgresPaperOrderStore, label: string) {
  const chainId = randomUUID();
  await positions.ensureDefinedRiskChain({ chainId, botInstanceId: world.botInstanceId, underlyingId: world.underlyingId, openedAt: NOW });
  const intent = mlegIntent(world, chainId, false);
  await orders.insertIntent(intent);
  await positions.register(intent.orderIntentId);
  for (const [from, to] of [['READY', 'SUBMITTING'], ['SUBMITTING', 'SUBMITTED'], ['SUBMITTED', 'FILLED']] as const) await orders.transitionIntent(intent.orderIntentId, from, to);
  await orders.recordBrokerSnapshot(intent.orderIntentId, brokerParent(intent, label, { filled: 1, avg: 2.0 }, { filled: 1, avg: 0.9 }, 'filled'));
  await positions.refresh(intent.orderIntentId, at(1));
  await pool.query(`UPDATE trade.defined_risk_position SET opened_at=$2 WHERE order_intent_id=$1`, [intent.orderIntentId, NOW]);
  return { chainId, intent };
}
const fact = (pool: Pool, connectionId: string, id: string, type: string, symbol: string, quantity: number, when: string) => pool.query(
  `INSERT INTO trade.broker_activity_fact(connection_id,provider_activity_ref_hash,activity_type,symbol,quantity,activity_at,first_observed_at,last_observed_at,payload_hash)
   VALUES($1,$2,$3,$4,$5,$6,$6,$6,$7)`, [connectionId, hash(activityId(id)), type, symbol, quantity, when, hash(`payload:${activityId(id)}`)]);

test('broker-confirmed assignment / expiration activities become exact-leg events, once; stock appears only after BOTH legs resolve; predating or wrong-leg activities are ignored', { skip: !url }, async () => {
  assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString: url, max: 4, options: '-c session_replication_role=replica' });
  try {
    const world = await seedDefinedRiskWorld(pool);
    const orders = new PostgresPaperOrderStore(pool), positions = new PostgresDefinedRiskPositionStore(pool), connectionId = randomUUID();
    const { chainId, intent } = await filledSpread(pool, world, positions, orders, 'facts');

    // nothing confirmed yet: a vanished leg or an expiration DATE is not an event
    const idle = await applyDefinedRiskBrokerFacts(pool, { connectionId, observedAt: at(5) });
    assert.equal(idle.eventsRecorded, 0);

    // ignored: an assignment that predates the spread, and an "assignment" on the LONG leg symbol (assignment is a short-leg event)
    await fact(pool, connectionId, 'before-open', 'OPASN', world.shortSymbol, 1, '2026-10-06T14:00:00.000Z');
    await fact(pool, connectionId, 'wrong-leg', 'OPASN', world.longSymbol, 1, at(10));
    assert.equal((await applyDefinedRiskBrokerFacts(pool, { connectionId, observedAt: at(11) })).eventsRecorded, 0);

    await fact(pool, connectionId, 'assign-short', 'OPASN', world.shortSymbol, 1, at(20));
    const first = await applyDefinedRiskBrokerFacts(pool, { connectionId, observedAt: at(21) });
    assert.equal(first.eventsRecorded, 1);
    assert.equal(first.stockChainsCreated, 0, 'the long leg is still open at the broker: no stock record yet');
    assert.equal((await positions.get(intent.orderIntentId)).state, 'ASYMMETRIC_OPEN');
    const replay = await applyDefinedRiskBrokerFacts(pool, { connectionId, observedAt: at(22) });
    assert.equal(replay.eventsRecorded, 0, 'the same broker activity is never recorded twice (restart / next cycle)');

    await fact(pool, connectionId, 'expire-long', 'OPEXP', world.longSymbol, 1, at(30));
    const settled = await applyDefinedRiskBrokerFacts(pool, { connectionId, observedAt: at(31) });
    assert.equal(settled.eventsRecorded, 1);
    assert.equal(settled.stockChainsCreated, 1);
    assert.equal((await positions.get(intent.orderIntentId)).state, 'STOCK_FROM_ASSIGNMENT');
    const stock = (await pool.query(`SELECT c.lifecycle_state::text AS state, c.chain_kind, l.shares::int AS shares, l.economic_basis_per_share::float AS basis FROM trade.economic_chain c JOIN trade.stock_lot l ON l.chain_id=c.chain_id
      WHERE c.origin_chain_id=$1`, [chainId])).rows;
    assert.deepEqual(stock.map((row) => ({ ...row })), [{ state: 'RECOVERY_WAIT', chain_kind: 'WHEEL', shares: 100, basis: 650 }]);
    assert.equal((await applyDefinedRiskBrokerFacts(pool, { connectionId, observedAt: at(40) })).stockChainsCreated, 0);
  } finally { await pool.end(); }
});

test('two spreads sharing a leg symbol: one broker activity is never consumed twice', { skip: !url }, async () => {
  assert.ok(url);
  const pool = new Pool({ connectionString: url, max: 4, options: '-c session_replication_role=replica' });
  try {
    const world = await seedDefinedRiskWorld(pool);
    const orders = new PostgresPaperOrderStore(pool), positions = new PostgresDefinedRiskPositionStore(pool), connectionId = randomUUID();
    const a = await filledSpread(pool, world, positions, orders, 'twin-a'), b = await filledSpread(pool, world, positions, orders, 'twin-b');
    await fact(pool, connectionId, 'single-assignment', 'OPASN', world.shortSymbol, 1, at(20));
    for (let cycle = 0; cycle < 3; cycle += 1) await applyDefinedRiskBrokerFacts(pool, { connectionId, observedAt: at(21 + cycle) });
    const rows = (await pool.query(`SELECT order_intent_id::text AS id, COALESCE(sum(contracts),0)::int AS n FROM trade.multi_leg_lifecycle_event WHERE provider_event_id=$1 GROUP BY 1`, [hash(activityId('single-assignment'))])).rows as Array<{ id: string; n: number }>;
    assert.equal(rows.reduce((sum, row) => sum + row.n, 0), 1, 'ONE assigned contract in total, attributed to exactly one of the two identical spreads');
    assert.equal(rows.length, 1);
    assert.ok([a.intent.orderIntentId, b.intent.orderIntentId].includes(rows[0]?.id as string));
  } finally { await pool.end(); }
});
