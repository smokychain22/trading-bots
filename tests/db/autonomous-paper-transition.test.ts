import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { buildFirstCanaryAcceptanceReceipt, type FirstCanaryAcceptanceInput } from '../../src/execution/first-canary-acceptance.js';
import { isAutonomousMasterPaperAccepted, PostgresPaperExecutionAuthorizationStore } from '../../src/execution/paper-execution-authorization.js';
import { reconcileFirstCanaryAcceptance } from '../../src/execution/postgres-first-canary-acceptance.js';
import type { Evidence } from '../../src/theta/first-paper-order-readiness.js';
import { PostgresRuntimeCycleStore } from '../../src/theta/autonomous-runtime.js';

const at = '2026-10-01T15:00:00.000Z';
const good = <T>(value: T): Evidence<T> => ({ state: 'GOOD', value, source: 'DISPOSABLE_TEST', asOf: at });

function acceptedInput(ids: { intent: string; account: string; client: string }): FirstCanaryAcceptanceInput {
  return {
    asOf: at,
    expected: { orderIntentId: ids.intent, executionAccountId: ids.account, occContract: 'AAPL261016P00150000',
      side: 'sell', positionIntent: 'sell_to_open', quantity: 1, clientOrderId: ids.client },
    persistence: { decisionPersisted: good(true), orderIntentPersisted: good(true), idempotencyReserved: good(true),
      deterministicClientOrderId: good(true) },
    broker: { executionAccountId: good(ids.account), occContract: good('AAPL261016P00150000'), side: good('sell'),
      positionIntent: good('sell_to_open'), requestedQuantity: good(1), filledQuantity: good(1),
      clientOrderId: good(ids.client), orderState: good('FILLED'), acknowledgementObserved: good(true),
      duplicateEconomicExposureCount: good(1) },
    evidence: { reconciliationComplete: good(true), tcaPersisted: good(true), lifecycleApplied: good(true),
      managementRegistered: good(true), futureObservationsScheduled: good(true), newRiskRelocked: good(true),
      managementEnabled: good(true), followerMutationCount: good(0), liveMutationCount: good(0) },
  };
}

