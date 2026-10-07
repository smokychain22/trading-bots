import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { paperBootstrapRuntimePolicy as P } from '../../src/theta/paper-bootstrap-runtime-policy.js';
import type { DerivedAccountExposure } from '../../src/theta/account-exposure.js';
import { buildPortfolioBudgetSnapshot, type PortfolioBudgetPolicy } from '../../src/theta/portfolio-budget.js';
import { reservePortfolioCapitalInTransaction, type CapitalProposal } from '../../src/execution/portfolio-capital-reservation.js';

// Real disposable PostgreSQL: the account-wide capital lock serialises two concurrent decisions; the plan row is the durable reservation
// (survives a new pool = restart); a zero-fill terminal order releases its capital. FK triggers are bypassed (replica role) for seeding
// only; every row uses a fresh account id and is deleted in finally.
// FIXTURE_ONLY policy: limits opened to 100% so remaining new-risk capital ($20k) is the only binding constraint.
const policy: PortfolioBudgetPolicy = { policyVersion: 'fixture-reservation-db', hardCapMultiplier: 1, maximumTickerConcentrationPct: 1,
  maximumSectorConcentrationPct: 1, maximumCorrelationClusterPct: 1, maximumPortfolioCapitalAtRiskPct: 1, maximumAssignmentCapacityPct: 1,
  maximumInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct, maximumRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct,
  assignmentReserveCents: null, managementReserveCents: null, opportunityReserveCents: null };

