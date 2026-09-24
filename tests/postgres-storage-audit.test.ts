import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryBytes, measuredAppendRates, normalizeRelationStat } from '../src/storage/postgres-storage-audit.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  schema_name: 'research', relation_name: 'history', table_data_bytes: '100', index_bytes: '50', toast_bytes: '25',
  total_relation_bytes: '175', row_count_estimate: '10', live_tuple_estimate: '9', dead_tuple_estimate: '1',
  inserted_since_stats_reset: '20', updated_since_stats_reset: '3', deleted_since_stats_reset: '1',
  last_vacuum: null, last_autovacuum: null, last_analyze: null, last_autoanalyze: null, ...overrides,
});

test('normalizes exact size counters and labels planner and bloat indicators honestly', () => {
  const normalized = normalizeRelationStat(row());
  assert.equal(normalized.classification, 'RESEARCH_HISTORY');
  assert.equal(normalized.deadTupleRatio, 0.1);
  assert.equal(normalized.indexToTableRatio, 0.5);
  assert.equal(categoryBytes([normalized]).RESEARCH_HISTORY, 175);
});

test('measured append rates require monotonic counters and a nontrivial local interval', () => {
  const current = normalizeRelationStat(row({ inserted_since_stats_reset: '30' }));
  assert.deepEqual(measuredAppendRates([current], '2026-09-25T02:00:00.000Z', [{
    qualifiedName: 'research.history', insertedSinceStatsReset: 20,
  }], '2026-09-25T00:00:00.000Z'), { 'research.history': 5 });
  assert.equal(measuredAppendRates([current], '2026-09-25T02:00:00.000Z', null, null), null);
  assert.equal(measuredAppendRates([current], '2026-09-25T00:04:00.000Z', [{
    qualifiedName: 'research.history', insertedSinceStatsReset: 20,
  }], '2026-09-25T00:00:00.000Z'), null);
});
