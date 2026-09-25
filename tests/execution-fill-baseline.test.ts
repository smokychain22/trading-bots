import assert from 'node:assert/strict';
import test from 'node:test';
import { baseRateFillProbability, featureVectorFromRow, fitFillBaseline, predictFillProbability } from '../src/research/execution-fill-baseline.js';
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
