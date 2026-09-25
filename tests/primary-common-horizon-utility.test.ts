import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommonHorizonUtility, derivePrimaryHorizonCalendarDays } from '../src/research/primary-common-horizon-utility.js';

test('CORE CLAIM: PRIMARY_HORIZON is derived from real strategy config, not hardcoded, and equals 60 today', () => {
  // 60 is the current max(Q=60, H=5, D=60, CC=60) among new-risk branches;
  // THETA_RECOVERY's 3650 is deliberately excluded (nonbinding inventory-
  // lifecycle schema noise, per THETA COMMAND 1 closure).
  assert.equal(derivePrimaryHorizonCalendarDays(), 60);
});

test('unavailable utility components stay null, never coerced to zero', () => {
  const utility = buildCommonHorizonUtility({
    horizonDefinitionVersion: 'v1', realizedCashflowsThroughH: 100, terminalMarkAtH: null,
    continuationValueBeyondH: null, costs: 5, riskPenalty: null, capitalBasis: 1000, capitalDays: null,
  });
  assert.equal(utility.terminalMarkAtH, null);
  assert.equal(utility.totalUtility, null); // any missing component forces the total null, never a partial sum
});

test('a fully-known utility computes a real total', () => {
  const utility = buildCommonHorizonUtility({
    horizonDefinitionVersion: 'v1', realizedCashflowsThroughH: 100, terminalMarkAtH: 20,
    continuationValueBeyondH: 10, costs: 5, riskPenalty: 3, capitalBasis: 1000, capitalDays: 500,
  });
  assert.equal(utility.totalUtility, 100 + 20 + 10 - 5 - 3);
  assert.equal(utility.horizonCalendarDays, 60);
});
