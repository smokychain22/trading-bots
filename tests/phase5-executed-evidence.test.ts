import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { certifyExecutedRequirement, evidenceSourceHash, type ReviewedRequirementBinding } from '../src/operations/executed-requirement-evidence.js';

test('Phase-5 reviewed denominator requires executed cases and exact source bytes without granting runtime or empirical maturity', () => {
  const bindings = JSON.parse(readFileSync('docs/operations/THETA_PHASE5_REVIEWED_TEST_BINDINGS.json', 'utf8')) as ReviewedRequirementBinding[];
  const { artifactHash, ...body } = JSON.parse(readFileSync('docs/operations/evidence/THETA_PHASE5_EXECUTED_TESTS.json', 'utf8'));
  assert.equal(artifactHash, createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  assert.equal(body.executionSucceeded, true);
  assert.equal(body.failed, 0);
  assert.equal(body.currentWorkerProven, false);
  assert.equal(body.brokerAuthorized, false);
  assert.deepEqual(bindings.map(row => row.id), Array.from({ length: 14 }, (_, i) => `5.${i + 1}`));
  assert.equal(body.results.length, bindings.length);
  for (const binding of bindings) {
    const result = body.results.find((row: { requirementId: string }) => row.requirementId === binding.id);
    assert.ok(result);
    const hashes = Object.fromEntries(Object.keys(result.sourceHashes).map(path => [path, evidenceSourceHash(readFileSync(path, 'utf8'))]));
    assert.deepEqual(result.sourceHashes, hashes, `${binding.id}: stale evidence`);
    assert.deepEqual(result, certifyExecutedRequirement(binding, result.executedTests, hashes));
    assert.equal(result.state, 'PASS');
  }
});