async function seed(client: PoolClient, scope: Record<string, unknown>, extraNewRiskPlans = 0) {
  const ids = { intent: randomUUID(), account: randomUUID(), client: `theta-test-${randomUUID()}`,
    authorization: randomUUID(), plan: randomUUID(), decision: randomUUID(), order: randomUUID() };
  // Foreign-key triggers are disabled for seeding only: this test exercises the
  // transition predicates and SQL shape, not the unrelated upstream decision chain.
  await client.query(`SET session_replication_role = replica`);
  await client.query(`INSERT INTO ops.paper_execution_authorization_event(authorization_event_id,account_role,environment,
    master_submission_authorized,follower_submission_authorized,live_money_authorized,authorization_scope_json,directive_hash,authorized_at)
    VALUES($1,'MASTER_THETA_PAPER','PAPER',true,false,false,$2::jsonb,$3,now())`,
  [ids.authorization, JSON.stringify(scope), createHash('sha256').update(ids.authorization).digest('hex')]);
  await client.query(`UPDATE ops.paper_execution_control SET pause_new_orders=true,master_execution_enabled=true,
    follower_execution_enabled=false,authorization_event_id=$1,changed_by='AUTOMATIC_FIRST_CANARY_LOCK',changed_at=now()
    WHERE singleton=true`, [ids.authorization]);
  await client.query(`INSERT INTO trade.execution_account(execution_account_id,account_kind,environment,
    provider_account_ref_hash,provider_account_ref_masked) VALUES($1,'MASTER_API_KEY','PAPER',$2,'test')`,
  [ids.account, createHash('sha256').update(ids.account).digest('hex')]);
  await client.query(`INSERT INTO trade.order_intent(order_intent_id,decision_id,client_order_id,status,instrument_type,side,
    quantity,execution_account_id,position_intent,canonical_quantity,paper_evidence_quantity)
    VALUES($1,$2,$3,'FILLED','OPTION','sell',1,$4,'SELL_TO_OPEN',1,1)`, [ids.intent, ids.decision, ids.client, ids.account]);
  await client.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id,broker_status)
    VALUES($1,$2,$3,'filled')`, [ids.order, ids.intent, `test-provider-order-${ids.order}`]);
  const insertPlan = async (id: string, intentId: string | null) => client.query(`INSERT INTO trade.master_paper_action_plan(
    action_plan_id,decision_id,execution_account_id,plan_version,status,plan_json,content_hash,not_before,action_group_id,
    leg_sequence,authority_kind,execution_order_intent_id,created_at,updated_at) VALUES($1,$2,$3,'test','TERMINAL','{}'::jsonb,$4,now(),$5,1,'NEW_RISK',$6,now(),now())`,
  [id, ids.decision, ids.account, createHash('sha256').update(id).digest('hex'), randomUUID(), intentId]);
  await insertPlan(ids.plan, ids.intent);
  for (let index = 0; index < extraNewRiskPlans; index += 1) {
    const extraIntent = randomUUID();
    await client.query(`INSERT INTO trade.order_intent(order_intent_id,decision_id,client_order_id,status,instrument_type,side,
      quantity,execution_account_id,position_intent,canonical_quantity,paper_evidence_quantity)
      VALUES($1,$2,$3,'FILLED','OPTION','sell',1,$4,'SELL_TO_OPEN',1,1)`, [extraIntent, ids.decision, `theta-extra-${randomUUID()}`, ids.account]);
    await insertPlan(randomUUID(), extraIntent);
  }
  await client.query(`SET session_replication_role = DEFAULT`);
  return ids;
}

async function cleanup(client: PoolClient) {
  await client.query(`SET session_replication_role = replica`);
  await client.query(`DELETE FROM copy.operator_audit_event WHERE action='ACTIVATE_AUTONOMOUS_MASTER_PAPER'`);
  await client.query(`DELETE FROM trade.master_paper_action_plan WHERE plan_version='test'`);
  await client.query(`DELETE FROM trade.broker_order WHERE provider_order_id LIKE 'test-provider-order-%'`);
  await client.query(`DELETE FROM trade.order_intent WHERE client_order_id LIKE 'theta-test-%' OR client_order_id LIKE 'theta-extra-%'`);
  await client.query(`DELETE FROM trade.execution_account WHERE provider_account_ref_masked='test'`);
  await client.query(`UPDATE ops.paper_execution_control SET pause_new_orders=true,master_execution_enabled=false,
    follower_execution_enabled=false,authorization_event_id=NULL,changed_by='',changed_at=now() WHERE singleton=true`);
  await client.query(`DELETE FROM ops.paper_execution_authorization_event WHERE authorization_scope_json ? 'testSeed'`);
  await client.query(`SET session_replication_role = DEFAULT`);
}

const ownerScope = { testSeed: true, firstCanaryMaximumQuantity: 1, automaticLockAfterFirstBrokerOrder: true,
  autonomousPaperAfterAcceptedCanaryAuthorized: true, followerExecution: 'LOCKED', liveMoneyAuthorized: false };
const neverBroker = new Proxy({}, { get: () => { throw new Error('BROKER_MUST_NOT_BE_TOUCHED'); } });

// The shared CI database globs every tests/db file with the generic URL, so this
// test runs only against its own dedicated, freshly migrated disposable database.
const dedicatedDatabase = (() => {
  try { return new URL(process.env.TEST_DATABASE_URL ?? '').pathname === '/theta_autonomous_transition_ci'; } catch { return false; }
})();

test('real disposable PostgreSQL: accepted first canary promotes to autonomous Master Paper without lifting any other gate', {
  skip: !dedicatedDatabase,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost', ''].includes(url.hostname), 'Disposable local database only');
  assert.ok(['/theta_autonomous_transition_ci'].includes(url.pathname), 'DISPOSABLE_TEST_DATABASE_REQUIRED');
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  const admin = await pool.connect();
  try {
    await cleanup(admin);

    // Empty database: every new query is valid against the real schema and nothing is invented.
    assert.equal(await isAutonomousMasterPaperAccepted(pool), false);
    assert.equal(await new PostgresRuntimeCycleStore(pool).firstCanarySubmissionAvailable(), true);
    const none = await reconcileFirstCanaryAcceptance({ pool, broker: neverBroker as never, executionAccountId: randomUUID(), asOf: at });
    assert.equal(none.state, 'NO_CANARY');

    // A canary exists but is not accepted: the lane stays locked and the relock works.
    const ids = await seed(admin, ownerScope);
    const store = new PostgresPaperExecutionAuthorizationStore(pool);
    const runtime = new PostgresRuntimeCycleStore(pool);
    assert.equal(await runtime.firstCanarySubmissionAvailable(), false, 'a prior order alone keeps the canary lane locked before acceptance');
    await admin.query(`UPDATE ops.paper_execution_control SET pause_new_orders=false WHERE singleton=true`);
    assert.equal(await store.lockNewRiskAfterFirstCanary(at), true, 'unaccepted canary is re-paused after the first order');
    assert.equal((await store.current()).pauseNewOrders, true);

    // Activation is refused for incomplete evidence and for missing owner scope.
    const base = acceptedInput(ids);
    const partial = buildFirstCanaryAcceptanceReceipt({ ...base, broker: { ...base.broker, filledQuantity: good(0), orderState: good('WORKING') } });
    await assert.rejects(store.activateAutonomousPaperAfterAcceptedCanary({ acceptance: partial, activatedAt: at }), /FIRST_CANARY_ACCEPTANCE_REQUIRED/);
    const accepted = buildFirstCanaryAcceptanceReceipt(base);
    assert.equal(accepted.status, 'ACCEPTED');
    await admin.query(`SET session_replication_role = replica`);
    const noScopeId = randomUUID();
    await admin.query(`INSERT INTO ops.paper_execution_authorization_event(authorization_event_id,account_role,environment,
      master_submission_authorized,follower_submission_authorized,live_money_authorized,authorization_scope_json,directive_hash,authorized_at)
      VALUES($1,'MASTER_THETA_PAPER','PAPER',true,false,false,'{"testSeed":true,"newEntriesRemainPaused":true}'::jsonb,$2,now())`,
    [noScopeId, createHash('sha256').update(noScopeId).digest('hex')]);
    await admin.query(`UPDATE ops.paper_execution_control SET authorization_event_id=$1 WHERE singleton=true`, [noScopeId]);
    await admin.query(`SET session_replication_role = DEFAULT`);
    await assert.rejects(store.activateAutonomousPaperAfterAcceptedCanary({ acceptance: accepted, activatedAt: at }), /AUTONOMOUS_PAPER_OWNER_AUTHORIZATION_MISSING/);
    await admin.query(`UPDATE ops.paper_execution_control SET authorization_event_id=$1 WHERE singleton=true`, [ids.authorization]);

    // A second new-risk order means the single-canary identity no longer holds.
    const extraIds = await seed(admin, ownerScope, 1);
    await assert.rejects(store.activateAutonomousPaperAfterAcceptedCanary({
      acceptance: buildFirstCanaryAcceptanceReceipt(acceptedInput(extraIds)), activatedAt: at }), /FIRST_CANARY_DATABASE_IDENTITY_MISMATCH/);
    await cleanup(admin);

    // The governed transition itself.
    const real = await seed(admin, ownerScope);
    const receipt = buildFirstCanaryAcceptanceReceipt(acceptedInput(real));
    const control = await store.activateAutonomousPaperAfterAcceptedCanary({ acceptance: receipt, activatedAt: at });
    assert.deepEqual({ pause: control.pauseNewOrders, master: control.masterExecutionEnabled, follower: control.followerExecutionEnabled },
      { pause: false, master: true, follower: false });
    const persisted = await store.current();
    assert.equal(persisted.pauseNewOrders, false);
    assert.equal(persisted.followerExecutionEnabled, false, 'followers stay locked');
    assert.equal(await isAutonomousMasterPaperAccepted(pool), true, 'durable marker survives');
    assert.equal(await runtime.firstCanarySubmissionAvailable(), true, 'canary lane lifted only after acceptance');
    assert.equal(await store.lockNewRiskAfterFirstCanary(at), false, 'the first-canary relock can never re-pause autonomous Paper');
    assert.equal((await store.current()).pauseNewOrders, false);
    const audit = await pool.query(`SELECT metadata_json FROM copy.operator_audit_event WHERE action='ACTIVATE_AUTONOMOUS_MASTER_PAPER'`);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].metadata_json.liveMutationCount, 0);
    assert.equal(audit.rows[0].metadata_json.followerMutationCount, 0);
    assert.equal(audit.rows[0].metadata_json.normalSizingPreserved, true);
    const after = await reconcileFirstCanaryAcceptance({ pool, broker: neverBroker as never, executionAccountId: real.account, asOf: at });
    assert.equal(after.state, 'AUTONOMOUS_PAPER_ACTIVE', 'later autonomous orders never re-enter single-canary identity checks');
    // Restart-safe: a brand-new pool sees the same durable state.
    const reopened = new Pool({ connectionString: url.toString(), max: 1 });
    try {
      assert.equal(await isAutonomousMasterPaperAccepted(reopened), true);
      assert.equal((await new PostgresPaperExecutionAuthorizationStore(reopened).current()).pauseNewOrders, false);
    } finally { await reopened.end(); }
  } finally {
    try { await cleanup(admin); } finally { admin.release(); await pool.end(); }
  }
});
