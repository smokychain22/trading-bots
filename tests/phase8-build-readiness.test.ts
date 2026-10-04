import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPhase8BuildReadinessReceipt } from '../src/research/phase8-build-readiness.js';

test('Phase 8 build denominator has no source blocker and every claim names executable evidence', () => {
  const receipt = buildPhase8BuildReadinessReceipt();
  assert.equal(receipt.buildReady, true);
  assert.equal(receipt.empiricalStatus, 'READY_FOR_DATA');
  assert.equal(receipt.blockedSourceCount, 0);
  assert.ok(receipt.readyCount > 0);
  assert.ok(receipt.readyForDataCount > 0);
  for (const capability of receipt.capabilities) {
    assert.ok(capability.sourceFiles.every((path) => existsSync(resolve(path))), `${capability.id} missing source`);
    assert.ok(capability.testFiles.every((path) => existsSync(resolve(path))), `${capability.id} missing test`);
    assert.notEqual(capability.state, 'BLOCKED_SOURCE');
  }
  assert.deepEqual([receipt.orderSubmissions, receipt.brokerMutations, receipt.followerSubmissions], [0, 0, 0]);
  assert.equal(receipt.liveAuthorization, 'NOT_GRANTED');
});

test('Phase 8 learning modules cannot become broker authorities', () => {
  for (const path of ['src/theta/q-filter-analysis.ts','src/research/wait-regret-dataset.ts',
    'src/research/management-counterfactual-analysis.ts','src/research/sizing-challenger-replay.ts']) {
    const source = readFileSync(resolve(path), 'utf8');
    assert.doesNotMatch(source, /executionAuthorized:\s*true|brokerAuthority:\s*true/);
  }
});
