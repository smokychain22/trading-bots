import assert from 'node:assert/strict';
import test from 'node:test';
import { EmpiricalModelRegistry, type ModelRegistryRecord } from '../src/research/empirical-model-registry.js';

function record(overrides: Partial<ModelRegistryRecord> = {}): ModelRegistryRecord {
  return {
    contractVersion: 'theta-empirical-model-registry-v1', modelId: 'entry-profitability', modelVersion: '0.1.0',
    targetId: 'ENTRY_PROFITABILITY', strategyScope: ['THETA_CONVENTIONAL'], actionScope: ['OPEN_CSP'],
    featureSetVersion: 'theta-feature-set-v1', datasetId: 'ds1', datasetHash: 'a'.repeat(64), labelVersion: 'l1',
    codeSha: 'b'.repeat(40), trainingWindow: { start: '2026-01-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
    validationWindows: [], finalOosWindow: null, dependenceGroupingVersion: 'dg1', purgeVersion: 'pg1',
    calibrationMethod: null, calibrationArtifactHash: null, costModelVersion: 'cm1', hyperparameterSearchId: null,
    numberOfTrials: 1, selectionBiasReceiptId: null,
    metrics: { brierScore: null, logLoss: null, ece: null, independentN: null },
    artifactHash: 'c'.repeat(64), createdAt: '2026-06-02T00:00:00Z', promotionState: 'RESEARCH',
    baselineModelId: null, isBaseline: false, ...overrides,
  };
}

test('CORE CLAIM (Command 5B item 20): a PAPER_CHALLENGER with no baselineModelId and isBaseline=false is rejected', () => {
  const registry = new EmpiricalModelRegistry();
  assert.throws(
    () => registry.register(record({ promotionState: 'PAPER_CHALLENGER' })),
    /MODEL_REGISTRY_CHALLENGER_WITHOUT_BASELINE/,
  );
});

test('a PAPER_CHALLENGER with a real baselineModelId registers fine', () => {
  const registry = new EmpiricalModelRegistry();
  registry.register(record({ modelId: 'baseline-model', isBaseline: true }));
  registry.register(record({ modelId: 'challenger-model', promotionState: 'PAPER_CHALLENGER', baselineModelId: 'baseline-model', baselineModelVersion: '0.1.0' }));
  assert.equal(registry.get('challenger-model', '0.1.0')?.baselineModelId, 'baseline-model');
});

test('a model marked isBaseline=true cannot also reference another baselineModelId', () => {
  const registry = new EmpiricalModelRegistry();
  assert.throws(
    () => registry.register(record({ isBaseline: true, baselineModelId: 'something' })),
    /MODEL_REGISTRY_BASELINE_CANNOT_REFERENCE_ANOTHER_BASELINE/,
  );
});

test('RESEARCH/SHADOW states do not require a baselineModelId', () => {
  const registry = new EmpiricalModelRegistry();
  registry.register(record({ promotionState: 'RESEARCH' }));
  registry.register(record({ modelId: 'm2', promotionState: 'SHADOW' }));
});

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
  assert.throws(() => registry.register(record({ artifactHash: 'd'.repeat(64) })), /MODEL_REGISTRY_IMMUTABLE_VERSION_CONFLICT/);
});

test('an identical re-registration is an idempotent no-op, not an error', () => {
  const registry = new EmpiricalModelRegistry();
  registry.register(record());
  assert.doesNotThrow(() => registry.register(record()));
});

test('creation provenance is immutable in memory as well as durable storage', () => {
  const registry = new EmpiricalModelRegistry();
  registry.register(record());
  assert.throws(() => registry.register(record({ createdAt: '2026-10-01T00:00:00Z' })), /IMMUTABLE_VERSION_CONFLICT/);
});

test('registry owns its copies and tuple identities cannot collide', () => {
  const registry = new EmpiricalModelRegistry();
  const input = record();
  registry.register(input);
  Object.assign(input.metrics, { ece: 0.99 });
  const recovered = registry.get(input.modelId, input.modelVersion);
  assert.ok(recovered);
  Object.assign(recovered.metrics, { ece: 0.8 });
  assert.equal(registry.get(input.modelId, input.modelVersion)?.metrics.ece, null);
  registry.register(record({ modelId: 'a::b', modelVersion: 'c' }));
  registry.register(record({ modelId: 'a', modelVersion: 'b::c' }));
  assert.equal(registry.get('a::b', 'c')?.modelId, 'a::b');
  assert.equal(registry.get('a', 'b::c')?.modelId, 'a');
});

test('registry rejects invalid windows, nonfinite metrics/trials and unbound baselines', () => {
  for (const override of [
    { numberOfTrials: NaN }, { numberOfTrials: 1.5 },
    { trainingWindow: { start: 'bad', end: 'bad' } },
    { validationWindows: [{ start: '2026-05-01', end: '2026-06-02' }] },
    { finalOosWindow: { start: '2026-01-01', end: '2026-06-02' } },
    { metrics: { brierScore: Infinity, logLoss: null, ece: null, independentN: null } },
    { baselineModelId: 'baseline' },
  ] satisfies Partial<ModelRegistryRecord>[]) assert.throws(() => new EmpiricalModelRegistry().register(record(override)), /MODEL_REGISTRY_INVALID/);
});
