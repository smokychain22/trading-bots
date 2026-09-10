import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSizingResultResponse } from '../src/theta/sizing-contract.js';

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-sizing-runtime-v1',
  decisionId: 'decision-1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  quantity: 3,
  capitalRequired: 15000,
  bindingConstraint: 'RISK_BUDGET',
  reasons: [],
  ...overrides,
});

test('quantity zero is a valid, parseable outcome', () => {
  const response = parseSizingResultResponse(basePayload({ quantity: 0, capitalRequired: 0, bindingConstraint: 'AEGIS' }));
  assert.equal(response.quantity, 0);
});

test('quantity zero must not carry a nonzero capital requirement', () => {
  const payload = basePayload({ quantity: 0, capitalRequired: 5000 });
  assert.throws(() => parseSizingResultResponse(payload));
});

test('quantity must be a non-negative integer -- never negative, never fractional', () => {
  assert.throws(() => parseSizingResultResponse(basePayload({ quantity: -1 })));
  assert.throws(() => parseSizingResultResponse(basePayload({ quantity: 1.5 })));
});
