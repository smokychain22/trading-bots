import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRuntimeMismatches, type RuntimeTruthInputs } from '../src/theta/runtime-system-truth.js';

const healthy: RuntimeTruthInputs = {
  sourceSha: 'a'.repeat(40), sourceDirty: false, workerSha: 'a'.repeat(40), activeWorkerLeases: 1,
  workerHeartbeat: '2026-09-23T13:30:00.000Z', workerMode: 'MASTER_THETA_PAPER',
  executionGate: 'LOCKED', migrationHead: '064_alpaca_corporate_action_observation',
  requiredMigrationPresent: true, observedAt: '2026-09-23T13:30:20.000Z',
};

test('current locked release with schema 064 has no mismatch', () => {
  assert.deepEqual(deriveRuntimeMismatches(healthy), []);
});

test('independent runtime contradictions are all reported', () => {
  assert.deepEqual(deriveRuntimeMismatches({ ...healthy, workerSha: 'b'.repeat(40),
    activeWorkerLeases: 2, workerHeartbeat: '2026-09-23T13:20:00.000Z',
    workerMode: 'THETA_SHADOW_ONLY', executionGate: 'ACTIVE', requiredMigrationPresent: false }), [
    'SOURCE_SHA_NE_WORKER_SHA', 'MULTIPLE_ACTIVE_WORKERS', 'WORKER_STALE',
    'WORKER_MODE_UNEXPECTED', 'EXECUTION_GATE_NOT_LOCKED', 'MIGRATION_MISMATCH',
  ]);
});

test('missing runtime observations never look healthy', () => {
  assert.deepEqual(deriveRuntimeMismatches({ ...healthy, workerSha: null,
    workerHeartbeat: null, activeWorkerLeases: null, requiredMigrationPresent: null }), [
    'RUNTIME_EVIDENCE_UNAVAILABLE',
  ]);
});

test('unreleased local source changes do not inherit worker proof', () => {
  assert.deepEqual(deriveRuntimeMismatches({ ...healthy, sourceDirty: true }), ['UNRELEASED_SOURCE_CHANGES']);
});
