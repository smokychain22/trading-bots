/**
 * Loss / HOLD / CLOSE / ROLL experiment (Wave 18 section 3). Research-
 * only, `brokerAuthority: false`. Reuses `loss-cause-integration-contract.ts`'s
 * real `LossCause`/`LossCauseAssessment` types directly rather than
 * building a second taxonomy. Compares HOLD/CLOSE/ROLL/LET_EXPIRE/
 * ACCEPT_ASSIGNMENT on a common, explicit future horizon, conditioned on
 * the real loss cause -- the same MTM loss legitimately implies a
 * different optimal action depending on cause, which this module's row
 * schema preserves rather than collapsing.
 */
import type { LossCauseAssessment } from './loss-cause-integration-contract.js';

export const lossRollExperimentVersion = 'theta-loss-roll-experiment-v1' as const;

export type LossManagementAction = 'HOLD' | 'CLOSE' | 'ROLL' | 'LET_EXPIRE' | 'ACCEPT_ASSIGNMENT';

/** ROLL economics kept fully separate from a single net number -- the old
 * leg's realized loss can never disappear into a roll credit. */
export interface RollEconomics {
  readonly oldLegRealizedPnl: number;
  readonly closeDebit: number;
  readonly newCredit: number;
  readonly netCashflow: number;
  readonly newStrike: number;
  readonly newDte: number;
  readonly additionalCapitalDays: number;
  readonly fees: number;
  readonly slippage: number;
}

export interface LossRollComparisonRow {
  readonly contractVersion: typeof lossRollExperimentVersion;
  readonly episodeId: string;
  readonly chainId: string;
  readonly decisionAt: string;
  readonly evaluationHorizonEnd: string;

  readonly lossCauseAssessmentRef: LossCauseAssessment;

  readonly feasibleActions: readonly LossManagementAction[];
  readonly selectedAction: LossManagementAction;
  /** Required if and only if selectedAction === 'ROLL' -- enforced at
   * construction, not merely documented. */
  readonly rollEconomics: RollEconomics | null;

  readonly futureWholeChainNetPnl: number | null;
  readonly incrementalCapitalDays: number | null;
  readonly expectedShortfall: number | null;
  readonly executionCost: number | null;
  readonly assignmentBurden: number | null;
  readonly opportunityCost: number | null;
  readonly uncertaintyState: 'KNOWN' | 'ELEVATED' | 'UNKNOWN';

  readonly labelAvailableAt: string | null;
}

export function buildLossRollComparisonRow(input: Omit<LossRollComparisonRow, 'contractVersion'>): LossRollComparisonRow {
  if (!Number.isFinite(Date.parse(input.decisionAt))) throw new Error('LOSS_ROLL_INVALID_DECISION_AT');
  if (!Number.isFinite(Date.parse(input.evaluationHorizonEnd))) throw new Error('LOSS_ROLL_INVALID_HORIZON_END');
  if (Date.parse(input.evaluationHorizonEnd) < Date.parse(input.decisionAt)) throw new Error('LOSS_ROLL_HORIZON_BEFORE_DECISION');
  if (!input.feasibleActions.includes(input.selectedAction)) throw new Error('LOSS_ROLL_SELECTED_ACTION_NOT_FEASIBLE');
  if (input.selectedAction === 'ROLL' && input.rollEconomics === null) throw new Error('LOSS_ROLL_ROLL_REQUIRES_ECONOMICS');
  if (input.selectedAction !== 'ROLL' && input.rollEconomics !== null) throw new Error('LOSS_ROLL_ECONOMICS_WITHOUT_ROLL_ACTION');
  if (input.rollEconomics !== null) {
    const r = input.rollEconomics;
    const expectedNetCashflow = r.newCredit - r.closeDebit - r.fees - r.slippage;
    if (Math.abs(expectedNetCashflow - r.netCashflow) > 1e-9) throw new Error('LOSS_ROLL_NET_CASHFLOW_INCONSISTENT');
    // CORE CLAIM: a roll credit is never treated as erasing the old
    // realized loss -- this function never derives futureWholeChainNetPnl
    // from rollEconomics alone; the two remain structurally independent
    // fields, and a negative oldLegRealizedPnl is never dropped or
    // folded away.
  }
  if (input.labelAvailableAt !== null) {
    const labelMs = Date.parse(input.labelAvailableAt);
    if (!Number.isFinite(labelMs)) throw new Error('LOSS_ROLL_INVALID_LABEL_AVAILABLE_AT');
    if (labelMs < Date.parse(input.decisionAt)) throw new Error('LOSS_ROLL_LABEL_BEFORE_DECISION');
  }
  if (input.futureWholeChainNetPnl !== null && input.labelAvailableAt === null) throw new Error('LOSS_ROLL_PNL_WITHOUT_LABEL_AVAILABLE_AT');
  return { contractVersion: lossRollExperimentVersion, ...input };
}
