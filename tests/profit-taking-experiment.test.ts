import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfitTakingComparisonRow, allProfitTakingPolicies, type ProfitTakingDecisionState, type ProfitTakingPolicy } from '../src/research/profit-taking-experiment.js';

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
    state: state(), actualPolicy: 'TAKE_50' as ProfitTakingPolicy, challengerPolicy: 'DTE_EXIT' as ProfitTakingPolicy,
    actualAction: 'CLOSE' as const, challengerAction: 'HOLD' as const, actualOutcomeRef: 'outcome-1',
    counterfactualOutcomeState: 'NOT_IDENTIFIABLE' as const,
    incrementalWholeChainNetPnl: null, incrementalCapitalDays: null, incrementalDownside: null, incrementalExecutionCost: null,
    labelAvailableAt: null, ...overrides,
  };
}

test('accepts a real, well-formed comparison row', () => {
  const row = buildProfitTakingComparisonRow(baseRow());
  assert.equal(row.contractVersion, 'theta-profit-taking-experiment-v1');
});

test('CORE CLAIM: no policy can claim KNOWN counterfactual without evidence -- NOT_IDENTIFIABLE + a real value is rejected', () => {
  assert.throws(() => buildProfitTakingComparisonRow(baseRow({
    counterfactualOutcomeState: 'NOT_IDENTIFIABLE', incrementalWholeChainNetPnl: 50,
  })), /PROFIT_TAKING_CLAIMED_VALUE_DESPITE_NOT_IDENTIFIABLE/);
});

test('CORE CLAIM: TAKE_50 has no privileged status -- identical validation applies to all 6 policies', () => {
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

test('all 6 real policies are represented in allProfitTakingPolicies, no more no fewer', () => {
  assert.deepEqual([...allProfitTakingPolicies].toSorted(), ['CONTINUATION_VALUE', 'DTE_EXIT', 'RESIDUAL_PREMIUM_EXIT', 'TAKE_25', 'TAKE_50', 'TAKE_75']);
});
