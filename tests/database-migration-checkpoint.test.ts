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
  assert.match(result.stderr, /AIVEN_PRODUCTION_MIGRATION_REQUIRES_VERIFIED_LOCAL_BACKUP_WORKFLOW/);
  assert.doesNotMatch(result.stderr, /placeholder:placeholder/);
});
