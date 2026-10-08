import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { classifyPaperRuntimeAuthority, readPaperRuntimeAuthorityEvidence,
  type PaperRuntimeAuthorityEvidence } from '../src/theta/paper-runtime-authority-truth.js';

const now = '2026-10-08T06:00:00.000Z';
const evidence: PaperRuntimeAuthorityEvidence = {
  observedAt: now, controlChangedAt: '2026-10-01T00:00:00Z', authorizationAt: '2026-10-01T00:00:00Z',
  masterEnabled: true, paused: false, followerEnabled: false, ownerPaperOnly: true,
  autonomousScope: true, canaryAccepted: true, firstCanaryScope: true, liveAuthorized: false,
  operatorPaused: false, emergencyLock: false,
};
const context = { now, maximumAgeMs: 300_000, workerSha: 'a'.repeat(40), workerHeartbeat: now, executionGate: 'ACTIVE' };
const classify = (patch: Partial<PaperRuntimeAuthorityEvidence> = {}) => classifyPaperRuntimeAuthority({ ...context, evidence: { ...evidence, ...patch } });

test('all six authority states are independently observed without granting broker authority', () => {
  assert.equal(classify().state, 'AUTHORIZED_ACTIVE');
  assert.equal(classify({ ownerPaperOnly: false }).state, 'UNAUTHORIZED_ACTIVE');
  assert.equal(classifyPaperRuntimeAuthority({ ...context, executionGate: 'LOCKED', evidence: { ...evidence, masterEnabled: false } }).state, 'LOCKED');
  assert.equal(classifyPaperRuntimeAuthority({ ...context, executionGate: 'LOCKED', evidence: { ...evidence, paused: true } }).state, 'PAUSED');
  assert.equal(classify({ observedAt: '2026-10-08T05:50:00Z' }).state, 'STALE_AUTHORITY');
  assert.equal(classifyPaperRuntimeAuthority({ ...context, evidence: null }).state, 'UNKNOWN_CONTROL');
  assert.equal(classify().brokerAuthority, false);
});

test('follower and live contradictions remain visible even when master is locked', () => {
  for (const patch of [{ followerEnabled: true }, { liveAuthorized: true }]) {
    const result = classifyPaperRuntimeAuthority({ ...context, executionGate: 'LOCKED', evidence: { ...evidence, ...patch } });
    assert.equal(result.state, 'UNAUTHORIZED_ACTIVE');
  }
  assert.equal(classify().follower, 'LOCKED');
  assert.equal(classify().live, 'NOT_AUTHORIZED');
});

test('paused, disabled and emergency controls contradict an ACTIVE worker', () => {
  for (const patch of [{ paused: true }, { masterEnabled: false }, { operatorPaused: true }, { emergencyLock: true }])
    assert.equal(classify(patch).state, 'UNAUTHORIZED_ACTIVE');
});

test('missing or malformed evidence never becomes an authorization', () => {
  for (const key of ['masterEnabled', 'paused', 'followerEnabled', 'ownerPaperOnly', 'autonomousScope', 'canaryAccepted',
    'firstCanaryScope', 'liveAuthorized', 'operatorPaused', 'emergencyLock'] as const)
    assert.equal(classify({ [key]: null }).state, 'UNKNOWN_CONTROL', key);
  assert.equal(classify({ controlChangedAt: 'bad' }).state, 'UNKNOWN_CONTROL');
  assert.equal(classify({ authorizationAt: 'bad' }).state, 'STALE_AUTHORITY');
});

test('durable authority has no invented expiry, current observations do', () => {
  assert.equal(classify({ authorizationAt: '2020-01-01T00:00:00Z' }).state, 'AUTHORIZED_ACTIVE');
  assert.equal(classify({ observedAt: '2027-01-01T00:00:00Z' }).state, 'STALE_AUTHORITY');
  for (const patch of [{ workerSha: null }, { workerHeartbeat: 'bad' }, { workerHeartbeat: '2026-10-08T05:00:00Z' }])
    assert.equal(classifyPaperRuntimeAuthority({ ...context, ...patch, evidence }).state, 'STALE_AUTHORITY');
});

test('first canary scope is separate from accepted autonomous scope', () => {
  assert.equal(classify({ canaryAccepted: false, firstCanaryScope: true }).state, 'AUTHORIZED_ACTIVE');
  assert.equal(classify({ canaryAccepted: false, firstCanaryScope: false }).state, 'UNAUTHORIZED_ACTIVE');
  assert.equal(classify({ autonomousScope: false, canaryAccepted: true }).state, 'UNAUTHORIZED_ACTIVE');
});

test('atomic read-only loader joins actual owner scope, preserves malformed booleans, feeds classifier', async () => {
  const row: Record<string, unknown> = { observed_at: new Date(now), changed_at: new Date('2026-10-01'),
    authorized_at: new Date('2026-10-01'), master_execution_enabled: true, pause_new_orders: false,
    follower_execution_enabled: false, owner_paper_only: true, live_money_authorized: false,
    autonomous_scope: true, first_canary_scope: true, canary_accepted: true, operator_version: null, operator_state: null };
  let calls = 0;
  const pool = { query: async (sql: string) => {
    calls++;
    assert.match(sql, /LEFT JOIN ops.paper_execution_authorization_event/);
    assert.match(sql, /ops.theta_operator_control_event/);
    assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\b/);
    return { rows: [row] };
  } } as unknown as Pick<Pool, 'query'>;
  const loaded = await readPaperRuntimeAuthorityEvidence(pool);
  assert.equal(calls, 1);
  assert.equal(classifyPaperRuntimeAuthority({ ...context, evidence: loaded }).state, 'AUTHORIZED_ACTIVE');
  row.pause_new_orders = 'false';
  assert.equal(classifyPaperRuntimeAuthority({ ...context, evidence: await readPaperRuntimeAuthorityEvidence(pool) }).state, 'UNKNOWN_CONTROL');
  row.pause_new_orders = false;
  row.operator_version = 3;
  row.operator_state = { newEntriesPaused: 'false', emergencyExecutionLock: false };
  assert.equal(classifyPaperRuntimeAuthority({ ...context, evidence: await readPaperRuntimeAuthorityEvidence(pool) }).state, 'UNKNOWN_CONTROL');
});
