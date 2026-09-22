/**
 * Profit-taking experiment source (Wave 18 section 2). Research-only,
 * `brokerAuthority: false`. Real, tested comparison contract for the 6
 * profit-taking policies -- no policy (including `TAKE_50`) has
 * privileged status; this module never declares a winner, it only
 * structures the real state/outcome comparison a future R8 pass will
 * evaluate empirically.
 */

export const profitTakingExperimentVersion = 'theta-profit-taking-experiment-v1' as const;

export type ProfitTakingPolicy = 'TAKE_25' | 'TAKE_50' | 'TAKE_75' | 'DTE_EXIT' | 'RESIDUAL_PREMIUM_EXIT' | 'CONTINUATION_VALUE';
export type CounterfactualState = 'OBSERVED_PARALLEL' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

export interface ProfitTakingDecisionState {
  readonly episodeId: string;
  readonly chainId: string;
  readonly decisionId: string;
  readonly decisionAt: string;

  readonly openCredit: number;
  /** Real current close debit -- the actual executable cost to close now.
   * Distinct from remainingExecutablePremium (the residual short-option
   * value), never conflated. */
  readonly closeDebit: number;
  readonly remainingExecutablePremium: number;

  readonly dte: number;
  readonly signedDelta: number | null;
  readonly absoluteDelta: number | null;

  readonly atmIv: number | null;
  readonly rv20: number | null;
  readonly vrp20: number | null;

  readonly eventEvidenceState: string;
  readonly executionEvidenceState: string;
  readonly assignmentBurden: number | null;

  readonly capitalDaysConsumed: number;

  readonly rollAlternativeAvailable: boolean;
  readonly redeploymentAlternativeAvailable: boolean;
  readonly portfolioConstraints: readonly string[];
  readonly uncertaintyState: 'KNOWN' | 'ELEVATED' | 'UNKNOWN';
}

export interface ProfitTakingComparisonRow {
  readonly contractVersion: typeof profitTakingExperimentVersion;
  readonly state: ProfitTakingDecisionState;

  readonly actualPolicy: ProfitTakingPolicy;
  readonly challengerPolicy: ProfitTakingPolicy;

  readonly actualAction: 'CLOSE' | 'HOLD';
  readonly challengerAction: 'CLOSE' | 'HOLD';

  readonly actualOutcomeRef: string | null;
  readonly counterfactualOutcomeState: CounterfactualState;

  /** null (not 0) whenever the counterfactual cannot be resolved --
   * incrementalWholeChainNetPnl=0 is a real, different claim (the
   * challenger performed exactly as well) from "we don't know." */
  readonly incrementalWholeChainNetPnl: number | null;
  readonly incrementalCapitalDays: number | null;
  readonly incrementalDownside: number | null;
  readonly incrementalExecutionCost: number | null;

  readonly labelAvailableAt: string | null;
}

function requireKnownForCounterfactual<T>(
  state: CounterfactualState, value: T | null, fieldName: string,
): void {
  if (state === 'NOT_IDENTIFIABLE' && value !== null) throw new Error(`PROFIT_TAKING_CLAIMED_VALUE_DESPITE_NOT_IDENTIFIABLE:${fieldName}`);
}

/**
 * Builds one real comparison row. No policy is privileged: the 50%
 * target (`TAKE_50`) is validated with the exact same rules as every
 * other policy -- there is no special-cased branch anywhere in this
 * function that treats `TAKE_50` differently.
 */
export function buildProfitTakingComparisonRow(input: Omit<ProfitTakingComparisonRow, 'contractVersion'>): ProfitTakingComparisonRow {
  if (!Number.isFinite(Date.parse(input.state.decisionAt))) throw new Error('PROFIT_TAKING_INVALID_DECISION_AT');
  if (input.labelAvailableAt !== null) {
    const labelMs = Date.parse(input.labelAvailableAt);
    if (!Number.isFinite(labelMs)) throw new Error('PROFIT_TAKING_INVALID_LABEL_AVAILABLE_AT');
    if (labelMs < Date.parse(input.state.decisionAt)) throw new Error('PROFIT_TAKING_LABEL_BEFORE_DECISION');
  }
  // CORE CLAIM: no counterfactual field may claim a real value without
  // real identifiability -- checked uniformly across all 4 incremental
  // fields, not per-policy.
  for (const [name, value] of [
    ['incrementalWholeChainNetPnl', input.incrementalWholeChainNetPnl],
    ['incrementalCapitalDays', input.incrementalCapitalDays],
    ['incrementalDownside', input.incrementalDownside],
    ['incrementalExecutionCost', input.incrementalExecutionCost],
  ] as const) {
    requireKnownForCounterfactual(input.counterfactualOutcomeState, value, name);
  }
  if (input.incrementalWholeChainNetPnl !== null && input.actualOutcomeRef === null) {
    throw new Error('PROFIT_TAKING_INCREMENTAL_PNL_WITHOUT_ACTUAL_OUTCOME_REF');
  }
  return { contractVersion: profitTakingExperimentVersion, ...input };
}

export const allProfitTakingPolicies: readonly ProfitTakingPolicy[] = [
  'TAKE_25', 'TAKE_50', 'TAKE_75', 'DTE_EXIT', 'RESIDUAL_PREMIUM_EXIT', 'CONTINUATION_VALUE',
];
