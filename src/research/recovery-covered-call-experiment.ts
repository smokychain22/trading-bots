import {
  computeEffectiveStockBasis,
  computeWholeChainPnl,
  type WholeChainComponents,
  type WholeChainPnlBreakdown,
} from '../theta/whole-chain-economics.js';

/**
 * Recovery and covered-call action experiment. This is an offline comparison
 * envelope only. It exposes no selected action, score, rank, or broker path.
 */
export const recoveryCoveredCallExperimentVersion = 'theta-recovery-covered-call-experiment-v1' as const;

export type RecoveryCoveredCallAction =
  | 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC'
  | 'HOLD_CC' | 'CLOSE_CC' | 'ROLL_CC' | 'ALLOW_CALL_AWAY';
export type RecoveryCoveredCallStage = 'ASSIGNED_STOCK' | 'COVERED_CALL_OPEN';
export type RecoveryCoveredCallResolution = 'RESOLVED' | 'PARTIAL' | 'CENSORED';
export type InformationState = 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface RecoveryCoveredCallAlternativeInput {
  readonly action: RecoveryCoveredCallAction;
  readonly commonFutureHorizonAt: string;
  readonly resolution: RecoveryCoveredCallResolution;
  /** Canonical components known at decision time, used for effective basis. */
  readonly basisComponents: WholeChainComponents;
  /** Canonical final components at the common horizon. Null while censored. */
  readonly outcomeComponents: WholeChainComponents | null;
  readonly dividendEvidenceState: InformationState;
  readonly eventEvidenceState: InformationState;
  readonly ccRollCost: number | null;
  readonly callAwayStrike: number | null;
  readonly retainedUpside: number | null;
  readonly lostUpside: number | null;
  readonly remainingDownside: number | null;
  readonly capitalDays: number | null;
  readonly slippage: number | null;
  readonly evidenceIds: readonly string[];
  readonly labelAvailableAt: string | null;
}

export interface RecoveryCoveredCallAlternative {
  readonly action: RecoveryCoveredCallAction;
  readonly commonFutureHorizonAt: string;
  readonly resolution: RecoveryCoveredCallResolution;
  readonly initialCspPremium: number | null;
  readonly assignmentStrike: number | null;
  readonly effectiveStockBasis: number | null;
  readonly stockPnl: number | null;
  readonly dividends: number | null;
  readonly ccPremium: number | null;
  readonly ccCloseCost: number | null;
  readonly ccRollCost: number | null;
  readonly callAwayStrike: number | null;
  readonly retainedUpside: number | null;
  readonly lostUpside: number | null;
  readonly remainingDownside: number | null;
  readonly capitalDays: number | null;
  readonly fees: number | null;
  readonly slippage: number | null;
  readonly tca: number | null;
  readonly wholeChain: WholeChainPnlBreakdown | null;
  readonly dividendEvidenceState: InformationState;
  readonly eventEvidenceState: InformationState;
  readonly evidenceIds: readonly string[];
  readonly labelAvailableAt: string | null;
}

export interface RecoveryCoveredCallExperiment {
  readonly contractVersion: typeof recoveryCoveredCallExperimentVersion;
  readonly experimentId: string;
  readonly chainId: string;
  readonly decisionId: string;
  readonly decisionAt: string;
  readonly commonFutureHorizonAt: string;
  readonly stage: RecoveryCoveredCallStage;
  readonly alternatives: readonly RecoveryCoveredCallAlternative[];
  readonly comparisonState: 'DESCRIPTIVE_NO_RANKING';
  readonly brokerAuthority: false;
}

const recoveryActions = new Set<RecoveryCoveredCallAction>(['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC']);
const coveredCallActions = new Set<RecoveryCoveredCallAction>(['HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY']);

function finiteNonnegative(value: number | null, code: string): void {
  if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(code);
}

function stockPnlFromBreakdown(breakdown: WholeChainPnlBreakdown | null): number | null {
  if (breakdown === null) return null;
  return breakdown.legLevelPnl.find((leg) =>
    leg.label === 'STOCK_PNL_AT_SALE_OR_CALL_AWAY' || leg.label === 'UNREALIZED_STOCK_MTM')?.amount ?? null;
}

