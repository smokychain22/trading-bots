import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  jobTypesForScope, PostgresRuntimeCycleStore, shouldRecoverRuntimeCheckpoint,
} from '../src/theta/autonomous-runtime.js';

const poolReturning = (ready: boolean) => ({
  query: async (sql: string) => {
    assert.match(sql, /OPTIONS_MARKET_DATA_OPRA/);
    assert.match(sql, /OPTIONS_MARKET_DATA_INDICATIVE/);
    assert.match(sql, /PAPER_INDICATIVE_REFERENCE/);
    assert.match(sql, /ORDER_PRICING_DOCUMENTED/);
    assert.doesNotMatch(sql, /INDICATIVE_ONLY/);
    return { rows: [{ ready }], rowCount: 1 };
  },
}) as unknown as Pool;

test('new-risk runtime remains locked when no persisted execution quote authority is qualified', async () => {
  const store = new PostgresRuntimeCycleStore(poolReturning(false));
  assert.equal(await store.executionQuoteAuthorityReady(), false);
});

test('new-risk runtime accepts only a persisted qualified execution quote authority result', async () => {
  const store = new PostgresRuntimeCycleStore(poolReturning(true));
  assert.equal(await store.executionQuoteAuthorityReady(), true);
});

test('first Paper canary is available only before any broker order has been persisted', async () => {
  const emptyStore = new PostgresRuntimeCycleStore({
    query: async (sql: string) => {
      assert.match(sql, /count\(\*\)::int AS count,[\s\S]*FROM trade\.broker_order bo$/);
      return { rows: [{ count: 0, consumed: 0, owner_rearmed: false }], rowCount: 1 };
    },
  } as unknown as Pool);
  const store = (row: Record<string, unknown>) => new PostgresRuntimeCycleStore({
    query: async (sql: string) => (/operator_audit_event/.test(sql) ? { rows: [{ accepted: false }], rowCount: 1 } : { rows: [row], rowCount: 1 }),
  } as unknown as Pool);

  assert.equal(await emptyStore.firstCanarySubmissionAvailable(), true);
  assert.equal(await store({ count: 1, consumed: 1, owner_rearmed: true }).firstCanarySubmissionAvailable(), false, 'a used canary stays used');
  assert.equal(await store({ count: 1, consumed: 0, owner_rearmed: false }).firstCanarySubmissionAvailable(), false,
    'a zero-fill canary never reopens the lane without the governed activation');
  assert.equal(await store({ count: 1, consumed: 0, owner_rearmed: true }).firstCanarySubmissionAvailable(), true, 'governed activation re-armed after a zero-fill canary');
  assert.equal(await store({ count: 1 }).firstCanarySubmissionAvailable(), false, 'missing aggregates are UNKNOWN, never an open lane');
});

test('serverless runtime scopes keep management and evidence bounded without dropping reconciliation', () => {
  const core = jobTypesForScope('CORE');
  const evidence = jobTypesForScope('EVIDENCE');
  assert.ok(core.includes('POSITION_RECONCILIATION'));
  assert.ok(core.includes('POSITION_MANAGEMENT_SCAN'));
  assert.ok(core.includes('PAPER_EXECUTION_HANDOFF'));
  assert.ok(!core.includes('OPPORTUNITY_SCAN'));
  assert.deepEqual(jobTypesForScope('MANAGEMENT'), ['POSITION_RECONCILIATION', 'POSITION_MANAGEMENT_SCAN', 'PAPER_EXECUTION_HANDOFF']);
  assert.deepEqual(jobTypesForScope('LIFECYCLE'), ['POSITION_RECONCILIATION', 'ASSIGNMENT_EXPIRY_RECONCILIATION']);
  assert.deepEqual(jobTypesForScope('OBSERVATION'), ['POSITION_RECONCILIATION', 'MARKET_STATE_REFRESH']);
  assert.ok(jobTypesForScope('BROKER').includes('PENDING_ORDER_MANAGEMENT'));
  assert.ok(!jobTypesForScope('BROKER').includes('ASSIGNMENT_EXPIRY_RECONCILIATION'));
  assert.ok(!jobTypesForScope('BROKER').includes('PAPER_EXECUTION_HANDOFF'));
  assert.deepEqual(evidence, [
    'POSITION_RECONCILIATION', 'WAIT_RECHECK', 'OPPORTUNITY_SCAN', 'PAPER_EXECUTION_HANDOFF',
  ]);
  assert.ok(evidence.indexOf('PAPER_EXECUTION_HANDOFF') > evidence.indexOf('OPPORTUNITY_SCAN'),
    'the exact-contract handoff must immediately follow the scan that creates the short-lived plan');
});

