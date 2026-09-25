import assert from 'node:assert/strict';
import test from 'node:test';
import { EmpiricalModelRegistry, type ModelRegistryRecord } from '../src/research/empirical-model-registry.js';

function record(overrides: Partial<ModelRegistryRecord> = {}): ModelRegistryRecord {
  return {
    contractVersion: 'theta-empirical-model-registry-v1', modelId: 'entry-profitability', modelVersion: '0.1.0',
    targetId: 'ENTRY_PROFITABILITY', strategyScope: ['THETA_CONVENTIONAL'], actionScope: ['OPEN_CSP'],
    featureSetVersion: 'theta-feature-set-v1', datasetId: 'ds1', datasetHash: 'h1', labelVersion: 'l1',
    codeSha: 'sha1', trainingWindow: { start: '2026-01-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
    validationWindows: [], finalOosWindow: null, dependenceGroupingVersion: 'dg1', purgeVersion: 'pg1',
    calibrationMethod: null, calibrationArtifactHash: null, costModelVersion: 'cm1', hyperparameterSearchId: null,
    numberOfTrials: 1, selectionBiasReceiptId: null,
    metrics: { brierScore: null, logLoss: null, ece: null, independentN: null },
    artifactHash: 'a1', createdAt: '2026-06-02T00:00:00Z', promotionState: 'RESEARCH', ...overrides,
  };
}

test('CORE CLAIM: consumers reference an exact (modelId, modelVersion) -- no getLatest/getCurrent method exists', () => {
  const registry = new EmpiricalModelRegistry();
  assert.ok(!('getLatest' in registry));
  assert.ok(!('getCurrent' in registry));
});

test('a registered record is retrievable by its exact version', () => {
  const registry = new EmpiricalModelRegistry();
  registry.register(record());
  assert.equal(registry.get('entry-profitability', '0.1.0')?.modelId, 'entry-profitability');
  assert.equal(registry.get('entry-profitability', '0.2.0'), null);
});

test('CORE CLAIM: registry versions are immutable -- re-registering the same version with different content throws', () => {
  const registry = new EmpiricalModelRegistry();
  registry.register(record());
  assert.throws(() => registry.register(record({ artifactHash: 'a2' })), /MODEL_REGISTRY_IMMUTABLE_VERSION_CONFLICT/);
});

test('an identical re-registration is an idempotent no-op, not an error', () => {
  const registry = new EmpiricalModelRegistry();
  registry.register(record());
  assert.doesNotThrow(() => registry.register(record()));
});
