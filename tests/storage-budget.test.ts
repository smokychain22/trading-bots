import assert from 'node:assert/strict';
import test from 'node:test';
import { aivenDeveloper1BootstrapStorageBudget, assessStorageBudget } from '../src/storage/storage-budget.js';

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
