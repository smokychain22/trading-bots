import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aivenDeveloper1BootstrapStorageBudget, assessStorageBudget, forecastStorageGrowth,
} from '../src/storage/storage-budget.js';

test('storage budgets distinguish unknown growth from measured capacity breaches', () => {
  const base = {
    postgresTotalGb: 1, postgresDailyGrowthMb: null, canonicalStateMb: 100,
    observationsMb: 100, researchMb: 100, indexesMb: 100, toastMb: 100,
  };
  assert.equal(assessStorageBudget(base, aivenDeveloper1BootstrapStorageBudget).state, 'GROWTH_UNKNOWN');
  const breached = assessStorageBudget({ ...base, postgresDailyGrowthMb: 1, researchMb: 900 }, aivenDeveloper1BootstrapStorageBudget);
  assert.equal(breached.state, 'BREACHED');
  assert.deepEqual(breached.breached, ['RESEARCH_MB']);
});

test('storage growth forecast governs research pressure without blocking operational truth', () => {
  const policy = aivenDeveloper1BootstrapStorageBudget;
  const high = forecastStorageGrowth({
    postgresTotalGb: 3.7, postgresDailyGrowthMb: 100, canonicalStateMb: 100,
    observationsMb: 100, researchMb: 100, indexesMb: 100, toastMb: 100,
  }, policy);
  assert.equal(high.watermark, 'HIGH');
  assert.equal(high.researchWriteDisposition, 'DIVERT_TO_ARCHIVE');
  assert.equal(high.operationalTruthWritesAllowed, true);
  assert.ok(high.projectedDaysToHigh !== null && high.projectedDaysToHigh === 0);

  const critical = forecastStorageGrowth({
    postgresTotalGb: 2, postgresDailyGrowthMb: null, canonicalStateMb: 100,
    observationsMb: 100, researchMb: 600, indexesMb: 100, toastMb: 100,
  }, policy);
  assert.equal(critical.watermark, 'CRITICAL');
  assert.equal(critical.researchWriteDisposition, 'PAUSE_NONESSENTIAL');
  assert.equal(critical.growthState, 'UNKNOWN');
});

test('a breached daily growth budget pauses nonessential research before capacity is exhausted', () => {
  const forecast = forecastStorageGrowth({
    postgresTotalGb: 1, postgresDailyGrowthMb: 256, canonicalStateMb: 100,
    observationsMb: 100, researchMb: 100, indexesMb: 100, toastMb: 100,
  }, aivenDeveloper1BootstrapStorageBudget);
  assert.equal(forecast.watermark, 'CRITICAL');
  assert.equal(forecast.maximumUtilizationRatio, 2);
  assert.equal(forecast.researchWriteDisposition, 'PAUSE_NONESSENTIAL');
  assert.equal(forecast.operationalTruthWritesAllowed, true);
  assert.equal(forecast.growthState, 'MEASURED_POSITIVE');
  assert.ok(forecast.projectedDaysToHigh !== null && forecast.projectedDaysToHigh > 0);
});
