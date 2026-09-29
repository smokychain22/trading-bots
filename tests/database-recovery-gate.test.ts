import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRecoveryProbeSeries, classifyRecoveryGateError } from '../tools/theta-database-recovery-gate.mjs';

const healthy = (index: number) => ({
  observedAt: new Date(Date.parse('2026-09-27T00:00:00.000Z') + index * 30_000).toISOString(),
  connectivity: 'PASS', ssl: 'PASS', defaultTransactionReadOnly: 'off', transactionReadOnly: 'off',
  maxConnections: 20, clientBackendsAtProbe: 4, postmasterStart: '2026-09-22T13:23:21.578Z',
  transactionWriteRollback: 'PASS',
});

test('database recovery gate requires four healthy fresh probes over ninety seconds', () => {
  const receipt = assessRecoveryProbeSeries([0, 1, 2, 3].map(healthy));
  assert.equal(receipt.state, 'RECOVERY_GATE_SATISFIED');
  assert.equal(receipt.checkpointRetryEligible, true);
  assert.equal(receipt.decisionAuthority, 'INFRASTRUCTURE_DEFERRED');
  assert.equal(receipt.carryForwardCandidateAllowed, false);
});

test('database recovery gate rejects transient DNS failure without treating it as strategy evidence', () => {
  const failed = { ...healthy(0), connectivity: 'FAIL', errorCode: 'EAI_AGAIN', ssl: 'NOT_REACHED',
    defaultTransactionReadOnly: null, transactionReadOnly: null, maxConnections: null,
    clientBackendsAtProbe: null, postmasterStart: null, transactionWriteRollback: 'NOT_REACHED' };
  const receipt = assessRecoveryProbeSeries([failed]);
  assert.equal(receipt.checkpointRetryEligible, false);
  assert.ok(receipt.reasons.includes('PROBE_1_CONNECTIVITY_FAILED:EAI_AGAIN'));
  assert.ok(receipt.reasons.includes('RECOVERY_PROBE_COUNT_INSUFFICIENT'));
});

test('database recovery gate rejects compressed timing, restart, read-only and low headroom', () => {
  const samples = [0, 1, 2, 3].map(healthy);
  samples[1] = { ...samples[1], observedAt: '2026-09-27T00:00:10.000Z' };
  samples[2] = { ...samples[2], postmasterStart: '2026-09-27T00:00:45.000Z' };
  samples[3] = { ...samples[3], transactionReadOnly: 'on', clientBackendsAtProbe: 19 };
  const receipt = assessRecoveryProbeSeries(samples);
  assert.equal(receipt.checkpointRetryEligible, false);
  assert.ok(receipt.reasons.includes('PROBE_2_INTERVAL_TOO_SHORT'));
  assert.ok(receipt.reasons.includes('POSTMASTER_RESTARTED_DURING_RECOVERY_GATE'));
  assert.ok(receipt.reasons.includes('PROBE_4_READ_ONLY'));
  assert.ok(receipt.reasons.includes('PROBE_4_CONNECTION_HEADROOM_LOW'));
});

test('database recovery policy cannot be weakened through options', () => {
  assert.throws(() => assessRecoveryProbeSeries([], { requiredCount: 3 }), /REQUIRED_COUNT_BELOW_POLICY/);
  assert.throws(() => assessRecoveryProbeSeries([], { minimumIntervalSeconds: 29 }), /INTERVAL_BELOW_POLICY/);
});

test('database recovery gate preserves known local preconditions without accepting arbitrary messages', () => {
  assert.equal(classifyRecoveryGateError(new Error('AIVEN_DATABASE_URL_NOT_CONFIGURED')),
    'AIVEN_DATABASE_URL_NOT_CONFIGURED');
  assert.equal(classifyRecoveryGateError(Object.assign(new Error('provider detail'), { code: '53000' })), '53000');
  assert.equal(classifyRecoveryGateError(new Error('unexpected provider detail')), 'UNCLASSIFIED_DATABASE_ERROR');
});
