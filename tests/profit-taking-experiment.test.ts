import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfitTakingComparisonRow, allProfitTakingPolicies, canonicalV7ProfitTakingPolicies,
  observeFixedProfitTarget, v7ProfitTakingPolicyDefinitions,
  type ProfitTakingDecisionState, type ProfitTakingPolicy } from '../src/research/profit-taking-experiment.js';

const DECISION_AT = '2026-09-22T14:00:00Z';

function state(overrides: Partial<ProfitTakingDecisionState> = {}): ProfitTakingDecisionState {
  return {
    episodeId: 'ep-1', chainId: 'chain-1', decisionId: 'dec-1', decisionAt: DECISION_AT,
    openCredit: 150, closeDebit: 60, remainingExecutablePremium: 60,
    dte: 12, signedDelta: -0.15, absoluteDelta: 0.15,
    atmIv: 0.25, rv20: 0.2, vrp20: 0.05,
    eventEvidenceState: 'CLEAR', executionEvidenceState: 'EXECUTABLE', assignmentBurden: null,
    capitalDaysConsumed: 1300,
    rollAlternativeAvailable: true, redeploymentAlternativeAvailable: false,
    portfolioConstraints: [], uncertaintyState: 'KNOWN',
    ...overrides,
  };
}

function baseRow(overrides: Partial<Parameters<typeof buildProfitTakingComparisonRow>[0]> = {}) {
  return {
    state: state(), actualPolicy: 'FIXED_50' as ProfitTakingPolicy, challengerPolicy: 'DTE_EXIT' as ProfitTakingPolicy,
    actualAction: 'CLOSE' as const, challengerAction: 'HOLD' as const, actualOutcomeRef: 'outcome-1',
    counterfactualOutcomeState: 'NOT_IDENTIFIABLE' as const,
    incrementalWholeChainNetPnl: null, incrementalCapitalDays: null, incrementalDownside: null, incrementalExecutionCost: null,
    labelAvailableAt: null, ...overrides,
  };
}

test('accepts a real, well-formed comparison row', () => {
  const row = buildProfitTakingComparisonRow(baseRow());
  assert.equal(row.contractVersion, 'theta-profit-taking-experiment-v2');
});

test('CORE CLAIM: no policy can claim KNOWN counterfactual without evidence -- NOT_IDENTIFIABLE + a real value is rejected', () => {
  assert.throws(() => buildProfitTakingComparisonRow(baseRow({
    counterfactualOutcomeState: 'NOT_IDENTIFIABLE', incrementalWholeChainNetPnl: 50,
  })), /PROFIT_TAKING_CLAIMED_VALUE_DESPITE_NOT_IDENTIFIABLE/);
});

test('CORE CLAIM: FIXED_50 has no privileged status -- identical validation applies to every policy', () => {
  for (const policy of allProfitTakingPolicies) {
    assert.throws(() => buildProfitTakingComparisonRow(baseRow({
      actualPolicy: policy, counterfactualOutcomeState: 'NOT_IDENTIFIABLE', incrementalCapitalDays: 5,
    })), /PROFIT_TAKING_CLAIMED_VALUE_DESPITE_NOT_IDENTIFIABLE/, `policy ${policy} should be rejected identically`);
  }
});

test('close debit and remaining executable premium are distinct fields, never conflated', () => {
  const row = buildProfitTakingComparisonRow(baseRow({ state: state({ closeDebit: 60, remainingExecutablePremium: 65 }) }));
  assert.equal(row.state.closeDebit, 60);
  assert.equal(row.state.remainingExecutablePremium, 65);
  assert.notEqual(row.state.closeDebit, row.state.remainingExecutablePremium);
});

test('capitalDaysConsumed is a real, present field on every decision state', () => {
  const row = buildProfitTakingComparisonRow(baseRow());
  assert.equal(row.state.capitalDaysConsumed, 1300);
});

test('ADVERSARIAL: a future labelAvailableAt before decisionAt is rejected', () => {
  assert.throws(() => buildProfitTakingComparisonRow(baseRow({ labelAvailableAt: '2026-09-22T10:00:00Z' })), /PROFIT_TAKING_LABEL_BEFORE_DECISION/);
});

test('ADVERSARIAL: an incremental PnL claim without a real actualOutcomeRef is rejected -- no leakage from an unobserved actual', () => {
  assert.throws(() => buildProfitTakingComparisonRow(baseRow({
    counterfactualOutcomeState: 'OBSERVED_PARALLEL', incrementalWholeChainNetPnl: 30,
    actualOutcomeRef: null, labelAvailableAt: DECISION_AT,
  })), /PROFIT_TAKING_INCREMENTAL_PNL_WITHOUT_ACTUAL_OUTCOME_REF/);
});

test('OBSERVED_PARALLEL with a real actualOutcomeRef accepts real incremental values', () => {
  const row = buildProfitTakingComparisonRow(baseRow({
    counterfactualOutcomeState: 'OBSERVED_PARALLEL', incrementalWholeChainNetPnl: 30,
    incrementalCapitalDays: 2, incrementalDownside: -10, incrementalExecutionCost: 1.5,
    labelAvailableAt: DECISION_AT,
  }));
  assert.equal(row.incrementalWholeChainNetPnl, 30);
});

test('no single-leg PnL field exists -- economics are represented via the whole-chain incremental field only', () => {
  const row = buildProfitTakingComparisonRow(baseRow());
  assert.ok(!('optionLegPnl' in row));
  assert.ok(!('singleLegNetPnl' in row));
});

test('the canonical V7 grid contains every fixed and dynamic challenger exactly once', () => {
  assert.deepEqual(canonicalV7ProfitTakingPolicies, [
    'FIXED_05', 'FIXED_10', 'FIXED_15', 'FIXED_20', 'FIXED_25', 'FIXED_30',
    'FIXED_40', 'FIXED_50', 'FIXED_60', 'FIXED_75', 'FIXED_90',
    'TIME_EXIT', 'DTE_EXIT', 'DYNAMIC_REMAINING_EV', 'DYNAMIC_EV_PLUS_HARD_RISK',
    'DYNAMIC_EV_PLUS_EVENT', 'DYNAMIC_EV_PLUS_CAPITAL_EFFICIENCY',
  ]);
  assert.equal(new Set(canonicalV7ProfitTakingPolicies).size, 17);
  assert.equal(v7ProfitTakingPolicyDefinitions.every((item) => item.researchOnly && !item.brokerAuthority), true);
  assert.equal(allProfitTakingPolicies.length, 22);
});

test('fixed targets are observable benchmarks and never broker authority', () => {
  const below = observeFixedProfitTarget({ policy: 'FIXED_50', openCredit: 100, executableCloseDebit: 60 });
  const above = observeFixedProfitTarget({ policy: 'FIXED_50', openCredit: 100, executableCloseDebit: 49 });
  assert.equal(below.capturedFraction, 0.4);
  assert.equal(below.benchmarkAction, 'HOLD');
  assert.equal(above.benchmarkAction, 'CLOSE');
  assert.equal(above.researchOnly, true);
  assert.equal(above.brokerAuthority, false);
});

test('fixed target observation rejects invalid credits instead of coercing them to zero', () => {
  assert.throws(() => observeFixedProfitTarget({ policy: 'FIXED_25', openCredit: 0, executableCloseDebit: 0 }),
    /FIXED_TARGET_OPEN_CREDIT_INVALID/);
});