test('real PostgreSQL: concurrent $12k reservations against $20k serialise (one RESERVED, one REEVALUATE); restart keeps it; zero-fill releases it', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
  const account = randomUUID();
  const observedAt = new Date().toISOString();
  const exposure = { equity: 100_000, cash: 100_000, buyingPower: 100_000, optionsBuyingPower: 100_000, cspCollateralRequired: 80_000, stockInventoryValue: 0,
    longOptionValue: 0, stockValueByUnderlying: {}, shortPutCount: 1, shortCallCount: 0, longPutCount: 0, longCallCount: 0, openOrderCount: 0,
    pendingOpeningCapitalAtRisk: 0, pendingAssignmentCollateral: 0, pendingExposureByUnderlying: {}, unclassifiedOpenOrderIds: [], portfolioCapitalAtRiskPct: null,
    tickerConcentrationPct: null, largestConcentrationUnderlying: null, exposureByUnderlying: { SPY: 80_000 }, riskyUnderlyings: ['SPY'],
    unparsedOptionSymbols: [], unclassifiedPositionSymbols: [] } as DerivedAccountExposure;
  const built = buildPortfolioBudgetSnapshot({ accountId: account, observedAt, exposure, activePositions: 1, pendingOpeningOrders: 0, recoveryInventoryValue: 0,
    reconciling: false }, policy);
  assert.equal(built.state, 'READY');
  const snapshot = (built as Extract<typeof built, { state: 'READY' }>).snapshot;
  const proposal = (underlying: string): CapitalProposal => ({ decisionId: randomUUID(), strategy: 'THETA_Q', candidateId: `THETA_CONVENTIONAL:${underlying}`,
    underlying, quantity: 1, capitalPerContractCents: 1_200_000 });
  const reserve = (client: pg.PoolClient, item: CapitalProposal) => reservePortfolioCapitalInTransaction(client, { executionAccountId: account, snapshot, policy,
    proposal: item, now: new Date().toISOString(), maximumSnapshotAgeMilliseconds: 120_000 });
  const insertPlan = async (client: pg.PoolClient, item: CapitalProposal, intentId: string | null = null, status = 'READY') => {
    const planId = randomUUID();
    await client.query(`INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,plan_version,status,plan_json,content_hash,
      not_before,created_at,updated_at,execution_tier,canonical_quantity,paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev,authority_kind,
      management_input_snapshot_id,management_action_frontier_id,action_group_id,leg_sequence,depends_on_action_plan_id,execution_order_intent_id)
      VALUES($1,$2,$3,'test-capital',$4,$5::jsonb,$6,now(),now(),now(),'PAPER_EVIDENCE',1,1,false,NULL,'NEW_RISK',NULL,NULL,$7,1,NULL,$8)`,
    [planId, item.decisionId, account, status, JSON.stringify({ action: 'OPEN_CSP', symbol: `${item.underlying}261113P00120000`, quantity: 1, multiplier: 100,
      underlying: item.underlying, decisionExpiresAt: new Date(Date.now() + 120_000).toISOString() }), planId.replaceAll('-', '').padEnd(64, '0'), randomUUID(), intentId]);
    return planId;
  };
  const a = await pool.connect(), b = await pool.connect();
  try {
    for (const client of [a, b]) await client.query(`SET session_replication_role = replica`);
    await a.query('BEGIN');
    const first = proposal('TLT');
    assert.equal((await reserve(a, first)).state, 'RESERVED');
    await insertPlan(a, first);
    await b.query('BEGIN');
    let settled = false;
    const secondPromise = reserve(b, proposal('IWM')).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(settled, false, 'the second decision waits on the account capital lock, it does not read a stale view');
    await a.query('COMMIT');
    const second = await secondPromise;
    assert.equal(second.state, 'PORTFOLIO_CAPACITY_CHANGED_REEVALUATE', 'never $24k committed against a $20k snapshot');
    await b.query('ROLLBACK');

    // restart: a brand-new pool still sees the durable reservation
    const reopened = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const c = await reopened.connect();
    try {
      await c.query('BEGIN');
      assert.equal((await reservePortfolioCapitalInTransaction(c, { executionAccountId: account, snapshot, policy, proposal: proposal('XLE'),
        now: new Date().toISOString(), maximumSnapshotAgeMilliseconds: 120_000 })).state, 'PORTFOLIO_CAPACITY_CHANGED_REEVALUATE');
      await c.query('ROLLBACK');
    } finally { c.release(); await reopened.end(); }

    // zero-fill release: the plan reached the broker after the snapshot and EXPIRED with no fill -> its capital is free again
    await a.query(`UPDATE trade.master_paper_action_plan SET status='TERMINAL' WHERE execution_account_id=$1`, [account]);
    const intent = randomUUID();
    await a.query(`INSERT INTO trade.order_intent(order_intent_id,decision_id,client_order_id,status,instrument_type,side,quantity,execution_account_id,
      position_intent,canonical_quantity,paper_evidence_quantity) VALUES($1,$2,$3,'EXPIRED','OPTION','sell',1,$4,'SELL_TO_OPEN',1,1)`,
    [intent, randomUUID(), `theta-capital-test-${intent}`, account]);
    await a.query(`INSERT INTO trade.broker_order(order_intent_id,provider_order_id,broker_status,created_at) VALUES($1,$2,'expired',now())`, [intent, `capital-test-${intent}`]);
    await a.query(`UPDATE trade.master_paper_action_plan SET execution_order_intent_id=$2 WHERE execution_account_id=$1`, [account, intent]);
    await a.query('BEGIN');
    assert.equal((await reserve(a, proposal('XLE'))).state, 'RESERVED', 'a zero-fill terminal order leaks no capital');
    await a.query('ROLLBACK');

    // ambiguous submit: capital is not reused while a broker order might exist
    await a.query(`UPDATE trade.order_intent SET status='UNKNOWN_SUBMISSION' WHERE order_intent_id=$1`, [intent]);
    await a.query('BEGIN');
    assert.equal((await reserve(a, proposal('XLE'))).state, 'CAPITAL_RESERVATION_RECONCILING');
    await a.query('ROLLBACK');
  } finally {
    await a.query('ROLLBACK').catch(() => undefined);
    await a.query(`DELETE FROM trade.broker_order WHERE provider_order_id LIKE 'capital-test-%'`);
    await a.query(`DELETE FROM trade.master_paper_action_plan WHERE execution_account_id=$1`, [account]);
    await a.query(`DELETE FROM trade.order_intent WHERE execution_account_id=$1`, [account]);
    a.release(); b.release(); await pool.end();
  }
});
