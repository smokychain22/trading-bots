import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeFalseInactivityRates, falseInactivityToBlockerClass, type FalseInactivityRecord,
} from '../src/research/false-inactivity-taxonomy.js';

test('CORE CLAIM: rates are reported separately, never combined into one inactivity number', () => {
  const records: FalseInactivityRecord[] = [
    { candidateId: 'c1', cause: 'GOOD_WAIT' }, { candidateId: 'c2', cause: 'IMPLEMENTATION_FALSE_REJECT' },
  ];
  const rates = computeFalseInactivityRates(records);
  assert.equal(rates.goodWaitRate, 0.5);
  assert.equal(rates.implementationFalseRejectRate, 0.5);
  // The result type itself has no combined field -- this is a structural
  // guarantee, verified by checking no single "inactivityRate" key exists.
  assert.ok(!('inactivityRate' in rates));
});

test('GOOD_WAIT and HARD_SAFETY_REJECT map to no blocker class -- correct behavior, not a defect', () => {
  assert.equal(falseInactivityToBlockerClass.GOOD_WAIT, null);
  assert.equal(falseInactivityToBlockerClass.HARD_SAFETY_REJECT, null);
  assert.equal(falseInactivityToBlockerClass.EXECUTION_QUALITY_REJECT, null);
});

test('IMPLEMENTATION_FALSE_REJECT maps to Codex\'s real IMPLEMENTATION blocker class', () => {
  assert.equal(falseInactivityToBlockerClass.IMPLEMENTATION_FALSE_REJECT, 'IMPLEMENTATION');
});

test('PROVIDER_FAILURE_REJECT and DATA_STALE_REJECT both map to PROVIDER', () => {
  assert.equal(falseInactivityToBlockerClass.PROVIDER_FAILURE_REJECT, 'PROVIDER');
  assert.equal(falseInactivityToBlockerClass.DATA_STALE_REJECT, 'PROVIDER');
});

test('CORE CLAIM (corrected, Phase 2): empty record set produces null rates -- never a fabricated 0, never NaN', () => {
  const rates = computeFalseInactivityRates([]);
  assert.equal(rates.totalRecords, 0);
  assert.equal(rates.goodWaitRate, null);
  assert.equal(rates.implementationFalseRejectRate, null);
  assert.equal(Number.isNaN(rates.goodWaitRate as unknown as number), false);
});

test('PIPELINE_NOT_EVALUATED is real, distinct from a reject, and not counted in any reject rate', () => {
  const records: FalseInactivityRecord[] = [
    { candidateId: 'c1', cause: 'PIPELINE_NOT_EVALUATED' }, { candidateId: 'c2', cause: 'PIPELINE_NOT_EVALUATED' },
  ];
  const rates = computeFalseInactivityRates(records);
  assert.equal(rates.implementationFalseRejectRate, 0);
  assert.equal(rates.safetyRejectRate, 0);
  assert.equal(rates.providerFailureRejectRate, 0);
});
