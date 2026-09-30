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

test('a bridge response must cover the exact requested snapshot, time and candidate set', () => {
  const payload=basePayload({timestamp:'2026-09-30T14:00:00.000Z'});
  const expected={snapshotId:'snapshot-1',timestamp:'2026-09-30T14:00:00.000Z',candidateIds:['a','b']};
  assert.deepEqual(survivingCandidateIds(parseParetoFrontierResponse(payload,expected)),['a']);
  assert.throws(()=>parseParetoFrontierResponse(basePayload({...payload,
    results:[{candidateId:'a',survivesFrontier:true,dominatedBy:[]}]}),expected),
  /PARETO_RESPONSE_CANDIDATE_SET_MISMATCH/);
  assert.throws(()=>parseParetoFrontierResponse(basePayload({...payload,snapshotId:'other'}),expected),
    /PARETO_RESPONSE_IDENTITY_MISMATCH/);
  assert.throws(()=>parseParetoFrontierResponse(basePayload({...payload,
    results:[{candidateId:'a',survivesFrontier:true,dominatedBy:[]},
      {candidateId:'b',survivesFrontier:false,dominatedBy:['unknown']}]}),expected),
  /PARETO_RESPONSE_DOMINATOR_INVALID/);
});
