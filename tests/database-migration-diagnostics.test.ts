import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMigrationFailure, runMigrationSequence } from '../tools/database-migration-runner.mjs';

class FakeMigrationClient {
  readonly executed: string[] = [];
  constructor(readonly applied: string[], readonly failOn: string | null = null) {}

  async query(sql: string): Promise<{ rows: Array<{ version: string }> }> {
    if (sql === 'SELECT version FROM core.schema_migration ORDER BY version') {
      return { rows: this.applied.map((version) => ({ version })) };
    }
    if (sql === 'ROLLBACK') return { rows: [] };
    this.executed.push(sql);
    const migrationId = sql.replace('SQL:', '');
    if (this.failOn === migrationId) {
      throw Object.assign(new Error('password=never-persist-this postgresql://user:secret@private/db'), { code: '42601' });
    }
    this.applied.push(migrationId);
    return { rows: [] };
  }
}

class FreshMigrationClient extends FakeMigrationClient {
  ledgerExists = false;

  override async query(sql: string): Promise<{ rows: Array<{ version: string }> }> {
    if (sql === 'SELECT version FROM core.schema_migration ORDER BY version' && !this.ledgerExists) {
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    }
    if (sql.startsWith('SQL:')) this.ledgerExists = true;
    return super.query(sql);
  }
}

const files = ['065_aegis_iv_stress_evidence.sql', '066_local_observation_evidence.sql',
  '067_postgres_cycle_evidence_compaction.sql'];
const migrationId = (file: string) => file.replace(/\.sql$/, '');
const firstMigrationId = '065_aegis_iv_stress_evidence';

test('failed migration records the exact child cause, preserves schema 064 and never attempts later migrations', async () => {
  const client = new FakeMigrationClient(['064_alpaca_corporate_action_observation'], firstMigrationId);
  const emitted: unknown[] = [];
  const result = await runMigrationSequence({
    client, files, readMigration: async (file: string) => `SQL:${migrationId(file)}`,
    emit: (value: unknown) => emitted.push(value),
    now: () => new Date('2026-09-27T00:00:00.000Z'),
  });
  assert.equal(result.state, 'FAILED');
  assert.equal(result.failure?.migrationId, '065_aegis_iv_stress_evidence');
  assert.equal(result.failure?.schemaHeadBefore, '064_alpaca_corporate_action_observation');
  assert.equal(result.failure?.schemaHeadAfter, '064_alpaca_corporate_action_observation');
  assert.equal(result.failure?.migrationLedgerChanged, false);
  assert.equal(result.failure?.sqlState, '42601');
  assert.equal(result.failure?.normalizedFailureCode, 'MIGRATION_STATEMENT_SQLSTATE_42601');
  assert.deepEqual(client.executed.filter((sql) => sql.startsWith('SQL:')),
    ['SQL:065_aegis_iv_stress_evidence']);
  assert.equal(JSON.stringify(emitted).includes('never-persist-this'), false);
  assert.equal(JSON.stringify(emitted).includes('private'), false);
});

test('successful migration sequence advances each child and the ledger in order', async () => {
  const client = new FakeMigrationClient(['064_alpaca_corporate_action_observation']);
  const emitted: Array<{ state?: string; migrationId?: string }> = [];
  const result = await runMigrationSequence({
    client, files, readMigration: async (file: string) => `SQL:${migrationId(file)}`,
    emit: (value: { state?: string; migrationId?: string }) => emitted.push(value),
    now: () => new Date('2026-09-27T00:00:00.000Z'),
  });
  assert.equal(result.state, 'MIGRATED');
  assert.equal(result.final.schemaHead, '067_postgres_cycle_evidence_compaction');
  assert.deepEqual(emitted.filter((value) => value.state === 'COMPLETED').map((value) => value.migrationId),
    files.map(migrationId));
});

test('migration failure classifier exposes typed categories and never diagnostic text', () => {
  assert.deepEqual(classifyMigrationFailure(Object.assign(new Error('private host'), { code: 'EAI_AGAIN' })), {
    normalizedFailureCode: 'MIGRATION_DB_DNS_FAILURE', failureClass: 'DNS', sqlState: null,
    providerError: 'EAI_AGAIN',
  });
  const sql = classifyMigrationFailure(Object.assign(new Error('password=secret'), { code: '57P03' }));
  assert.equal(sql.normalizedFailureCode, 'MIGRATION_DB_CONNECTION_FAILURE');
  assert.equal(sql.providerError, 'POSTGRES_57P03');
  assert.equal(JSON.stringify(sql).includes('secret'), false);
});

test('a fresh database without a migration ledger can still run its bootstrap migration', async () => {
  const client = new FreshMigrationClient([]);
  const bootstrap = ['001_bootstrap.sql'];
  const result = await runMigrationSequence({
    client, files: bootstrap, readMigration: async () => 'SQL:001_bootstrap', emit: () => undefined,
    now: () => new Date('2026-09-27T00:00:00.000Z'),
  });
  assert.equal(result.state, 'MIGRATED');
  assert.equal(result.initial.schemaHead, null);
  assert.equal(result.final.schemaHead, '001_bootstrap');
});
