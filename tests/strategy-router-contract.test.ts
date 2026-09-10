import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleFamilies, parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';

const ALL_FAMILIES = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const;

const result = (family: string, eligible: boolean, state: string) => ({
  strategyFamily: family, eligible, eligibilityState: state, reasons: [], policyVersion: 'v1',
});

const basePayload = () => ({
  contractVersion: 'theta-strategy-router-runtime-v1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  results: [
    result('THETA_Q', true, 'ELIGIBLE_PRIMARY'),
    result('THETA_H', false, 'INELIGIBLE_STATE'),
    result('THETA_R', false, 'INELIGIBLE_STATE'),
    result('THETA_A', false, 'INELIGIBLE_STATE'),
    result('THETA_C', false, 'INELIGIBLE_STRUCTURE'),
    result('THETA_D', false, 'INELIGIBLE_STATE'),
  ],
});

test('a complete six-family routing response parses cleanly', () => {
  const response = parseStrategyRoutingResponse(basePayload());
  assert.equal(response.results.length, 6);
});

test('every strategy family must appear exactly once -- a missing family is rejected', () => {
  const payload = basePayload();
  payload.results = payload.results.slice(0, 5); // drop THETA_D
  assert.throws(() => parseStrategyRoutingResponse(payload));
});

test('a duplicated family is rejected -- routing is never a partial vote', () => {
  const payload = basePayload();
  payload.results[5] = result('THETA_Q', false, 'INELIGIBLE_STATE'); // duplicate THETA_Q, drops THETA_D
  assert.throws(() => parseStrategyRoutingResponse(payload));
});

test('eligible must agree with eligibilityState -- an ELIGIBLE_* state marked ineligible is rejected', () => {
  const payload = basePayload();
  payload.results[0] = result('THETA_Q', false, 'ELIGIBLE_PRIMARY');
  assert.throws(() => parseStrategyRoutingResponse(payload));
});

test('eligibleFamilies returns only the eligible ones, one family ineligible does not hide others', () => {
  const response = parseStrategyRoutingResponse(basePayload());
  assert.deepEqual(eligibleFamilies(response), ['THETA_Q']);
});

test('all six families named exhaustively', () => {
  const payload = basePayload();
  const families = payload.results.map((r) => r.strategyFamily);
  assert.deepEqual([...families].sort(), [...ALL_FAMILIES].sort());
});