function buildAlternative(
  input: RecoveryCoveredCallAlternativeInput,
  stage: RecoveryCoveredCallStage,
  decisionAtMs: number,
  horizonAtMs: number,
  commonFutureHorizonAt: string,
): RecoveryCoveredCallAlternative {
  const allowed = stage === 'ASSIGNED_STOCK' ? recoveryActions : coveredCallActions;
  if (!allowed.has(input.action)) throw new Error('RECOVERY_CC_ACTION_NOT_APPLICABLE_TO_STAGE');
  if (input.commonFutureHorizonAt !== commonFutureHorizonAt) throw new Error('RECOVERY_CC_HORIZON_MISMATCH');
  finiteNonnegative(input.ccRollCost, 'RECOVERY_CC_INVALID_ROLL_COST');
  finiteNonnegative(input.callAwayStrike, 'RECOVERY_CC_INVALID_CALL_AWAY_STRIKE');
  finiteNonnegative(input.retainedUpside, 'RECOVERY_CC_INVALID_RETAINED_UPSIDE');
  finiteNonnegative(input.lostUpside, 'RECOVERY_CC_INVALID_LOST_UPSIDE');
  finiteNonnegative(input.remainingDownside, 'RECOVERY_CC_INVALID_REMAINING_DOWNSIDE');
  finiteNonnegative(input.capitalDays, 'RECOVERY_CC_INVALID_CAPITAL_DAYS');
  finiteNonnegative(input.slippage, 'RECOVERY_CC_INVALID_SLIPPAGE');

  if (new Set(input.evidenceIds).size !== input.evidenceIds.length) {
    throw new Error('RECOVERY_CC_DUPLICATE_EVIDENCE_ID');
  }
  if (input.resolution === 'CENSORED') {
    if (input.outcomeComponents !== null || input.labelAvailableAt !== null
      || input.retainedUpside !== null || input.lostUpside !== null || input.remainingDownside !== null
      || input.capitalDays !== null || input.slippage !== null) {
      throw new Error('RECOVERY_CC_CENSORED_OUTCOME_HAS_FUTURE_VALUES');
    }
  } else {
    if (input.outcomeComponents === null || input.labelAvailableAt === null || input.evidenceIds.length === 0) {
      throw new Error('RECOVERY_CC_RESOLVED_OR_PARTIAL_REQUIRES_EVIDENCE');
    }
    const labelAtMs = Date.parse(input.labelAvailableAt);
    if (!Number.isFinite(labelAtMs) || labelAtMs < decisionAtMs || labelAtMs < horizonAtMs) {
      throw new Error('RECOVERY_CC_LABEL_BEFORE_COMMON_HORIZON');
    }
  }
  if (input.dividendEvidenceState === 'UNKNOWN'
    && (input.basisComponents.dividends !== null || input.outcomeComponents?.dividends !== null)) {
    throw new Error('RECOVERY_CC_UNKNOWN_DIVIDEND_HAS_VALUE');
  }
  if (input.resolution === 'RESOLVED'
    && (input.dividendEvidenceState === 'UNKNOWN' || input.eventEvidenceState === 'UNKNOWN')) {
    throw new Error('RECOVERY_CC_RESOLVED_WITH_UNKNOWN_CONTEXT');
  }
  if (input.action === 'ROLL_CC' && input.ccRollCost === null) throw new Error('RECOVERY_CC_ROLL_COST_REQUIRED');
  if (input.action !== 'ROLL_CC' && input.ccRollCost !== null) throw new Error('RECOVERY_CC_ROLL_COST_ON_NON_ROLL');
  if (input.action === 'ALLOW_CALL_AWAY') {
    if (input.callAwayStrike === null || input.outcomeComponents === null) {
      throw new Error('RECOVERY_CC_CALL_AWAY_ECONOMICS_REQUIRED');
    }
    const expectedProceeds = input.callAwayStrike * input.outcomeComponents.stockSharesAssigned;
    if (input.outcomeComponents.stockSaleOrCallAwayProceeds === null
      || Math.abs(input.outcomeComponents.stockSaleOrCallAwayProceeds - expectedProceeds) > 1e-8) {
      throw new Error('RECOVERY_CC_CALL_AWAY_PROCEEDS_IDENTITY_FAILED');
    }
  } else if (input.callAwayStrike !== null) {
    throw new Error('RECOVERY_CC_CALL_AWAY_STRIKE_ON_OTHER_ACTION');
  }

  const basis = computeEffectiveStockBasis(input.basisComponents);
  const wholeChain = input.outcomeComponents === null ? null : computeWholeChainPnl(input.outcomeComponents);
  if (input.resolution === 'RESOLVED' && wholeChain?.wholeChainPnl === null) {
    throw new Error('RECOVERY_CC_RESOLVED_WHOLE_CHAIN_INCOMPLETE');
  }
  if (input.resolution === 'PARTIAL' && wholeChain?.wholeChainPnl !== null) {
    throw new Error('RECOVERY_CC_PARTIAL_WHOLE_CHAIN_ALREADY_COMPLETE');
  }

  return {
    action: input.action,
    commonFutureHorizonAt,
    resolution: input.resolution,
    initialCspPremium: input.basisComponents.initialPutPremium,
    assignmentStrike: input.basisComponents.assignmentStrike,
    effectiveStockBasis: basis.effectiveStockBasisPerShare,
    stockPnl: stockPnlFromBreakdown(wholeChain),
    dividends: input.outcomeComponents?.dividends ?? null,
    ccPremium: input.outcomeComponents?.coveredCallPremium ?? null,
    ccCloseCost: input.outcomeComponents?.coveredCallCloseCosts ?? null,
    ccRollCost: input.ccRollCost,
    callAwayStrike: input.callAwayStrike,
    retainedUpside: input.retainedUpside,
    lostUpside: input.lostUpside,
    remainingDownside: input.remainingDownside,
    capitalDays: input.capitalDays,
    fees: input.outcomeComponents?.fees ?? null,
    slippage: input.slippage,
    tca: input.outcomeComponents?.tcaExecutionShortfall ?? null,
    wholeChain,
    dividendEvidenceState: input.dividendEvidenceState,
    eventEvidenceState: input.eventEvidenceState,
    evidenceIds: input.evidenceIds,
    labelAvailableAt: input.labelAvailableAt,
  };
}

