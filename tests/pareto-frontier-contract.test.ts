import assert from 'node:assert/strict';
import test from 'node:test';
import { parseParetoFrontierResponse, survivingCandidateIds } from '../src/theta/pareto-frontier-contract.js';

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-pareto-frontier-runtime-v1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  results: [
    { candidateId: 'a', survivesFrontier: true, dominatedBy: [] },
    { candidateId: 'b', survivesFrontier: false, dominatedBy: ['a'] },
  ],
  ...overrides,
});

test('a surviving candidate cannot also carry a dominator', () => {
  assert.throws(() => parseParetoFrontierResponse(basePayload({
    results: [{ candidateId: 'a', survivesFrontier: true, dominatedBy: ['b'] }],
  })));
});

test('an eliminated candidate must name at least one dominator', () => {
  assert.throws(() => parseParetoFrontierResponse(basePayload({
    results: [{ candidateId: 'a', survivesFrontier: false, dominatedBy: [] }],
  })));
});

test('duplicate candidateIds are rejected', () => {
  assert.throws(() => parseParetoFrontierResponse(basePayload({
    results: [
      { candidateId: 'dup', survivesFrontier: true, dominatedBy: [] },
      { candidateId: 'dup', survivesFrontier: true, dominatedBy: [] },
    ],
  })));
});

test('survivingCandidateIds extracts only the non-dominated set', () => {
  const response = parseParetoFrontierResponse(basePayload());
  assert.deepEqual(survivingCandidateIds(response), ['a']);
});
