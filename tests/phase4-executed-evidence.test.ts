import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { certifyExecutedRequirement, evidenceSourceHash,
  type ReviewedRequirementBinding } from '../src/operations/executed-requirement-evidence.js';

test('Phase-4 evidence binds twelve reviewed mechanics to executed cases without claiming runtime or profitability', () => {
  const bindings = JSON.parse(readFileSync('docs/operations/THETA_PHASE4_REVIEWED_TEST_BINDINGS.json', 'utf8')) as ReviewedRequirementBinding[];
  const { artifactHash, ...body } = JSON.parse(readFileSync('docs/operations/evidence/THETA_PHASE4_EXECUTED_TESTS.json', 'utf8'));
  assert.equal(artifactHash, createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  assert.equal(body.executionSucceeded, true);
  assert.equal(body.failed, 0);
  assert.equal(body.currentWorkerProven, false);
  assert.equal(body.brokerAuthorized, false);
  assert.deepEqual(bindings.map(row => row.id), Array.from({ length: 12 }, (_, i) => `4.${i + 1}`));
  assert.equal(body.results.length, bindings.length);
  for (const binding of bindings) {
    const result = body.results.find((row: { requirementId: string }) => row.requirementId === binding.id);
    assert.ok(result, `${binding.id}: executed proof missing`);
    const hashes = Object.fromEntries(Object.keys(result.sourceHashes)
      .map(path => [path, evidenceSourceHash(readFileSync(path, 'utf8'))]));
    assert.deepEqual(result.sourceHashes, hashes, `${binding.id}: stale source proof`);
    assert.deepEqual(result, certifyExecutedRequirement(binding, result.executedTests, hashes));
    assert.equal(result.state, 'PASS', `${binding.id}: no inherited global PASS`);
    assert.equal(result.runtimeProven, false);
  }
});
