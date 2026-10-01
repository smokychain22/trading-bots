import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool } from 'pg';
import { isAutonomousMasterPaperAccepted, PostgresPaperExecutionAuthorizationStore } from '../src/execution/paper-execution-authorization.js';
import { reconcileFirstCanaryAcceptance } from '../src/execution/postgres-first-canary-acceptance.js';
import { PostgresRuntimeCycleStore, classifyRuntimeExecutionGate } from '../src/theta/autonomous-runtime.js';

type Query = { readonly sql: string; readonly values: readonly unknown[] };
function fakePool(handler: (sql: string, values: readonly unknown[]) => { rows: unknown[]; rowCount?: number }) {
  const queries: Query[] = [];
  const pool = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      queries.push({ sql, values });
      const result = handler(sql, values);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
  } as unknown as Pool;
  return { pool, queries };
}

test('the durable accepted-canary marker is read from the immutable audit record only', async () => {
  const yes = fakePool(() => ({ rows: [{ accepted: true }] }));
  const no = fakePool(() => ({ rows: [{ accepted: false }] }));
  const empty = fakePool(() => ({ rows: [] }));
  assert.equal(await isAutonomousMasterPaperAccepted(yes.pool), true);
  assert.equal(await isAutonomousMasterPaperAccepted(no.pool), false);
  assert.equal(await isAutonomousMasterPaperAccepted(empty.pool), false);
  assert.deepEqual(yes.queries[0]?.values, ['ACTIVATE_AUTONOMOUS_MASTER_PAPER']);
  const sql = yes.queries[0]?.sql ?? '';
  assert.match(sql, /copy\.operator_audit_event/);
  assert.doesNotMatch(sql, /changed_by/);
});

test('a prior broker order keeps the single-canary lane locked until acceptance, then never again', async () => {
  const state = { orders: 0, accepted: false };
  const { pool } = fakePool((sql) => sql.includes('trade.broker_order')
    ? { rows: [{ count: state.orders }] } : { rows: [{ accepted: state.accepted }] });
  const store = new PostgresRuntimeCycleStore(pool);
  assert.equal(await store.firstCanarySubmissionAvailable(), true, 'no order yet: canary lane available');
  state.orders = 1;
  assert.equal(await store.firstCanarySubmissionAvailable(), false, 'order exists, canary not accepted: stays locked');
  state.accepted = true;
  assert.equal(await store.firstCanarySubmissionAvailable(), true, 'accepted canary: lane no longer locked forever');
  state.orders = 25;
  assert.equal(await store.firstCanarySubmissionAvailable(), true, 'many autonomous orders never re-lock the lane');
});

test('lifting the canary lane does not lift quote, risk or pause gates', () => {
  const base = { executionQuoteAuthorityReady: true, newRiskSubmissionEnabled: true, managementPolicyProviderReady: true };
  assert.equal(classifyRuntimeExecutionGate({ ...base, firstCanarySubmissionAvailable: true }), 'ACTIVE');
  assert.equal(classifyRuntimeExecutionGate({ ...base, newRiskSubmissionEnabled: false, firstCanarySubmissionAvailable: true }), 'LOCKED');
  assert.equal(classifyRuntimeExecutionGate({ ...base, managementPolicyProviderReady: false, firstCanarySubmissionAvailable: true }), 'LOCKED');
  assert.notEqual(classifyRuntimeExecutionGate({ ...base, executionQuoteAuthorityReady: false, firstCanarySubmissionAvailable: true }), 'ACTIVE');
});

test('the first-canary relock can never re-pause new risk after autonomy was accepted', async () => {
  const { pool, queries } = fakePool(() => ({ rows: [], rowCount: 0 }));
  const relocked = await new PostgresPaperExecutionAuthorizationStore(pool).lockNewRiskAfterFirstCanary('2026-10-01T15:00:00.000Z');
  assert.equal(relocked, false);
  const sql = queries[0]?.sql ?? '';
  assert.match(sql, /NOT EXISTS\(SELECT 1 FROM copy\.operator_audit_event\s+WHERE action='ACTIVATE_AUTONOMOUS_MASTER_PAPER' AND result='ACCEPTED'\)/);
  assert.match(sql, /automaticLockAfterFirstBrokerOrder/);
});

test('acceptance reconciliation is a read-only no-op once autonomy is accepted', async () => {
  const { pool, queries } = fakePool(() => ({ rows: [{ accepted: true }] }));
  const broker = new Proxy({}, { get: () => { throw new Error('BROKER_MUST_NOT_BE_TOUCHED_AFTER_ACCEPTANCE'); } });
  const result = await reconcileFirstCanaryAcceptance({ pool, broker: broker as never, executionAccountId: 'acct', asOf: '2026-10-01T15:00:00.000Z' });
  assert.equal(result.state, 'AUTONOMOUS_PAPER_ACTIVE');
  assert.equal(result.receipt, null);
  assert.equal(queries.length, 1, 'only the durable marker was read; no multi-order identity query ran');
});

test('autonomous activation demands an accepted canary receipt and keeps every non-canary gate', () => {
  const store = readFileSync('src/execution/paper-execution-authorization.ts', 'utf8');
  const start = store.indexOf('async activateAutonomousPaperAfterAcceptedCanary');
  const body = store.slice(start);
  assert.match(body, /receipt\.status!=='ACCEPTED'/);
  assert.match(body, /AUTONOMOUS_PAPER_OWNER_AUTHORIZATION_MISSING/);
  assert.match(body, /follower_execution_enabled=false/);
  assert.doesNotMatch(body, /live_money|live_execution|follower_execution_enabled=true/);
  assert.doesNotMatch(body, /max\(1|Math\.max\(1/);
});

test('the runtime relock call site skips only an already-completed canary and quantity cap derives from the audit record', () => {
  const runtime = readFileSync('src/theta/autonomous-runtime.ts', 'utf8');
  const shadow = readFileSync('src/research/production-shadow-runtime.ts', 'utf8');
  assert.match(runtime, /plan\.decisionAuthority==='NEW_RISK'&&plan\.firstCanaryCompleted!==true/);
  assert.match(shadow, /firstCanaryCompleted=await isAutonomousMasterPaperAccepted\(input\.pool\)/);
  assert.doesNotMatch(shadow, /AUTOMATIC_ACCEPTED_FIRST_CANARY/);
});

test('management authority is independent of the new-risk pause', async () => {
  const { resolveEffectivePaperExecutionControl } = await import('../src/execution/paper-execution-authorization.js');
  const control = resolveEffectivePaperExecutionControl({
    environmentMasterEnabled: true, environmentFollowerEnabled: false, environmentPauseNewOrders: false,
    persisted: { pauseNewOrders: true, masterExecutionEnabled: true, followerExecutionEnabled: false, authorizationEventId: 'event' },
    operatorNewEntriesPaused: false, operatorEmergencyExecutionLock: false,
  });
  assert.equal(control.managementSubmissionEnabled, true);
  assert.equal(control.newRiskSubmissionEnabled, false);
  assert.equal(control.followerEnabled, false);
});
