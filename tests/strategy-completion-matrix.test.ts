import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMechanicsCompleteNeverImpliesValidated, STRATEGY_COMPLETION_MATRIX } from '../src/research/strategy-completion-matrix.js';

test('the real matrix never claims empirical validation without its prerequisites', () => {
  assert.doesNotThrow(() => assertMechanicsCompleteNeverImpliesValidated(STRATEGY_COMPLETION_MATRIX));
});

test('CORE CLAIM (§55): mechanics-complete never implies profitability-proven -- every row has EMPIRICAL_VALIDATION=NO', () => {
  for (const row of Object.values(STRATEGY_COMPLETION_MATRIX)) {
    assert.equal(row.MECHANICS_IMPLEMENTED, 'YES');
    assert.equal(row.EMPIRICAL_VALIDATION, 'NO');
  }
});

test('BROKER_AUTHORITY is NO for every strategy row, structurally', () => {
  for (const row of Object.values(STRATEGY_COMPLETION_MATRIX)) assert.equal(row.BROKER_AUTHORITY, 'NO');
});

test('the assertion actually detects a violation (adversarial, synthetic matrix)', () => {
  const bad = {
    ...STRATEGY_COMPLETION_MATRIX,
    Q: { ...STRATEGY_COMPLETION_MATRIX.Q, EMPIRICAL_VALIDATION: 'YES' as const, EMPIRICAL_MODEL_READY: 'NO' as const },
  };
  assert.throws(() => assertMechanicsCompleteNeverImpliesValidated(bad), /STRATEGY_COMPLETION_MATRIX_INVALID_VALIDATION_CLAIM/);
});

test('all 7 named rows exist (Q, H, D, A, C, WAIT, MANAGEMENT)', () => {
  assert.deepEqual(Object.keys(STRATEGY_COMPLETION_MATRIX).sort(), ['A', 'C', 'D', 'H', 'MANAGEMENT', 'Q', 'WAIT']);
});
