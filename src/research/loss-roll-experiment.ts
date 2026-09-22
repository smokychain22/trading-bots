import type { LossCauseAssessment } from './loss-cause-integration-contract.js';

/**
 * Loss and roll experiment contract. Research-only and brokerAuthority=false.
 * It compares future whole-chain outcomes at one explicit common horizon. It
 * never selects a management action and never lets a new roll credit rewrite
 * the realized economics of the old leg.
 */
export const lossRollExperimentVersion = 'theta-loss-roll-experiment-v1' as const;

export type LossManagementAction = 'HOLD' | 'CLOSE' | 'ROLL' | 'LET_EXPIRE' | 'ACCEPT_ASSIGNMENT';
export type LossOutcomeState = 'OBSERVED' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

export interface RollCashflowIdentity {
  readonly oldLegRealizedPnl: number;
  readonly closeDebit: number;
  readonly newCredit: number;
  readonly netCashflow: number;
  readonly newStrike: number;
  readonly newDte: number;
  readonly additionalCapitalDays: number;
  readonly fees: number;
  readonly slippage: number;
  /** The explicit identity that prevents a credit roll from resetting history. */
  readonly wholeChainNetPnlImmediatelyAfterRoll: number;
}

export interface LossActionEconomics {
  readonly action: LossManagementAction;
  readonly commonFutureHorizonAt: string;
  readonly outcomeState: LossOutcomeState;
  readonly outcomeEvidenceId: string | null;
  readonly labelAvailableAt: string | null;
  readonly futureWholeChainNetPnl: number | null;
  readonly incrementalCapitalDays: number | null;
  readonly expectedShortfall: number | null;
  readonly executionCost: number | null;
  readonly assignmentBurden: number | null;
  readonly opportunityCost: number | null;
  /** Caller-measured 0..1 uncertainty. Null means it could not be measured. */
  readonly uncertainty: number | null;
  readonly roll: RollCashflowIdentity | null;
}

export interface LossRollComparisonRow {
  readonly contractVersion: typeof lossRollExperimentVersion;
  readonly comparisonId: string;
  readonly episodeId: string;
  readonly chainId: string;
  readonly decisionId: string;
  readonly decisionAt: string;
  readonly commonFutureHorizonAt: string;
  readonly lossCauseAssessment: LossCauseAssessment;
  readonly actual: LossActionEconomics;
  readonly challenger: LossActionEconomics;
  readonly brokerAuthority: false;
}

const finite = (value: number): boolean => Number.isFinite(value);
const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));

function validateRoll(action: LossManagementAction, roll: RollCashflowIdentity | null): void {
  if (action !== 'ROLL') {
    if (roll !== null) throw new Error('LOSS_ROLL_DETAILS_ON_NON_ROLL_ACTION');
    return;
  }
  if (roll === null) throw new Error('LOSS_ROLL_DETAILS_REQUIRED');
  for (const [name, value] of Object.entries(roll)) {
    if (!finite(value)) throw new Error(`LOSS_ROLL_NONFINITE:${name}`);
  }
  if (roll.closeDebit < 0 || roll.newCredit < 0 || roll.newStrike <= 0 || roll.newDte < 0
    || !Number.isInteger(roll.newDte) || roll.additionalCapitalDays < 0
    || roll.fees < 0 || roll.slippage < 0) {
    throw new Error('LOSS_ROLL_INVALID_CASHFLOW_INPUT');
  }
  const expectedNetCashflow = roll.newCredit - roll.closeDebit - roll.fees - roll.slippage;
  if (!approximatelyEqual(roll.netCashflow, expectedNetCashflow)) {
    throw new Error('LOSS_ROLL_NET_CASHFLOW_IDENTITY_FAILED');
  }
  const expectedWholeChain = roll.oldLegRealizedPnl + roll.netCashflow;
  if (!approximatelyEqual(roll.wholeChainNetPnlImmediatelyAfterRoll, expectedWholeChain)) {
    throw new Error('ROLL_CREDIT_DOES_NOT_ERASE_OLD_REALIZED_LOSS');
  }
}

