import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRegimeSnapshotResponse } from '../src/theta/regime-contract.js';

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-regime-runtime-v1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  trendState: 'BULL',
  volatilityState: 'NORMAL',
  eventState: 'NONE',
  liquidityState: 'NORMAL',
  stressState: 'NORMAL',
  confidence: 1,
  reasons: [],
  ...overrides,
});

test('all five axes resolved yields confidence 1', () => {
  const response = parseRegimeSnapshotResponse(basePayload());
  assert.equal(response.confidence, 1);
});

test('confidence must equal the fraction of resolvable axes, never asserted independently', () => {
  const payload = basePayload({ trendState: null, confidence: 1 }); // wrong -- one axis is null
  assert.throws(() => parseRegimeSnapshotResponse(payload));
});

test('a correctly computed partial-confidence snapshot parses cleanly', () => {
  const response = parseRegimeSnapshotResponse(basePayload({ trendState: null, eventState: null, confidence: 0.6 }));
  assert.equal(response.trendState, null);
  assert.equal(response.confidence, 0.6);
});

test('never collapses the five axes into one field -- each is independently typed', () => {
  const response = parseRegimeSnapshotResponse(basePayload());
  assert.equal(typeof response.trendState, 'string');
  assert.equal(typeof response.volatilityState, 'string');
  assert.equal(typeof response.eventState, 'string');
  assert.equal(typeof response.liquidityState, 'string');
  assert.equal(typeof response.stressState, 'string');
});
