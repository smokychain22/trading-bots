// The derived retention matrix document is pinned to the dataset registry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { retentionMatrix } from '../tools/theta-data-platform-matrix.js';

test('the stored retention matrix equals what the dataset registry generates, and the registry has no problems', () => {
  const stored = JSON.parse(readFileSync(new URL('../docs/operations/THETA_DATA_PLATFORM_RETENTION_MATRIX_20261003.json', import.meta.url), 'utf8'));
  assert.deepEqual(stored, JSON.parse(JSON.stringify(retentionMatrix())));
  assert.deepEqual(stored.registryProblems, []);
  for (const dataset of stored.datasets) for (const field of ['HOT_WINDOW', 'WARM_WINDOW', 'COLD_POLICY', 'WHY_HOT', 'WHY_WARM', 'ARCHIVED_WHEN', 'REMOVED_FROM_POSTGRES_WHEN', 'RESTORED_HOW']) assert.ok(String(dataset[field]).length > 2, `${dataset.id}.${field}`);
  assert.ok(stored.datasets.length >= 14);
});
