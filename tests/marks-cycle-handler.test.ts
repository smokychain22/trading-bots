import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseLocalWorkerOperation } from '../src/theta/autonomous-runtime-handler.js';

const handlerSource = readFileSync(new URL('../src/theta/autonomous-runtime-handler.ts', import.meta.url), 'utf8');
const branchStart = handlerSource.indexOf("if (operation === 'RUNTIME_MARKS_CYCLE') {");
const branchEnd = handlerSource.indexOf("if (operation === 'RUNTIME_ZERO_TRADE_DIAGNOSTIC') {");
const branch = handlerSource.slice(branchStart, branchEnd);

test('the marks tick is a distinct, recognised operation and unknown spellings are not silently mapped to it', () => {
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-marks-cycle' } }), 'RUNTIME_MARKS_CYCLE');
  assert.notEqual(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-marks' } }), 'RUNTIME_MARKS_CYCLE');
  assert.equal(parseLocalWorkerOperation({ headers: { 'x-theta-operation': 'runtime-observation-cycle' } }), 'RUNTIME_OBSERVATION_CYCLE');
});

test('the marks tick branch is read-only: no lease acquisition, no worker registration, no cycle-state writes, no broker surface', () => {
  assert.ok(branchStart > 0 && branchEnd > branchStart, 'branch located');
  for (const forbidden of [/acquireLease\(/, /\.register\(/, /cycleStarted\(/, /cycleCompleted\(/, /heartbeat\(/, /recordResumeGap\(/,
    /submitOrder|cancelOrder|replaceOrder/, /PaperOrderCoordinator/, /runAutonomousRuntimeCycle\(/]) {
    assert.doesNotMatch(branch, forbidden, `marks branch must not use ${String(forbidden)}`);
  }
  assert.match(branch, /localIdentity\.kind !== 'VALID'[\s\S]*local_worker_identity_required/, 'requires an authenticated local worker identity');
  assert.match(branch, /activeLeaseOwner\([\s\S]*marks_tick_requires_primary_lease/, 'only the current primary lease owner may tick');
  assert.match(branch, /processDueExecutionObservations\(/);
  assert.match(branch, /brokerMutations: 0, ordersSubmitted: 0/);
});

test('the marks tick passes the same runtime schema-compatibility gate as every other runtime operation', () => {
  assert.match(handlerSource, /operation === 'RUNTIME_MARKS_CYCLE'\s*\n\s*\|\| operation === 'RUNTIME_EVIDENCE_CYCLE'\) \{\s*\n\s*const compatibility = await inspectRuntimeSchemaCompatibility/);
});
