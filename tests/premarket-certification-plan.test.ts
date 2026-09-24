import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { expectedPremarketCertificationGroupIds, premarketCertificationGroups } from
  '../src/operations/premarket-certification-plan.js';

test('premarket certification covers provider, database, strategies, risk, lifecycle, and resilience', () => {
  assert.deepEqual(expectedPremarketCertificationGroupIds, [
    'PROVIDER_CONTRACT_AND_FUZZ', 'DATABASE_CHAOS_AND_AMBIGUOUS_COMMIT', 'Q_H_D_A_C_ENGINEERING',
    'AEGIS_AND_SIZING', 'MANAGEMENT_LIFECYCLE_AND_ACCOUNTING', 'RESTART_LEASE_AND_STORAGE',
  ]);
  const files = premarketCertificationGroups.flatMap((group) => group.testFiles);
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(files.filter((file) => !existsSync(file)), []);
});
