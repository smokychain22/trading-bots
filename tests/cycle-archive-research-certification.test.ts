import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('archive certification keeps canonical authority separate and requires complete durable drain', () => {
  const source = readFileSync('tools/certify-cycle-archive-research-export.ts', 'utf8');
  assert.match(source, /relationalCandidatePersistence: false/);
  assert.match(source, /archiveMode: 'ARCHIVE_ONLY_BY_DESIGN'/);
  assert.match(source, /coverageComplete/);
  assert.match(source, /pendingParquetBatchCount !== 0/);
  assert.match(source, /sqliteHashVerification/);
  assert.match(source, /parquetVerification/);
  assert.match(source, /brokerAuthority: false/);
  assert.doesNotMatch(source, /submitOrder|createOrder|cancelOrder/);
});
