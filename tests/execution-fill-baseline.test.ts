import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baseRateFillProbability, featureVectorFromRow, fitFillBaseline, predictFillProbability,
  predictFillProbabilityWithDiagnostics,
} from '../src/research/execution-fill-baseline.js';
import type { FillProbabilityRow } from '../src/research/execution-dataset-contract.js';

function row(overrides: Partial<FillProbabilityRow> = {}): FillProbabilityRow {
  return {
    contractVersion: 'theta-execution-dataset-contract-v1', orderIntentId: 'o1', side: 'SELL', size: 1,
    limitOffsetFromMid: 0.02, quoteAgeSeconds: 5, underlyingLiquidity: 1_000_000, optionOpenInterest: 500,
    optionVolume: 100, timeOfDayBucket: 'MORNING', filled: true, terminalStatus: 'FILLED', ...overrides,
  };
}

test('baseRateFillProbability is a real fraction, null for zero rows', () => {
  assert.equal(baseRateFillProbability([]), null);
  const rows = [row({ filled: true }), row({ filled: false }), row({ filled: true }), row({ filled: true })];
  assert.equal(baseRateFillProbability(rows), 0.75);
});

test('CORE CLAIM: unfilled orders remain in the training population -- they are the real negative class', () => {
  const rows = [row({ filled: true }), row({ filled: false, terminalStatus: 'CANCELLED' })];
  const model = fitFillBaseline(rows, 1.0, 0.1, 50);
  assert.equal(model.trainingN, 2);
});

test('a fitted model predicts probabilities within [0,1]', () => {
  const rows = Array.from({ length: 20 }, (_, i) => row({ orderIntentId: `o${i}`, filled: i % 2 === 0, limitOffsetFromMid: i % 2 === 0 ? 0.01 : 0.10 }));
  const model = fitFillBaseline(rows);
  const prediction = predictFillProbability(model, featureVectorFromRow(rows[0] as FillProbabilityRow));
  assert.ok(prediction >= 0 && prediction <= 1);
});

test('zero rows produces a real, non-throwing zero-coefficient model', () => {
  const model = fitFillBaseline([]);
  assert.equal(model.trainingN, 0);
  assert.equal(model.coefficients.intercept, 0);
});

test('ADVERSARIAL (overnight §24): a well-in-domain feature vector is never flagged out-of-domain', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({ orderIntentId: `o${i}`, filled: i % 2 === 0, underlyingLiquidity: 1_000_000 + i * 1000 }));
  const model = fitFillBaseline(rows, 1.0, 0.1, 50);
  const diagnostics = predictFillProbabilityWithDiagnostics(model, featureVectorFromRow(rows[0] as FillProbabilityRow));
  assert.equal(diagnostics.outOfDomain, false);
  assert.ok(diagnostics.probability >= 0 && diagnostics.probability <= 1);
});

test('CORE CLAIM: extreme, unseen-scale liquidity input at predict time is flagged out-of-domain, never silently trusted as in-distribution', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({ orderIntentId: `o${i}`, filled: i % 2 === 0, underlyingLiquidity: 1_000_000 + i * 1000 }));
  const model = fitFillBaseline(rows, 1.0, 0.1, 50);
  const wildFeatures = featureVectorFromRow(row({ underlyingLiquidity: 1_000_000_000_000 }));
  const diagnostics = predictFillProbabilityWithDiagnostics(model, wildFeatures);
  assert.equal(diagnostics.outOfDomain, true);
  assert.ok(diagnostics.outOfDomainFields.includes('underlyingLiquidity'));
  assert.ok(Number.isFinite(diagnostics.probability)); // still produces a real, finite number -- flags, never crashes
});

test('a missing (null) feature at predict time never crashes -- imputed via the model\'s own training mean', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ orderIntentId: `o${i}`, filled: i % 2 === 0 }));
  const model = fitFillBaseline(rows, 1.0, 0.1, 30);
  const missing = { limitOffsetFromMid: 0.02, quoteAgeSeconds: null, underlyingLiquidity: null, optionOpenInterest: null, optionVolume: null };
  const diagnostics = predictFillProbabilityWithDiagnostics(model, missing);
  assert.ok(Number.isFinite(diagnostics.probability));
});

test('a zero-training-data model is always reported out-of-domain via modelHasZeroTrainingData', () => {
  const model = fitFillBaseline([]);
  const diagnostics = predictFillProbabilityWithDiagnostics(model, featureVectorFromRow(row()));
  assert.equal(diagnostics.modelHasZeroTrainingData, true);
  assert.equal(diagnostics.outOfDomain, true);
});

test('an extreme spread/liquidity training population (zero-variance feature) still fits without NaN coefficients', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ orderIntentId: `o${i}`, filled: i % 2 === 0, underlyingLiquidity: 5_000_000 })); // identical for every row
  const model = fitFillBaseline(rows, 1.0, 0.1, 50);
  assert.ok(Object.values(model.coefficients).every((c) => Number.isFinite(c)));
});
