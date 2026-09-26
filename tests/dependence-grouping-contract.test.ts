import assert from 'node:assert/strict';
import test from 'node:test';
import { assignDependenceGroups, buildSampleSizeReceipt } from '../src/research/dependence-grouping-contract.js';

test('CORE CLAIM: every leg of the same whole chain gets the same dependence-group id', () => {
  const assignments = assignDependenceGroups([
    { rowId: 'r1', chainId: 'wc1', underlying: null, exposureWindowStart: null, exposureWindowEnd: null, marketEventClusterId: null },
    { rowId: 'r2', chainId: 'wc1', underlying: null, exposureWindowStart: null, exposureWindowEnd: null, marketEventClusterId: null },
    { rowId: 'r3', chainId: 'wc2', underlying: null, exposureWindowStart: null, exposureWindowEnd: null, marketEventClusterId: null },
  ]);
  const r1 = assignments.find((a) => a.rowId === 'r1') as (typeof assignments)[number];
  const r2 = assignments.find((a) => a.rowId === 'r2') as (typeof assignments)[number];
  const r3 = assignments.find((a) => a.rowId === 'r3') as (typeof assignments)[number];
  assert.equal(r1.groupId, r2.groupId);
  assert.notEqual(r1.groupId, r3.groupId);
});

test('CORE CLAIM: repeated scans (same chain, many rows) do not inflate independentN', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    rowId: `scan${i}`, chainId: 'wc-repeated', underlying: null, exposureWindowStart: null, exposureWindowEnd: null, marketEventClusterId: null,
  }));
  const assignments = assignDependenceGroups(rows);
  const receipt = buildSampleSizeReceipt({ rawObservationCount: 20, episodeIds: rows.map((r) => r.rowId), assignments, effectiveN: null });
  assert.equal(receipt.rawN, 20);
  assert.equal(receipt.independentN, 1);
});

test('effectiveN stays null until a real selection-bias procedure supplies it -- never fabricated', () => {
  const receipt = buildSampleSizeReceipt({ rawObservationCount: 5, episodeIds: ['a', 'b'], assignments: [], effectiveN: null });
  assert.equal(receipt.effectiveN, null);
});
