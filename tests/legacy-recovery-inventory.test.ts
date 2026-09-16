import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLegacyRecovery } from '../src/database/legacy-recovery-inventory.js';

test('legacy recovery never labels an empty reconstructed table as migrated', () => {
  assert.equal(classifyLegacyRecovery('trade.decision', 0, 0), 'TEMPORARILY_NEON_BLOCKED');
  assert.equal(classifyLegacyRecovery('core.schema_migration', 50, 0), 'RECONSTRUCTED_SCHEMA_ONLY');
});

test('legacy recovery separates staged evidence, current reconstruction, and confirmed empty orders', () => {
  assert.equal(classifyLegacyRecovery('trade.candidate_set', 0, 302), 'PARTIALLY_RECOVERED');
  assert.equal(classifyLegacyRecovery('trade.broker_activity_fact', 9, 0), 'RECONSTRUCTED_CURRENT_STATE');
  assert.equal(classifyLegacyRecovery('trade.order_intent', 0, 0), 'EMPTY_BY_DESIGN');
});
