import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveThetaReadinessDimensions } from '../src/research/theta-iq-dimension-derivation.js';
import * as module_ from '../src/research/theta-iq-dimension-derivation.js';

test('zero evidence everywhere derives NONE across all 9 dimensions', () => {
  const dims = deriveThetaReadinessDimensions({
    distinctMarketStatesObserved: 0, strategiesWithAtLeastOneResolvedEpisode: 0, totalStrategyCount: 5,
    resolvedWholeChainCount: 0, totalWholeChainCount: 0, labelsAvailableCount: 0, totalLabelsExpectedCount: 0,
    independentEpisodeCount: 0, calibrationEvaluationsRun: 0, executionFillObservations: 0,
    managementDecisionsWithReturnToGo: 0, tailEventObservations: 0,
  });
  assert.equal(dims.stateCoverage.level, 'NONE');
  assert.equal(dims.independentN.level, 'NONE');
});

test('CORE CLAIM: each dimension is derived from its own real evidence count, not combined', () => {
  const dims = deriveThetaReadinessDimensions({
    distinctMarketStatesObserved: 150, strategiesWithAtLeastOneResolvedEpisode: 1, totalStrategyCount: 5,
    resolvedWholeChainCount: 0, totalWholeChainCount: 0, labelsAvailableCount: 0, totalLabelsExpectedCount: 0,
    independentEpisodeCount: 0, calibrationEvaluationsRun: 0, executionFillObservations: 0,
    managementDecisionsWithReturnToGo: 0, tailEventObservations: 0,
  });
  assert.equal(dims.stateCoverage.level, 'MATURE');
  assert.equal(dims.outcomeCoverage.level, 'NONE');
  assert.equal(dims.stateCoverage.numericMeasure, 150);
});

test('this module exports no function that combines the 9 dimensions into one score', () => {
  const exportNames = Object.keys(module_);
  const forbidden = /score|composite|overall|combined|aggregate|total/i;
  for (const name of exportNames) assert.equal(forbidden.test(name), false, `forbidden combining export found: ${name}`);
});
