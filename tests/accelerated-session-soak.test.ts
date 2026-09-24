import assert from 'node:assert/strict';
import test from 'node:test';
import { runAcceleratedSessionSoak } from '../src/operations/accelerated-session-soak.js';

test('accelerated full-session soak contains faults without generic unknowns or mutation authority', () => {
  const receipt = runAcceleratedSessionSoak();
  assert.equal(receipt.state, 'PASS');
  assert.equal(receipt.cycleCount, 391);
  assert.equal(receipt.completed, 391);
  assert.equal(receipt.failed, 0);
  assert.equal(receipt.timedOut, 0);
  assert.equal(receipt.unhandledExceptions, 0);
  assert.equal(receipt.unboundedCycles, 0);
  assert.equal(receipt.genericEngineeringUnknown, 0);
  assert.equal(receipt.faultCounts.AIVEN_57P03, 2);
  assert.equal(receipt.faultCounts.OPTIONOMICS_OUTAGE, 2);
  assert.equal(receipt.typedTransitions.SPOOL_MODE_RECOVERABLE, 2);
  assert.equal(receipt.typedTransitions.OPTIONAL_RESEARCH_UNAVAILABLE_CORE_CONTINUES, 2);
  assert.equal(receipt.orderSubmissions, 0);
  assert.equal(receipt.brokerMutations, 0);
});
