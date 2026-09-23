import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('database preflight reports a bounded connection error without emitting host or URL', () => {
  const connection = 'postgresql://' + 'x:x@127.0.0.1:1/x';
  const result = spawnSync(process.execPath, ['tools/database-target-preflight.mjs'], {
    encoding: 'utf8', timeout: 12_000,
    env: { AIVEN_DATABASE_URL: connection },
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr.trim()), { connectivity: 'FAIL', errorCode: 'ECONNREFUSED' });
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes('127.0.0.1'));
  assert.ok(!result.stderr.includes('x:x@'));
  assert.ok(!result.stderr.includes('at GetAddrInfoReqWrap'));
});
