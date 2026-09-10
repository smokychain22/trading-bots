import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOwnershipEvaluationResponse } from '../src/theta/ownership-contract.js';

const component = (name: string, value: number | null) => ({
  name, value, status: 'TEST' as const, reasons: [],
});

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-ownership-runtime-v1',
  snapshotId: 'snapshot-1',
  underlyingSymbol: 'AAPL',
  timestamp: new Date().toISOString(),
  policyVersion: 'v1',
  ownability: 0.72,
  components: [
    component('LiquidityQuality', 1.0),
    component('StructuralQuality', 0.8),
    component('RecoveryQuality', 0.7),
    component('TailQuality', 0.6),
    component('EventAdjustment', 1.0),
  ],
  thesisInvalidated: false,
  reasons: [],
  ...overrides,
});

test('a fully known component set yields a computable ownability', () => {
  const response = parseOwnershipEvaluationResponse(basePayload());
  assert.ok(response.ownability !== null);
});

test('any UNKNOWN component forces ownability to UNKNOWN, never a fabricated number', () => {
  const payload = basePayload({
    components: [
      component('LiquidityQuality', null),
      component('StructuralQuality', 0.8),
      component('RecoveryQuality', 0.7),
      component('TailQuality', 0.6),
      component('EventAdjustment', 1.0),
    ],
    ownability: 0.5, // wrong -- should be null
  });
  assert.throws(() => parseOwnershipEvaluationResponse(payload));
});

test('ownability=null with all components known is also rejected -- it must be computed when possible', () => {
  const payload = basePayload({ ownability: null });
  assert.throws(() => parseOwnershipEvaluationResponse(payload));
});

test('exactly five components are required -- the ownership formula is never partially reported', () => {
  const payload = basePayload({ components: [component('LiquidityQuality', 1.0)] });
  assert.throws(() => parseOwnershipEvaluationResponse(payload));
});