export function buildRecoveryCoveredCallExperiment(input: {
  readonly experimentId: string;
  readonly chainId: string;
  readonly decisionId: string;
  readonly decisionAt: string;
  readonly commonFutureHorizonAt: string;
  readonly stage: RecoveryCoveredCallStage;
  readonly alternatives: readonly RecoveryCoveredCallAlternativeInput[];
}): RecoveryCoveredCallExperiment {
  const decisionAtMs = Date.parse(input.decisionAt);
  const horizonAtMs = Date.parse(input.commonFutureHorizonAt);
  if (!Number.isFinite(decisionAtMs) || !Number.isFinite(horizonAtMs) || horizonAtMs <= decisionAtMs) {
    throw new Error('RECOVERY_CC_INVALID_TIME_GEOMETRY');
  }
  if (input.alternatives.length === 0) throw new Error('RECOVERY_CC_ALTERNATIVES_REQUIRED');
  const actionSet = new Set(input.alternatives.map((alternative) => alternative.action));
  if (actionSet.size !== input.alternatives.length) throw new Error('RECOVERY_CC_DUPLICATE_ACTION');
  return {
    contractVersion: recoveryCoveredCallExperimentVersion,
    experimentId: input.experimentId,
    chainId: input.chainId,
    decisionId: input.decisionId,
    decisionAt: input.decisionAt,
    commonFutureHorizonAt: input.commonFutureHorizonAt,
    stage: input.stage,
    alternatives: input.alternatives.map((alternative) => buildAlternative(
      alternative, input.stage, decisionAtMs, horizonAtMs, input.commonFutureHorizonAt,
    )),
    comparisonState: 'DESCRIPTIVE_NO_RANKING',
    brokerAuthority: false,
  };
}
