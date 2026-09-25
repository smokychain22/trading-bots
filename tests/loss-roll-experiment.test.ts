import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLossRollComparisonRow, type LossRollComparisonRow, type RollEconomics } from '../src/research/loss-roll-experiment.js';
import { assessLossCauses, type LossCauseEvidence } from '../src/research/loss-cause-integration-contract.js';

const DECISION_AT = '2026-09-22T14:00:00Z';
const HORIZON_END = '2026-10-17T20:00:00Z';

function causeEvidence(overrides: Partial<LossCauseEvidence> = {}): LossCauseEvidence {
  return {
    cause: 'UNDERLYING_DECLINE', evidenceQuality: 'KNOWN', severity: 0.4, persistenceCycles: 2, confidence: 0.8,
    thesisImpact: 'DEGRADES_THESIS', actionInfluence: 'FAVORS_HOLD', hardSafetyOverride: false,
    sourceEvidenceIds: ['ev-1'], detail: 'test', ...overrides,
  };
}

function baseInput(overrides: Partial<Omit<LossRollComparisonRow, 'contractVersion'>> = {}) {
  return {
    episodeId: 'ep-1', chainId: 'chain-1', decisionAt: DECISION_AT, evaluationHorizonEnd: HORIZON_END,
    lossCauseAssessmentRef: assessLossCauses('pos-1', DECISION_AT, -150, [causeEvidence()]),
    feasibleActions: ['HOLD', 'CLOSE'] as const, selectedAction: 'HOLD' as const, rollEconomics: null,
    futureWholeChainNetPnl: null, incrementalCapitalDays: null, expectedShortfall: null, executionCost: null,
    assignmentBurden: null, opportunityCost: null, uncertaintyState: 'KNOWN' as const, labelAvailableAt: null,
    ...overrides,
  };
}

function rollEconomics(overrides: Partial<RollEconomics> = {}): RollEconomics {
  return {
    oldLegRealizedPnl: -200, closeDebit: 80, newCredit: 100, netCashflow: 100 - 80 - 2 - 0.5,
    newStrike: 180, newDte: 30, additionalCapitalDays: 500, fees: 2, slippage: 0.5, ...overrides,
  };
}

test('accepts a real, well-formed row', () => {
  const row = buildLossRollComparisonRow(baseInput());
  assert.equal(row.contractVersion, 'theta-loss-roll-experiment-v1');
});

test('ADVERSARIAL: selectedAction not in feasibleActions is rejected', () => {
  assert.throws(() => buildLossRollComparisonRow(baseInput({ selectedAction: 'ROLL' })), /LOSS_ROLL_SELECTED_ACTION_NOT_FEASIBLE/);
});

test('CORE CLAIM: a ROLL action requires real rollEconomics, and rollCredit != realizedProfit -- the old-leg loss is preserved, never erased', () => {
  const row = buildLossRollComparisonRow(baseInput({
    feasibleActions: ['ROLL'], selectedAction: 'ROLL', rollEconomics: rollEconomics(),
  }));
  assert.equal(row.rollEconomics?.oldLegRealizedPnl, -200);
  assert.equal(row.rollEconomics?.newCredit, 100);
  assert.notEqual(row.rollEconomics?.oldLegRealizedPnl, row.rollEconomics?.newCredit);
});

test('ADVERSARIAL: ROLL without rollEconomics is rejected', () => {
  assert.throws(() => buildLossRollComparisonRow(baseInput({ feasibleActions: ['ROLL'], selectedAction: 'ROLL' })), /LOSS_ROLL_ROLL_REQUIRES_ECONOMICS/);
});

test('ADVERSARIAL: rollEconomics supplied for a non-ROLL action is rejected', () => {
  assert.throws(() => buildLossRollComparisonRow(baseInput({ rollEconomics: rollEconomics() })), /LOSS_ROLL_ECONOMICS_WITHOUT_ROLL_ACTION/);
});

test('ADVERSARIAL: an inconsistent netCashflow (not newCredit-closeDebit-fees-slippage) is rejected', () => {
  assert.throws(() => buildLossRollComparisonRow(baseInput({
    feasibleActions: ['ROLL'], selectedAction: 'ROLL', rollEconomics: rollEconomics({ netCashflow: 999 }),
  })), /LOSS_ROLL_NET_CASHFLOW_INCONSISTENT/);
});

test('reuses the real loss-cause-integration-contract.ts assessment, not a duplicated taxonomy', () => {
  const row = buildLossRollComparisonRow(baseInput());
  assert.equal(row.lossCauseAssessmentRef.causes[0]?.cause, 'UNDERLYING_DECLINE');
});

test('the same MTM-style loss cause set can legitimately favor different actions across two rows (evidence-driven, not fixed)', () => {
  const declineHold = buildLossRollComparisonRow(baseInput({
    lossCauseAssessmentRef: assessLossCauses('p1', DECISION_AT, -150, [causeEvidence({ cause: 'UNDERLYING_DECLINE', actionInfluence: 'FAVORS_HOLD' })]),
  }));
  const ivClose = buildLossRollComparisonRow(baseInput({
    lossCauseAssessmentRef: assessLossCauses('p2', DECISION_AT, -150, [causeEvidence({ cause: 'IV_EXPANSION', actionInfluence: 'FAVORS_CLOSE' })]),
  }));
  assert.notEqual(declineHold.lossCauseAssessmentRef.causes[0]?.actionInfluence, ivClose.lossCauseAssessmentRef.causes[0]?.actionInfluence);
});

test('ADVERSARIAL: evaluationHorizonEnd before decisionAt is rejected', () => {
  assert.throws(() => buildLossRollComparisonRow(baseInput({ evaluationHorizonEnd: '2026-09-01T00:00:00Z' })), /LOSS_ROLL_HORIZON_BEFORE_DECISION/);
});

test('ADVERSARIAL: a PnL value without labelAvailableAt is rejected', () => {
  assert.throws(() => buildLossRollComparisonRow(baseInput({ futureWholeChainNetPnl: 50 })), /LOSS_ROLL_PNL_WITHOUT_LABEL_AVAILABLE_AT/);
});
