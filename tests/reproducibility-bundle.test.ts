import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ResearchDurableStore } from '../src/storage/research-durable-store.js';
import { buildReproducibilityBundle, verifyReproducibilityBundle } from '../src/research/reproducibility-bundle.js';
import { buildShadowPredictionReceipt } from '../src/research/shadow-prediction-receipt.js';
import type { ModelRegistryRecord } from '../src/research/empirical-model-registry.js';

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'theta-repro-bundle-'));
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

test('CORE CLAIM: a bundle whose model record is not yet saved fails verification, never silently valid', () => {
  const { store, cleanup } = harness();
  try {
    const bundle = buildReproducibilityBundle({
      model: modelRecord(), campaignId: null, normalizationVersion: null, predictionReceiptIds: [], outcomeJoinPredictionIds: [],
    });
    const result = verifyReproducibilityBundle(bundle, store);
    assert.equal(result.valid, false);
    assert.equal(result.modelRecordFound, false);
  } finally { cleanup(); }
});

test('a bundle whose model record IS saved, with no other references, verifies valid', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord());
    const bundle = buildReproducibilityBundle({
      model: modelRecord(), campaignId: null, normalizationVersion: null, predictionReceiptIds: [], outcomeJoinPredictionIds: [],
    });
    const result = verifyReproducibilityBundle(bundle, store);
    assert.equal(result.valid, true);
    assert.equal(result.selectionBiasReceiptFound, 'NOT_REFERENCED');
  } finally { cleanup(); }
});

test('CORE CLAIM (overnight §20): a dangling predictionReceiptId reference (never actually saved) fails verification', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord());
    const bundle = buildReproducibilityBundle({
      model: modelRecord(), campaignId: null, normalizationVersion: null,
      predictionReceiptIds: ['prediction-never-saved'], outcomeJoinPredictionIds: [],
    });
    const result = verifyReproducibilityBundle(bundle, store);
    assert.equal(result.valid, false);
    assert.deepEqual(result.missingPredictionReceipts, ['prediction-never-saved']);
  } finally { cleanup(); }
});

test('a predictionReceiptId that IS actually saved resolves and passes verification', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord());
    store.saveShadowPredictionReceipt(buildShadowPredictionReceipt({
      predictionId: 'p1', modelId: 'entry-baseline', modelVersion: 'v1', targetId: 'ENTRY_PROFITABILITY',
      entityId: 'c1', decisionId: 'd1', featureSnapshotHash: 'h1', predictedAt: '2026-09-26T00:00:00Z',
      prediction: 0.5, uncertainty: null, sourceSha: 'sha1', workerSha: null, strategyScope: 'THETA_CONVENTIONAL',
    }));
    const bundle = buildReproducibilityBundle({
      model: modelRecord(), campaignId: null, normalizationVersion: null,
      predictionReceiptIds: ['p1'], outcomeJoinPredictionIds: [],
    });
    const result = verifyReproducibilityBundle(bundle, store);
    assert.equal(result.valid, true);
    assert.deepEqual(result.missingPredictionReceipts, []);
  } finally { cleanup(); }
});
