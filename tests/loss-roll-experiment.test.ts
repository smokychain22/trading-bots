import assert from 'node:assert/strict';
import test from 'node:test';
import { assessLossCauses, type LossCauseEvidence } from '../src/research/loss-cause-integration-contract.js';
import {
  buildLossRollComparisonRow,
  buildRollCashflowIdentity,
  lossManagementActions,
  type LossActionEconomics,
  type RollCashflowIdentity,
} from '../src/research/loss-roll-experiment.js';

const decisionAt = '2026-09-22T14:00:00Z';
const horizonAt = '2026-10-22T20:00:00Z';

const cause: LossCauseEvidence = {
  cause: 'UNDERLYING_DECLINE', evidenceQuality: 'KNOWN', severity: 0.6, persistenceCycles: 3,
  confidence: 0.8, thesisImpact: 'DEGRADES_THESIS', actionInfluence: 'FAVORS_CLOSE',
  hardSafetyOverride: false, sourceEvidenceIds: ['price-observation-1'], detail: 'real decline evidence',
};

const assessment = () => assessLossCauses('position-1', decisionAt, -125, [cause]);

const roll = (overrides: Partial<RollCashflowIdentity> = {}): RollCashflowIdentity => ({
  pricingBasis: 'BENCHMARK_BEFORE_SLIPPAGE',
  oldEntryCredit: 100,
  oldEntryCosts: 0,
  oldLegRealizedPnlBeforeRollCosts: -125,
  priorChainRealizedPnl: 0,
  unchangedInventoryUnrealizedPnl: 0,
  closeDebit: 225,
  newCredit: 250,
  netCashflow: 18,
  newStrike: 95,
  newDte: 35,
  additionalCapitalDays: 21,
  fees: 4,
  slippage: 3,
  newShortLiability: 250,
  wholeChainNetPnlImmediatelyAfterRoll: -132,
  ...overrides,
});

const economics = (overrides: Partial<LossActionEconomics> = {}): LossActionEconomics => ({
  action: 'HOLD', commonFutureHorizonAt: horizonAt, outcomeState: 'NOT_IDENTIFIABLE',
  outcomeEvidenceId: null, labelAvailableAt: null, futureWholeChainNetPnl: null,
  incrementalCapitalDays: null, expectedShortfall: null, executionCost: null,
  assignmentBurden: null, opportunityCost: null, uncertainty: null, roll: null,
  ...overrides,
});

const row = (overrides: Partial<Parameters<typeof buildLossRollComparisonRow>[0]> = {}) => ({
  comparisonId: 'comparison-1', episodeId: 'episode-1', chainId: 'chain-1', decisionId: 'decision-1',
  decisionAt, commonFutureHorizonAt: horizonAt, lossCauseAssessment: assessment(),
  actual: economics(), challenger: economics({ action: 'CLOSE' }), ...overrides,
});

test('builds a research-only comparison conditioned on the canonical loss-cause assessment', () => {
  const result = buildLossRollComparisonRow(row());
  assert.equal(result.contractVersion, 'theta-loss-roll-experiment-v2');
  assert.equal(result.lossCauseAssessment.causes[0]?.cause, 'UNDERLYING_DECLINE');
  assert.equal(result.brokerAuthority, false);
});

test('all required management alternatives are represented', () => {
  assert.deepEqual([...lossManagementActions].toSorted(),
    ['ACCEPT_ASSIGNMENT', 'CLOSE', 'HOLD', 'LET_EXPIRE', 'ROLL']);
});

test('ROLL preserves old loss, charges costs once and offsets the credit by its open liability', () => {
  const result = buildLossRollComparisonRow(row({
    challenger: economics({ action: 'ROLL', roll: roll() }),
  }));
  assert.equal(result.challenger.roll?.oldLegRealizedPnlBeforeRollCosts, -125);
  assert.equal(result.challenger.roll?.netCashflow, 18);
  assert.equal(result.challenger.roll?.wholeChainNetPnlImmediatelyAfterRoll, -132);
});

test('old close debit is never subtracted twice and missing liability never becomes zero', () => {
  const facts = roll();
  assert.equal(buildRollCashflowIdentity(facts).wholeChainNetPnlImmediatelyAfterRoll, -132);
  assert.equal(buildRollCashflowIdentity({ ...facts, newShortLiability: null }).wholeChainNetPnlImmediatelyAfterRoll, null);
  assert.throws(() => buildLossRollComparisonRow(row({ challenger: economics({ action: 'ROLL',
    roll: roll({ wholeChainNetPnlImmediatelyAfterRoll: -107 }) }) })), /ROLL_CREDIT_DOES_NOT_ERASE/);
  assert.throws(() => buildLossRollComparisonRow(row({ challenger: economics({ action: 'ROLL',
    roll: roll({ newShortLiability: null }) }) })), /MARK_REQUIRED/);
});