function validateEconomics(
  economics: LossActionEconomics,
  decisionAtMs: number,
  horizonAtMs: number,
  commonFutureHorizonAt: string,
): void {
  if (economics.commonFutureHorizonAt !== commonFutureHorizonAt) {
    throw new Error('LOSS_ROLL_HORIZON_MISMATCH');
  }
  const nullableNumbers = [
    economics.futureWholeChainNetPnl,
    economics.incrementalCapitalDays,
    economics.expectedShortfall,
    economics.executionCost,
    economics.assignmentBurden,
    economics.opportunityCost,
    economics.uncertainty,
  ];
  if (nullableNumbers.some((value) => value !== null && !finite(value))) {
    throw new Error('LOSS_ROLL_NONFINITE_ECONOMICS');
  }
  if (economics.incrementalCapitalDays !== null && economics.incrementalCapitalDays < 0) {
    throw new Error('LOSS_ROLL_NEGATIVE_CAPITAL_DAYS');
  }
  for (const [name, value] of [
    ['expectedShortfall', economics.expectedShortfall],
    ['executionCost', economics.executionCost],
    ['assignmentBurden', economics.assignmentBurden],
    ['opportunityCost', economics.opportunityCost],
  ] as const) {
    if (value !== null && value < 0) throw new Error(`LOSS_ROLL_NEGATIVE_COST:${name}`);
  }
  if (economics.uncertainty !== null && (economics.uncertainty < 0 || economics.uncertainty > 1)) {
    throw new Error('LOSS_ROLL_UNCERTAINTY_OUT_OF_RANGE');
  }

  const claimedValues = nullableNumbers.some((value) => value !== null);
  if (economics.outcomeState === 'NOT_IDENTIFIABLE' && claimedValues) {
    throw new Error('LOSS_ROLL_CLAIMED_VALUE_DESPITE_NOT_IDENTIFIABLE');
  }
  if (economics.outcomeState !== 'NOT_IDENTIFIABLE' && economics.outcomeEvidenceId === null) {
    throw new Error('LOSS_ROLL_IDENTIFIABLE_WITHOUT_EVIDENCE');
  }
  if (economics.futureWholeChainNetPnl !== null && economics.labelAvailableAt === null) {
    throw new Error('LOSS_ROLL_PNL_WITHOUT_LABEL_TIME');
  }
  if (economics.labelAvailableAt !== null) {
    const labelAtMs = Date.parse(economics.labelAvailableAt);
    if (!Number.isFinite(labelAtMs)) throw new Error('LOSS_ROLL_INVALID_LABEL_TIME');
    if (labelAtMs < decisionAtMs) throw new Error('LOSS_ROLL_LABEL_BEFORE_DECISION');
    if (economics.futureWholeChainNetPnl !== null && labelAtMs < horizonAtMs) {
      throw new Error('LOSS_ROLL_LABEL_BEFORE_COMMON_HORIZON');
    }
  }
  validateRoll(economics.action, economics.roll);
}

export function buildLossRollComparisonRow(
  input: Omit<LossRollComparisonRow, 'contractVersion' | 'brokerAuthority'>,
): LossRollComparisonRow {
  const decisionAtMs = Date.parse(input.decisionAt);
  const horizonAtMs = Date.parse(input.commonFutureHorizonAt);
  if (!Number.isFinite(decisionAtMs)) throw new Error('LOSS_ROLL_INVALID_DECISION_AT');
  if (!Number.isFinite(horizonAtMs) || horizonAtMs <= decisionAtMs) {
    throw new Error('LOSS_ROLL_INVALID_COMMON_HORIZON');
  }
  if (input.lossCauseAssessment.asOf !== input.decisionAt) {
    throw new Error('LOSS_ROLL_CAUSE_ASSESSMENT_TIME_MISMATCH');
  }
  if (input.lossCauseAssessment.causes.length === 0) {
    throw new Error('LOSS_ROLL_CAUSE_ASSESSMENT_EMPTY');
  }
  if (input.lossCauseAssessment.observedNetPnl === null
    || !finite(input.lossCauseAssessment.observedNetPnl)
    || input.lossCauseAssessment.observedNetPnl >= 0) {
    throw new Error('LOSS_ROLL_REQUIRES_OBSERVED_LOSS');
  }
  validateEconomics(input.actual, decisionAtMs, horizonAtMs, input.commonFutureHorizonAt);
  validateEconomics(input.challenger, decisionAtMs, horizonAtMs, input.commonFutureHorizonAt);
  return {
    contractVersion: lossRollExperimentVersion,
    ...input,
    brokerAuthority: false,
  };
}

export const lossManagementActions: readonly LossManagementAction[] = [
  'HOLD', 'CLOSE', 'ROLL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT',
];
