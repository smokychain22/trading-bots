import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { classifyExactCi, classifyLockedWorker, expectedPremarketCertificationGroupIds, premarketCertificationGroups } from
  '../src/operations/premarket-certification-plan.js';

test('premarket certification covers provider, database, strategies, risk, lifecycle, and resilience', () => {
  assert.deepEqual(expectedPremarketCertificationGroupIds, [
    'CONFIGURATION_AND_EVIDENCE_AUTHORITY', 'PROVIDER_CONTRACT_AND_FUZZ',
    'DATABASE_CHAOS_AND_AMBIGUOUS_COMMIT', 'Q_H_D_A_C_ENGINEERING',
    'DECISION_BRAIN_COMPARATOR_AND_WAIT', 'AEGIS_AND_SIZING',
    'MANAGEMENT_LIFECYCLE_AND_ACCOUNTING', 'OUTCOMES_EXPERIMENTS_AND_GOVERNANCE',
    'RESTART_LEASE_AND_STORAGE',
  ]);
  const files = premarketCertificationGroups.flatMap((group) => group.testFiles);
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(files.filter((file) => !existsSync(file)), []);
});

test('exact CI distinguishes pending, failed, and passing runs', () => {
  assert.equal(classifyExactCi([], 'abc').state, 'FORWARD_DATA_REQUIRED');
  assert.equal(classifyExactCi([{ headSha: 'abc', status: 'in_progress' }], 'abc').state, 'FORWARD_DATA_REQUIRED');
  assert.equal(classifyExactCi([{ headSha: 'abc', status: 'completed', conclusion: 'failure' }], 'abc').state, 'FAIL');
  assert.equal(classifyExactCi([{ headSha: 'abc', status: 'completed', conclusion: 'success' }], 'abc').state, 'PASS');
});

test('worker alignment compares the runtime SHA with current source', () => {
  const healthy = { taskState: 'Running', runtimeShaAligned: true, healthShaAligned: true,
    executionGate: 'LOCKED', runtimeSha: 'old', workspaceSha: 'new' };
  assert.equal(classifyLockedWorker(healthy, 'new').state, 'FORWARD_DATA_REQUIRED');
  assert.equal(classifyLockedWorker({ ...healthy, runtimeSha: 'new' }, 'new').state, 'PASS');
  assert.equal(classifyLockedWorker({ ...healthy, executionGate: 'ACTIVE' }, 'new').state, 'FAIL');
});