test('actual fills cannot subtract slippage again and prior chain losses remain realized', () => {
  assert.throws(() => buildRollCashflowIdentity({ ...roll(), pricingBasis: 'ACTUAL_FILL_CASHFLOW' }), /ALREADY_INCLUDE_SLIPPAGE/);
  const result = buildRollCashflowIdentity({ ...roll(), pricingBasis: 'ACTUAL_FILL_CASHFLOW', slippage: 0,
    priorChainRealizedPnl: -400, unchangedInventoryUnrealizedPnl: 50 });
  assert.equal(result.oldLegRealizedPnlBeforeRollCosts, -125);
  assert.equal(result.netCashflow, 21);
  assert.equal(result.wholeChainNetPnlImmediatelyAfterRoll, -479);
});

test('matched new credit and liability cannot manufacture profit, including large credit rolls', () => {
  for (const credit of [0, 1, 10, 250, 1000, 100_000]) {
    const result = buildRollCashflowIdentity({ ...roll(), newCredit: credit, newShortLiability: credit });
    assert.equal(result.wholeChainNetPnlImmediatelyAfterRoll, -132);
  }
  for (const value of [NaN, Infinity, -1]) {
    assert.throws(() => buildRollCashflowIdentity({ ...roll(), newShortLiability: value }), /INVALID_LIABILITY/);
  }
});

test('adversarial roll credit cannot erase the old realized loss', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    challenger: economics({
      action: 'ROLL',
      roll: roll({ wholeChainNetPnlImmediatelyAfterRoll: 18 }),
    }),
  })), /ROLL_CREDIT_DOES_NOT_ERASE_OLD_REALIZED_LOSS/);
});

test('roll net cashflow must include close debit, fees, and slippage', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    challenger: economics({ action: 'ROLL', roll: roll({ netCashflow: 25 }) }),
  })), /LOSS_ROLL_NET_CASHFLOW_IDENTITY_FAILED/);
});

test('roll details are required only for ROLL and forbidden on every other action', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    challenger: economics({ action: 'ROLL', roll: null }),
  })), /LOSS_ROLL_DETAILS_REQUIRED/);
  assert.throws(() => buildLossRollComparisonRow(row({
    challenger: economics({ action: 'HOLD', roll: roll() }),
  })), /LOSS_ROLL_DETAILS_ON_NON_ROLL_ACTION/);
});

test('both alternatives must use the exact common future horizon', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    challenger: economics({ commonFutureHorizonAt: '2026-11-22T20:00:00Z' }),
  })), /LOSS_ROLL_HORIZON_MISMATCH/);
});

test('NOT_IDENTIFIABLE never carries invented future economics', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    actual: economics({ futureWholeChainNetPnl: 10 }),
  })), /LOSS_ROLL_CLAIMED_VALUE_DESPITE_NOT_IDENTIFIABLE/);
});

test('future whole-chain outcome labels cannot become available before the common horizon', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    actual: economics({
      outcomeState: 'OBSERVED', outcomeEvidenceId: 'outcome-1', futureWholeChainNetPnl: -25,
      labelAvailableAt: '2026-09-23T20:00:00Z',
    }),
  })), /LOSS_ROLL_LABEL_BEFORE_COMMON_HORIZON/);
});

test('an identifiable outcome requires immutable evidence lineage', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    actual: economics({ outcomeState: 'ESTIMABLE' }),
  })), /LOSS_ROLL_IDENTIFIABLE_WITHOUT_EVIDENCE/);
});

test('the experiment refuses non-loss episodes and empty causal conditioning', () => {
  assert.throws(() => buildLossRollComparisonRow(row({
    lossCauseAssessment: assessLossCauses('position-1', decisionAt, 5, [cause]),
  })), /LOSS_ROLL_REQUIRES_OBSERVED_LOSS/);
  assert.throws(() => buildLossRollComparisonRow(row({
    lossCauseAssessment: assessLossCauses('position-1', decisionAt, -5, []),
  })), /LOSS_ROLL_CAUSE_ASSESSMENT_EMPTY/);
});

test('known future economics retain all required R8 comparison dimensions', () => {
  const actual = economics({
    action: 'CLOSE', outcomeState: 'OBSERVED', outcomeEvidenceId: 'outcome-2',
    labelAvailableAt: horizonAt, futureWholeChainNetPnl: -80, incrementalCapitalDays: 0,
    expectedShortfall: 0, executionCost: 6, assignmentBurden: 0, opportunityCost: 2,
    uncertainty: 0.1,
  });
  const result = buildLossRollComparisonRow(row({ actual }));
  assert.equal(result.actual.futureWholeChainNetPnl, -80);
  assert.equal(result.actual.executionCost, 6);
  assert.equal(result.actual.uncertainty, 0.1);
});
