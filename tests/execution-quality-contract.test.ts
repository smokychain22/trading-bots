import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExecutionQualityResponse } from '../src/theta/execution-quality-contract.js';

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-execution-quality-runtime-v2',
  decisionId: 'decision-1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  positionIntent: 'SELL_TO_OPEN',
  spreadPct: 0.02,
  fillProbability: 0.8,
  expectedSlippagePerShare: 0.01,
  acceptable: true,
  recommendedAction: 'SUBMIT',
  reasons: [],
  ...overrides,
});

test('unknown acceptability must never recommend SUBMIT', () => {
  const payload = basePayload({ acceptable: null, recommendedAction: 'SUBMIT' });
  assert.throws(() => parseExecutionQualityResponse(payload));
});

test('acceptable=true must recommend SUBMIT, not SKIP or CANCEL', () => {
  const payload = basePayload({ acceptable: true, recommendedAction: 'CANCEL' });
  assert.throws(() => parseExecutionQualityResponse(payload));
});

test('unknown quote state parses cleanly with all fields null', () => {
  const response = parseExecutionQualityResponse(basePayload({
    spreadPct: null, fillProbability: null, expectedSlippagePerShare: null,
    acceptable: null, recommendedAction: 'UNKNOWN',
  }));
  assert.equal(response.acceptable, null);
});
