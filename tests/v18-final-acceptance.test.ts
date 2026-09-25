import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { buildV18FinalAcceptanceReceipt, decisionDataEvidenceFiles, decisionDataRoutes, fiveStrategyEngineeringMatrix,
  softFeatureUsageRegistry, strategyEngineeringDimensions, unresolvedSystemState } from '../src/operations/v18-final-acceptance.js';
import { thetaFeatureFamily } from '../src/theta/strategy-package.js';

test('V18 configuration denominator is complete and conflict free', () => {
  const receipt = buildV18FinalAcceptanceReceipt();
  assert.equal(receipt.CONFIG_FIELDS_TOTAL, 29);
  assert.equal(receipt.CONFIG_FIELDS_CANONICAL, 29);
  assert.deepEqual(receipt.UNREGISTERED_DECISION_CRITICAL_CONFIG, []);
  assert.deepEqual(receipt.DUPLICATE_CONFIG_AUTHORITIES, []);
  assert.deepEqual(receipt.CONFLICTING_CONFIG_VALUES, []);
});

test('every decision data family has provenance, a consumer, a role, and explicit authority', () => {
  assert.equal(decisionDataRoutes.length, 21);
  assert.equal(new Set(decisionDataRoutes.map((item) => item.feature)).size, decisionDataRoutes.length);
  assert.deepEqual(Object.keys(decisionDataEvidenceFiles).toSorted(), decisionDataRoutes.map((item) => item.feature).toSorted());
  for (const item of decisionDataRoutes) {
    assert.ok(item.source && item.producer && item.normalizer && item.consumer);
    assert.ok(item.decisionRole && item.authority && item.executionUse);
    const files = decisionDataEvidenceFiles[item.feature];
    assert.ok(files !== undefined);
    assert.ok(files.producer.length > 0 && files.normalizer.length > 0 && files.consumer.length > 0);
    assert.deepEqual([...files.producer, ...files.normalizer, ...files.consumer].filter((file) => !existsSync(file)), []);
  }
  const receipt = buildV18FinalAcceptanceReceipt();
  assert.deepEqual(receipt.DECLARED_BUT_UNUSED_DECISION_DATA, []);
  assert.deepEqual(receipt.DATA_WITHOUT_PROVENANCE, []);
  assert.deepEqual(receipt.DATA_WITHOUT_CONSUMER, []);
  assert.deepEqual(softFeatureUsageRegistry.map((item) => item.family).toSorted(), [...thetaFeatureFamily.options].toSorted());
  assert.equal(softFeatureUsageRegistry.length, 20);
});

test('all five strategy systems have an explicit non-missing state for every dimension', () => {
  assert.deepEqual(Object.keys(fiveStrategyEngineeringMatrix), ['Q', 'H', 'D', 'A', 'C']);
  for (const item of Object.values(fiveStrategyEngineeringMatrix)) {
    assert.deepEqual(Object.keys(item), [...strategyEngineeringDimensions]);
    assert.equal(Object.values(item).includes('MISSING'), false);
  }
});

test('structural comparison stays separate from empirical profitability', () => {
  const receipt = buildV18FinalAcceptanceReceipt();
  assert.equal(receipt.CROSS_STRATEGY_STRUCTURAL_COMPARISON, 'REAL');
  assert.equal(receipt.CROSS_STRATEGY_EMPIRICAL_COMPARISON, 'NOT_READY');
  assert.equal(receipt.CROSS_STRATEGY_PROFITABILITY_WINNER, 'EMPIRICALLY_UNPROVEN');
  assert.equal(receipt.deterministicAccountAlternatives.WAIT.alternative, 'REAL');
});

test('V18 self-certification is retired in favor of executed V19 evidence', () => {
  assert.deepEqual(unresolvedSystemState.CODE_SOLVABLE, ['V18_SELF_CERTIFICATION_SUPERSEDED_BY_V19']);
  const receipt = buildV18FinalAcceptanceReceipt();
  assert.equal(receipt.GENERIC_ENGINEERING_UNKNOWN, 0);
  assert.equal(receipt.GENERIC_DECISION_UNKNOWN, 0);
  assert.equal(receipt.GENERIC_WAIT, 0);
  assert.equal(receipt.PRESESSION_ZERO_WEAKNESS_CERTIFICATION, 'FAIL');
  assert.equal(receipt.AEGIS_COMPLETE, 'NOT_CERTIFIED_USE_V19');
  assert.equal(receipt.ORDER_SUBMISSIONS, 0);
  assert.equal(receipt.BROKER_MUTATIONS, 0);
});
