import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
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

test('ADVERSARIAL (overnight §21): a missing artifact (never-saved modelId/version) returns null, never throws or fabricates a record', () => {
  const { store, cleanup } = harness();
  try {
    assert.equal(store.getModelRecord('never-saved', 'v1'), null);
  } finally { cleanup(); }
});

test('CORE CLAIM (overnight §21): a challenger referencing a baseline that was never saved is rejected -- the baselineModelId field alone is not proof the baseline exists', () => {
  const { store, cleanup } = harness();
  try {
    const challenger = modelRecord({
      modelId: 'entry-challenger', modelVersion: 'v1', isBaseline: false,
      baselineModelId: 'entry-baseline-never-saved', promotionState: 'PAPER_CHALLENGER',
    });
    assert.throws(() => store.saveModelRecord(challenger), /RESEARCH_DURABLE_STORE_BASELINE_NOT_FOUND:entry-baseline-never-saved/);
  } finally { cleanup(); }
});

test('a challenger referencing a REAL, already-saved baseline is accepted', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord({ modelId: 'entry-baseline', modelVersion: 'v1', isBaseline: true }));
    const challenger = modelRecord({
      modelId: 'entry-challenger', modelVersion: 'v1', isBaseline: false,
      baselineModelId: 'entry-baseline', promotionState: 'PAPER_CHALLENGER',
    });
    assert.equal(store.saveModelRecord(challenger), 'INSERTED');
  } finally { cleanup(); }
});

test('ADVERSARIAL: an immutable-record mutation attempt (raw UPDATE bypassing the class) is detected by verify(), not silently accepted as valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-durable-'));
  const path = join(root, 'durable.sqlite');
  try {
    const store = new ResearchDurableStore(path);
    store.saveModelRecord(modelRecord());
    store.close();
    // Reach past the class's own append-only API to simulate a corrupted/
    // hand-edited row -- verify() must catch this, since no legitimate
    // code path in this module ever performs an UPDATE.
    const direct = new DatabaseSync(path);
    direct.exec("UPDATE model_registry_record SET content_json='{\"tampered\":true}' WHERE model_id='entry-baseline'");
    direct.close();
    const reopened = new ResearchDurableStore(path);
    const result = reopened.verify();
    assert.equal(result.valid, false);
    assert.ok(result.invalidKeys.some((k) => k.includes('entry-baseline')));
    reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('two store instances against the same file (simulated concurrent writers) do not corrupt each other under WAL + busy_timeout', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-durable-'));
  const path = join(root, 'durable.sqlite');
  try {
    const storeA = new ResearchDurableStore(path);
    const storeB = new ResearchDurableStore(path);
    storeA.saveModelRecord(modelRecord({ modelVersion: 'v1' }));
    storeB.saveModelRecord(modelRecord({ modelVersion: 'v2' }));
    assert.deepEqual(storeA.listModelVersions('entry-baseline').sort(), ['v1', 'v2']);
    storeA.close(); storeB.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
