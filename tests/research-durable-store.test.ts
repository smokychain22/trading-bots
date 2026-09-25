import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ResearchDurableStore } from '../src/storage/research-durable-store.js';
import type { ModelRegistryRecord } from '../src/research/empirical-model-registry.js';

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-durable-'));
  const store = new ResearchDurableStore(join(root, 'durable.sqlite'));
  return { store, cleanup: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

function modelRecord(overrides: Partial<ModelRegistryRecord> = {}): ModelRegistryRecord {
  return {
    contractVersion: 'theta-empirical-model-registry-v1', modelId: 'entry-baseline', modelVersion: 'v1',
    targetId: 'ENTRY_PROFITABILITY', strategyScope: ['THETA_CONVENTIONAL'], actionScope: [], featureSetVersion: 'fs-v1',
    datasetId: 'ds-1', datasetHash: 'a'.repeat(64), labelVersion: 'lv-1', codeSha: 'b'.repeat(40),
    trainingWindow: { start: '2026-01-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
    validationWindows: [], finalOosWindow: null, dependenceGroupingVersion: 'dg-v1', purgeVersion: 'pv-1',
    calibrationMethod: null, calibrationArtifactHash: null, costModelVersion: 'cm-v1', hyperparameterSearchId: null,
    numberOfTrials: 1, selectionBiasReceiptId: null, metrics: { brierScore: null, logLoss: null, ece: null, independentN: null },
    artifactHash: 'c'.repeat(64), createdAt: '2026-09-26T00:00:00Z', promotionState: 'RESEARCH',
    baselineModelId: null, isBaseline: true,
    ...overrides,
  };
}

test('CORE CLAIM: an immutable model record is durable across store instances (same file)', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-durable-'));
  const path = join(root, 'durable.sqlite');
  try {
    const store1 = new ResearchDurableStore(path);
    store1.saveModelRecord(modelRecord());
    store1.close();
    const store2 = new ResearchDurableStore(path);
    const recovered = store2.getModelRecord('entry-baseline', 'v1');
    assert.equal(recovered?.modelId, 'entry-baseline');
    store2.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an identical re-save is an idempotent no-op', () => {
  const { store, cleanup } = harness();
  try {
    assert.equal(store.saveModelRecord(modelRecord()), 'INSERTED');
    assert.equal(store.saveModelRecord(modelRecord()), 'ALREADY_PRESENT_IDENTICAL');
  } finally { cleanup(); }
});

test('CORE CLAIM: a conflicting re-save under the same (modelId, modelVersion) throws -- no mutable overwrite path', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord());
    assert.throws(() => store.saveModelRecord(modelRecord({ numberOfTrials: 99 })), /RESEARCH_DURABLE_STORE_IDENTITY_CONFLICT/);
  } finally { cleanup(); }
});

test('listModelVersions returns every stored version for a modelId', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord({ modelVersion: 'v1' }));
    store.saveModelRecord(modelRecord({ modelVersion: 'v2' }));
    assert.deepEqual(store.listModelVersions('entry-baseline').sort(), ['v1', 'v2']);
  } finally { cleanup(); }
});

test('verify() proves hash integrity across all tables and detects zero corruption on a clean store', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord());
    const result = store.verify();
    assert.equal(result.valid, true);
    assert.equal(result.checked, 1);
  } finally { cleanup(); }
});

test('unsafe identifiers are rejected before ever reaching SQL', () => {
  const { store, cleanup } = harness();
  try {
    assert.throws(() => store.saveModelRecord(modelRecord({ modelId: "'; DROP TABLE model_registry_record; --" })), /RESEARCH_DURABLE_STORE_MODELID_INVALID/);
  } finally { cleanup(); }
});
