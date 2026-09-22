import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capabilityRegistry, validateCapabilityRegistry, capabilitiesByMaturity, capabilitiesByBlocker,
} from '../src/research/pre-vps-capability-registry.js';

test('the registry has no duplicate capabilityId values', () => {
  const result = validateCapabilityRegistry(capabilityRegistry);
  assert.deepEqual(result.duplicateCapabilityIds, []);
});

test('every registry entry has every required string field populated and at least one source file', () => {
  const result = validateCapabilityRegistry(capabilityRegistry);
  assert.deepEqual(result.incompleteCapabilityIds, []);
  assert.equal(result.valid, true);
});

test('validateCapabilityRegistry detects an injected duplicate capabilityId', () => {
  const first = capabilityRegistry[0] as (typeof capabilityRegistry)[number];
  const withDuplicate = [...capabilityRegistry, { ...first }];
  const result = validateCapabilityRegistry(withDuplicate);
  assert.ok(result.duplicateCapabilityIds.includes(first.capabilityId));
  assert.equal(result.valid, false);
});

test('validateCapabilityRegistry detects an incomplete entry (missing required field)', () => {
  const first = capabilityRegistry[0] as (typeof capabilityRegistry)[number];
  const withIncomplete = [...capabilityRegistry, { ...first, capabilityId: 'TEST_INCOMPLETE', purpose: '' }];
  const result = validateCapabilityRegistry(withIncomplete);
  assert.ok(result.incompleteCapabilityIds.includes('TEST_INCOMPLETE'));
});

test('capabilitiesByMaturity filters correctly and QUARANTINED capabilities are never silently miscounted as PRODUCTION_REQUIRED', () => {
  const quarantined = capabilitiesByMaturity(capabilityRegistry, 'QUARANTINED');
  assert.ok(quarantined.length >= 1);
  assert.ok(quarantined.every((c) => c.maturity === 'QUARANTINED'));
  const productionRequired = capabilitiesByMaturity(capabilityRegistry, 'PRODUCTION_REQUIRED');
  assert.ok(productionRequired.every((c) => c.maturity === 'PRODUCTION_REQUIRED'));
});

test('capabilitiesByBlocker surfaces every entry with a real, non-null blocker -- confirms the known P0 roll/CC gap is represented', () => {
  const blocked = capabilitiesByBlocker(capabilityRegistry);
  const rollCcSource = blocked.find((c) => c.capabilityId === 'ROLL_CC_CANDIDATE_SOURCE');
  assert.ok(rollCcSource !== undefined);
  assert.ok(rollCcSource?.blocker !== null);
});

test('the quarantined management architecture is represented with runtimeReachable=false and currentState=QUARANTINED_NO_CALLERS', () => {
  const entry = capabilityRegistry.find((c) => c.capabilityId === 'QUARANTINED_MANAGEMENT_ARCHITECTURE');
  assert.ok(entry !== undefined);
  assert.equal(entry?.runtimeReachable, false);
  assert.equal(entry?.currentState, 'QUARANTINED_NO_CALLERS');
});
