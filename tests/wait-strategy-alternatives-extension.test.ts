import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpportunityCostState, buildWaitStrategyAlternativesRow, waitComparisonIsResolvable,
} from '../src/research/wait-strategy-alternatives-extension.js';

test('CORE CLAIM: an UNKNOWN opportunity cost makes the WAIT comparison unresolvable, never silently favorable', () => {
  const state = buildOpportunityCostState('UNKNOWN', null);
  assert.equal(waitComparisonIsResolvable(state), false);
});

test('a real benchmark-cash-yield basis is resolvable', () => {
  const state = buildOpportunityCostState('CREDIBLE_BENCHMARK_CASH_YIELD', 0.04);
  assert.equal(waitComparisonIsResolvable(state), true);
});

test('ADVERSARIAL: UNKNOWN basis with a non-null value is rejected', () => {
  assert.throws(() => buildOpportunityCostState('UNKNOWN', 5), /OPPORTUNITY_COST_UNKNOWN_MUST_BE_NULL/);
});

test('ADVERSARIAL: a non-UNKNOWN basis without a value is rejected', () => {
  assert.throws(() => buildOpportunityCostState('ZERO_AS_EXPERIMENTAL_CONTROL', null), /OPPORTUNITY_COST_NON_UNKNOWN_REQUIRES_VALUE/);
});

test('the full strategy-alternative set at a WAIT decision is preserved', () => {
  const row = buildWaitStrategyAlternativesRow({
    waitDecisionId: 'w1',
    strategyAlternatives: [
      { strategyFamily: 'THETA_CONVENTIONAL', eligible: true, identifiabilityStatus: 'NOT_IDENTIFIABLE' },
      { strategyFamily: 'THETA_DEFINED_RISK', eligible: false, identifiabilityStatus: 'NOT_IDENTIFIABLE' },
    ],
    opportunityCost: buildOpportunityCostState('ZERO_AS_EXPERIMENTAL_CONTROL', 0),
  });
  assert.equal(row.strategyAlternatives.length, 2);
});
