import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPurgeEmbargoReport } from '../src/research/purge-embargo-contract.js';

const WINDOW = {
  trainEnd: '2026-06-01T00:00:00Z', embargoEnd: '2026-06-15T00:00:00Z',
  validationStart: '2026-06-15T00:00:00Z', validationEnd: '2026-07-01T00:00:00Z',
};

test('a short-label row fully before trainEnd is TRAIN_ELIGIBLE', () => {
  const report = buildPurgeEmbargoReport([
    { rowId: 'r1', decisionAt: '2026-05-01T00:00:00Z', labelWindowEnd: '2026-05-02T00:00:00Z', labelAvailableAt: '2026-05-02T00:00:00Z' },
  ], WINDOW);
  assert.deepEqual(report.trainRowIds, ['r1']);
});

test('CORE CLAIM: a long-duration label whose window END overlaps the embargo is purged even though its decision was well before trainEnd', () => {
  const report = buildPurgeEmbargoReport([
    { rowId: 'r2', decisionAt: '2026-05-01T00:00:00Z', labelWindowEnd: '2026-06-10T00:00:00Z', labelAvailableAt: '2026-06-10T00:00:00Z' },
  ], WINDOW);
  assert.deepEqual(report.purgedRowIds, ['r2']);
});

test('a row inside the validation window is VALIDATION_ELIGIBLE once its label is available', () => {
  const report = buildPurgeEmbargoReport([
    { rowId: 'r3', decisionAt: '2026-06-20T00:00:00Z', labelWindowEnd: '2026-06-25T00:00:00Z', labelAvailableAt: '2026-06-25T00:00:00Z' },
  ], WINDOW);
  assert.deepEqual(report.validationRowIds, ['r3']);
});

test('a row after the validation window is EXCLUDED_FUTURE', () => {
  const report = buildPurgeEmbargoReport([
    { rowId: 'r4', decisionAt: '2026-08-01T00:00:00Z', labelWindowEnd: '2026-08-02T00:00:00Z', labelAvailableAt: '2026-08-02T00:00:00Z' },
  ], WINDOW);
  assert.deepEqual(report.excludedFutureRowIds, ['r4']);
});

test('ADVERSARIAL: an invalid window (embargoEnd before trainEnd) is rejected', () => {
  assert.throws(() => buildPurgeEmbargoReport([], { ...WINDOW, embargoEnd: '2026-05-01T00:00:00Z' }), /PURGE_EMBARGO_INVALID_WINDOW_ORDER/);
});