test('a durable READY plan reaches the canonical handoff before scan post-processing consumes its window',()=>{
  const scanSource=readFileSync('src/research/production-shadow-runtime.ts','utf8');
  const enqueueAt=scanSource.indexOf('new PostgresMasterPaperActionPlanStore(memberPool).enqueue');
  const callbackAt=scanSource.indexOf('await input.onActionPlanEnqueued?.(assembled.plan.actionPlanId)',enqueueAt);
  const scanPersistenceAt=scanSource.indexOf('await evidenceStore.saveScan(scan,persisted)',callbackAt);
  assert.ok(enqueueAt>=0&&callbackAt>enqueueAt&&scanPersistenceAt>callbackAt,
    'durable enqueue must invoke the handoff before non-decision scan persistence');
  const runtimeSource=readFileSync('src/theta/autonomous-runtime.ts','utf8');
  assert.match(runtimeSource,/onActionPlanEnqueued:async\(actionPlanId\)=>\{\s*immediateHandoff\.result=await immediateReadyPlanHandoff\(actionPlanId,jobId\)/,
    'the callback runs the immediate handoff for the exact enqueued plan');
  assert.match(runtimeSource,/const immediateReadyPlanHandoff = async \(actionPlanId: string, jobId: string\): Promise<JobRunResult> => \{\s*const result = await executor\('PAPER_EXECUTION_HANDOFF'/,
    'the immediate handoff reuses the existing PAPER_EXECUTION_HANDOFF authority');
  assert.match(runtimeSource,/if\(paperExecutionHandoffCompleted\)return skipped\('PAPER_EXECUTION_HANDOFF_ALREADY_ATTEMPTED'\)/,
    'one scan request must never create two broker handoff attempts');
});

test('an exhausted read-only checkpoint cannot permanently suppress fresh evidence', () => {
  assert.equal(shouldRecoverRuntimeCheckpoint({ jobKind: 'OPPORTUNITY_SCAN', attempt: 3 }), false);
  assert.equal(shouldRecoverRuntimeCheckpoint({ jobKind: 'MARKET_STATE_REFRESH', attempt: 3 }), false);
  assert.equal(shouldRecoverRuntimeCheckpoint({ jobKind: 'OPPORTUNITY_SCAN', attempt: 2 }), true);
  assert.equal(shouldRecoverRuntimeCheckpoint({ jobKind: 'PAPER_EXECUTION_HANDOFF', attempt: 3 }), true);
  assert.equal(shouldRecoverRuntimeCheckpoint({ jobKind: 'ASSIGNMENT_EXPIRY_RECONCILIATION', attempt: 3 }), true);
});

test('every cycle response carries the execution-lane connection metric: one bounded connection, counters only', async () => {
  const { describeRuntimeDatabasePools } = await import('../src/theta/autonomous-runtime-handler.js');
  const metric = describeRuntimeDatabasePools({ runtime: { totalCount: 3, idleCount: 2, waitingCount: 0 }, execution: { totalCount: 1, idleCount: 0, waitingCount: 0 } });
  assert.deepEqual(metric.executionPool, { total: 1, active: 1, idle: 0, waiting: 0 });
  assert.deepEqual(metric.runtimePool, { total: 3, active: 1, idle: 2, waiting: 0 });
  assert.equal(metric.executionPoolMaximum, 1);
  assert.equal(describeRuntimeDatabasePools({ runtime: null, execution: null }).executionPool, null, 'no pool yet is reported as absent, never as zero');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/theta/autonomous-runtime-handler.ts', 'utf8');
  assert.match(source, /executionPool \?\?= createRuntimePostgresPool\(environment\.DATABASE_URL,undefined,\{maximumConnections:1,applicationName:'theta-runtime-execution'\}\)/,
    'the execution lane is created once per instance (reused, never per cycle) and capped at one connection');
});
