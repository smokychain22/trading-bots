import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPostMigrationResumeState,
  requiredPostMigrationVersions,
  type MigrationLedgerRow,
  type PostMigrationDatabaseState,
} from '../src/database/post-migration-resume.js';

const ledger = (): MigrationLedgerRow[] => [
  { version: '064_previous_schema_head', count: 1 },
  ...requiredPostMigrationVersions.map((version) => ({ version, count: 1 })),
];

const state = (): PostMigrationDatabaseState => ({
  activeLeases: 0,
  paused: true,
  masterEnabled: false,
  followerEnabled: false,
  riskAssessment: true,
  localObservation: true,
  compressedArchive: true,
});

test('accepts exact schema 067 with locked controls and no active lease', () => {
  assert.doesNotThrow(() => assertPostMigrationResumeState(ledger(), state()));
});

test('rejects a missing, duplicate, or advanced migration ledger', () => {
  assert.throws(
    () => assertPostMigrationResumeState(ledger().filter((row) => row.version !== requiredPostMigrationVersions[1]), state()),
    /POST_MIGRATION_LEDGER_CARDINALITY_INVALID:066_local_observation_evidence/,
  );
  assert.throws(
    () => assertPostMigrationResumeState(ledger().map((row) => row.version === requiredPostMigrationVersions[0]
      ? { ...row, count: 2 } : row), state()),
    /POST_MIGRATION_LEDGER_CARDINALITY_INVALID:065_aegis_iv_stress_evidence/,
  );
  assert.throws(
    () => assertPostMigrationResumeState([...ledger(), { version: '068_unapproved', count: 1 }], state()),
    /POST_MIGRATION_SCHEMA_HEAD_NOT_067/,
  );
});

test('rejects a running worker, unlocked execution, or incomplete schema', () => {
  assert.throws(() => assertPostMigrationResumeState(ledger(), { ...state(), activeLeases: 1 }),
    /POST_MIGRATION_ACTIVE_LEASE_PRESENT/);
  assert.throws(() => assertPostMigrationResumeState(ledger(), { ...state(), paused: false }),
    /POST_MIGRATION_DATABASE_EXECUTION_CONTROL_NOT_LOCKED/);
  assert.throws(() => assertPostMigrationResumeState(ledger(), { ...state(), compressedArchive: false }),
    /POST_MIGRATION_SCHEMA_INVARIANT_MISSING/);
});
