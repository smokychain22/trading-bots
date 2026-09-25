import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveSelectorPipelineRun, assertBaselineFirst, evaluateComplexModelGate,
} from '../src/research/adaptive-selector-research-pipeline.js';

test('a baseline model needs no baselineModelId', () => {
  assert.doesNotThrow(() => assertBaselineFirst(null, true, []));
});

test('CORE CLAIM (§38): a challenger without a baselineModelId is rejected', () => {
  assert.throws(() => assertBaselineFirst(null, false, []), /CHALLENGER_WITHOUT_BASELINE/);
});

test('a challenger referencing an unregistered baseline is rejected', () => {
  assert.throws(() => assertBaselineFirst('ghost-baseline', false, []), /BASELINE_NOT_REGISTERED/);
});

test('a challenger referencing a model that is not itself a baseline is rejected', () => {
  assert.throws(
    () => assertBaselineFirst('other-challenger', false, [{ modelId: 'other-challenger', isBaseline: false }]),
    /REFERENCED_MODEL_IS_NOT_A_BASELINE/,
  );
});

test('a challenger with a real, registered baseline passes', () => {
  assert.doesNotThrow(() => assertBaselineFirst('entry-baseline', false, [{ modelId: 'entry-baseline', isBaseline: true }]));
});

test('CORE CLAIM (§39): the complex-model gate fails when ANY condition is unmet', () => {
  const result = evaluateComplexModelGate({
    independentN: 5, minimumIndependentN: 30, baselineEstablished: true, pitLeakagePassed: true,
    purgedWalkForwardPassed: true, calibrationInfrastructurePassed: true, oosReservationPassed: true,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.failedConditions.some((c) => c.includes('independentN')));
});

test('the complex-model gate passes only when every condition is real and true', () => {
  const result = evaluateComplexModelGate({
    independentN: 200, minimumIndependentN: 30, baselineEstablished: true, pitLeakagePassed: true,
    purgedWalkForwardPassed: true, calibrationInfrastructurePassed: true, oosReservationPassed: true,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.failedConditions.length, 0);
});

test('CORE CLAIM: the pipeline run enforces stage ordering -- skipping a stage throws', () => {
  const run = new AdaptiveSelectorPipelineRun();
  assert.throws(() => run.advance('BASELINE_COMPARATOR', {}), /PIPELINE_OUT_OF_ORDER/);
});

test('stages advance correctly in order and results are retrievable', () => {
  const run = new AdaptiveSelectorPipelineRun();
  run.advance('DATASET_GENERATION', { rows: 10 });
  run.advance('FEATURE_EXTRACTION', { features: 5 });
  assert.equal(run.reachedStage(), 'FEATURE_EXTRACTION');
  assert.deepEqual(run.resultFor('DATASET_GENERATION'), { rows: 10 });
});
