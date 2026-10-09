import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectProtectedEnvironment } from '../tools/theta-protected-env-diagnostic.mjs';

const synthetic = [
  'AIVEN_DATABASE_URL=postgresql://synthetic-user:synthetic-private-password@synthetic.aivencloud.com:1234/defaultdb?sslmode=require',
  'DATABASE_RUNTIME_AUTHORITY=AIVEN',
  'MASTER_PAPER_EXECUTION_ENABLED=false',
  'FOLLOWER_PAPER_EXECUTION_ENABLED=false',
  'PAPER_PAUSE_NEW_ORDERS=true',
].join('\n');

test('protected environment diagnostic emits only fixed predicates', () => {
  const result = inspectProtectedEnvironment(synthetic);
  assert.deepEqual(result, {
    diagnosticVersion: 'theta-protected-env-presence-v1',
    authorityAiven: true, aivenUrlValid: true, aivenHostAllowed: true,
    credentialConfigured: true, masterDisabled: true, followerDisabled: true,
    newOrdersPaused: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /synthetic-user|synthetic-private-password|defaultdb/);
});

test('CLI cannot echo secret-bearing source or error text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'theta-protected-env-'));
  try {
    const path = join(directory, 'synthetic.env');
    writeFileSync(path, `${synthetic}\n`);
    const result = spawnSync(process.execPath, ['tools/theta-protected-env-diagnostic.mjs',
      `--environment-file=${path}`], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).credentialConfigured, true);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-user|synthetic-private-password|defaultdb/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed URL and unreadable file fail without disclosing source text', () => {
  const malformed = inspectProtectedEnvironment('AIVEN_DATABASE_URL=synthetic-private-password\n');
  assert.equal(malformed.aivenUrlValid, false);
  assert.equal(malformed.credentialConfigured, false);
  assert.doesNotMatch(JSON.stringify(malformed), /synthetic-private-password/);
  const missing = spawnSync(process.execPath, ['tools/theta-protected-env-diagnostic.mjs',
    '--environment-file=Z:/theta-nonexistent/private.env'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.deepEqual(JSON.parse(missing.stdout), { state: 'BLOCKED', code: 'ENVIRONMENT_FILE_UNREADABLE' });
  assert.equal(missing.stderr, '');
});
