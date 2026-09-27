import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('the ordinary migration command refuses Aiven before opening a connection', () => {
  const result = spawnSync(process.execPath, ['tools/database-migrate.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_RUNTIME_AUTHORITY: 'AIVEN',
      AIVEN_DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:1/placeholder',
      THETA_MIGRATION_CHECKPOINT_ACTIVE: '',
    },
    timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.state, 'FAILED');
  assert.equal(receipt.normalizedFailureCode, 'MIGRATION_CHECKPOINT_REQUIRED');
  assert.equal(receipt.migrationId, 'MIGRATION_PROCESS');
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stderr, /placeholder:placeholder/);
  assert.doesNotMatch(result.stdout, /placeholder:placeholder/);
});
