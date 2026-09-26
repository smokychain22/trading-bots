import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateContractPathStorage } from '../src/research/contract-path-storage-budget.js';

test('measured bounded local observations produce explicit SQLite and Parquet forecasts', () => {
  const receipt = estimateContractPathStorage({
    measuredRowBytes: [900, 1_000, 1_100, 1_200, 2_000],
    subjectsPerSession: 12,
    sessionsPerMonth: 21,
    observationsPerSubject: 8,
    sqliteOverheadMultiplier: 1.5,
    parquetCompressionRatio: 0.25,
  });
  assert.equal(receipt.measuredRowBytesP95, 2_000);
  assert.equal(receipt.subjectsPerSession, 12);
  assert.equal(receipt.observationsPerDay, 96);
  assert.equal(receipt.jobsPerDay, 96);
  assert.equal(receipt.postgresGrowthBytesPerMonth, 0);
  assert.equal(receipt.state, 'PASS');
});

test('missing measurements and subject explosion fail closed', () => {
  assert.throws(() => estimateContractPathStorage({ measuredRowBytes: [], subjectsPerSession: 1,
    sessionsPerMonth: 1, observationsPerSubject: 1, sqliteOverheadMultiplier: 1,
    parquetCompressionRatio: 0.5 }), /CONTRACT_PATH_STORAGE_MEASUREMENT_REQUIRED/);
  const exceeded = estimateContractPathStorage({ measuredRowBytes: [1_000], subjectsPerSession: 13,
    sessionsPerMonth: 21, observationsPerSubject: 8, sqliteOverheadMultiplier: 1,
    parquetCompressionRatio: 0.5 });
  assert.equal(exceeded.subjectBoundWithinPolicy, false);
  assert.equal(exceeded.state, 'BUDGET_EXCEEDED');
});
