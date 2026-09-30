import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
      entityId: 'c1', decisionId: 'd1', featureSnapshotHash: 'a'.repeat(64), predictedAt: '2026-09-26T00:00:00Z',
      prediction: 0.5, uncertainty: null, sourceSha: 'b'.repeat(40), workerSha: null, strategyScope: 'THETA_CONVENTIONAL',
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

test('existence is insufficient when dataset, model, metrics or outcome identity differs', () => {
  const { store, cleanup } = harness();
  try {
    store.saveModelRecord(modelRecord());
    const bundle = buildReproducibilityBundle({ model: modelRecord(), campaignId: null, normalizationVersion: null, predictionReceiptIds: [], outcomeJoinPredictionIds: [] });
    assert.equal(verifyReproducibilityBundle({ ...bundle, datasetHash: 'f'.repeat(64) }, store).valid, false);
    assert.equal(verifyReproducibilityBundle({ ...bundle, metricsSnapshot: { ...bundle.metricsSnapshot, independentN: 1000 } }, store).valid, false);
    assert.equal(verifyReproducibilityBundle({ ...bundle, outcomeJoinPredictionIds: ['missing'] }, store).valid, false);
    store.saveShadowPredictionReceipt(buildShadowPredictionReceipt({ predictionId: 'foreign', modelId: 'another', modelVersion: 'v1', targetId: 'ENTRY_PROFITABILITY', entityId: 'e', decisionId: 'd', featureSnapshotHash: 'a'.repeat(64), predictedAt: '2026-09-26', prediction: 0.5, uncertainty: null, sourceSha: 'b'.repeat(40), workerSha: null, strategyScope: 'THETA_CONVENTIONAL' }));
    assert.equal(verifyReproducibilityBundle({ ...bundle, predictionReceiptIds: ['foreign'] }, store).valid, false);
  } finally { cleanup(); }
});

test('offline CLI persists exact model, prediction and resolved join and verifies after a second process restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-ledger-'));
  try {
    const prediction = buildShadowPredictionReceipt({ predictionId: 'p1', modelId: 'entry-baseline', modelVersion: 'v1', targetId: 'ENTRY_PROFITABILITY', entityId: 'c1', decisionId: 'd1', featureSnapshotHash: 'a'.repeat(64), predictedAt: '2026-09-26T00:00:00Z', prediction: 0.5, uncertainty: null, sourceSha: 'b'.repeat(40), workerSha: null, strategyScope: 'THETA_CONVENTIONAL' });
    const bundle = buildReproducibilityBundle({ model: modelRecord(), campaignId: null, normalizationVersion: null, predictionReceiptIds: ['p1'], outcomeJoinPredictionIds: ['p1'] });
    const payload = { version: 'theta-research-ledger-input-v1', models: [modelRecord()], predictions: [prediction], selectionBias: [],
      joins: [{ predictionId: 'p1', outcome: { entityId: 'c1', decisionId: 'd1', chainId: null, targetId: 'ENTRY_PROFITABILITY', modelVersionAtOutcomeTime: 'v1', featureSnapshotHash: 'a'.repeat(64), observedOutcome: 1, resolvedAt: '2026-09-27T00:00:00Z', isResolved: true }, joinedAt: '2026-09-27T01:00:00Z' }], bundle,
      entryReadiness: { modelFamily: 'REGULARIZED_LOGISTIC', target: 'P_ASSIGNMENT', asOf: '2026-09-27T01:00:00Z',
        sufficiency: { rawRowCount: 0, resolvedLabelRowCount: 0, censoredRowCount: 0, effectiveIndependentN: 0,
          minimumEffectiveN: 2, distinctUnderlyingCount: 0, minimumDistinctUnderlyings: 1 } } };
    const input = join(root, 'input.json'), store = join(root, 'ledger.sqlite');
    writeFileSync(input, JSON.stringify(payload));
    for (let i = 0; i < 2; i += 1) {
      const result = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'tools/theta-research-ledger.ts', `--input=${input}`, `--store=${store}`], { encoding: 'utf8', timeout: 15000 }));
      assert.equal(result.integrity.checked, 3);
      assert.equal(result.verification.valid, true);
      assert.equal(result.promotionGranted, false);
      assert.equal(result.entryReadiness.state, 'DATASET_NOT_READY');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
