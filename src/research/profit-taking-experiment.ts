/**
 * Profit-taking experiment source (Wave 18 section 2). Research-only,
 * `brokerAuthority: false`. Real, tested comparison contract for the 6
 * profit-taking policies -- no policy (including `FIXED_50`) has
 * privileged status; this module never declares a winner, it only
 * structures the real state/outcome comparison a future R8 pass will
 * evaluate empirically.
 */

export const profitTakingExperimentVersion = 'theta-profit-taking-experiment-v2' as const;

export type V7ProfitTakingPolicy =
  | 'FIXED_05' | 'FIXED_10' | 'FIXED_15' | 'FIXED_20' | 'FIXED_25' | 'FIXED_30'
  | 'FIXED_40' | 'FIXED_50' | 'FIXED_60' | 'FIXED_75' | 'FIXED_90'
  | 'TIME_EXIT' | 'DTE_EXIT' | 'DYNAMIC_REMAINING_EV'
  | 'DYNAMIC_EV_PLUS_HARD_RISK' | 'DYNAMIC_EV_PLUS_EVENT'
  | 'DYNAMIC_EV_PLUS_CAPITAL_EFFICIENCY';

/** Historical names remain readable so old research rows do not become invalid. */
export type LegacyProfitTakingPolicy = 'TAKE_25' | 'TAKE_50' | 'TAKE_75' | 'RESIDUAL_PREMIUM_EXIT' | 'CONTINUATION_VALUE';
export type ProfitTakingPolicy = V7ProfitTakingPolicy | LegacyProfitTakingPolicy;
export type CounterfactualState = 'OBSERVED_PARALLEL' | 'ESTIMABLE' | 'NOT_IDENTIFIABLE';

export interface ProfitTakingPolicyDefinition {
  readonly policy: V7ProfitTakingPolicy;
  readonly family: 'FIXED_CAPTURE' | 'TIME' | 'DTE' | 'DYNAMIC';
  readonly captureFraction: number | null;
  readonly requiredEvidence: readonly string[];
  readonly researchOnly: true;
  readonly brokerAuthority: false;
}

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
 * target (`FIXED_50`) is validated with the exact same rules as every
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

const fixedPolicies = [
  ['FIXED_05', 0.05], ['FIXED_10', 0.10], ['FIXED_15', 0.15], ['FIXED_20', 0.20],
  ['FIXED_25', 0.25], ['FIXED_30', 0.30], ['FIXED_40', 0.40], ['FIXED_50', 0.50],
  ['FIXED_60', 0.60], ['FIXED_75', 0.75], ['FIXED_90', 0.90],
] as const;

const definition = (
  policy: V7ProfitTakingPolicy,
  family: ProfitTakingPolicyDefinition['family'],
  captureFraction: number | null,
  requiredEvidence: readonly string[],
): ProfitTakingPolicyDefinition => ({
  policy, family, captureFraction, requiredEvidence, researchOnly: true, brokerAuthority: false,
});

/**
 * Complete V7 challenger set. These definitions state the evidence each
 * comparison needs. They never choose a Production management action and
 * never convert unavailable forward economics into a mechanical exit.
 */
export const v7ProfitTakingPolicyDefinitions: readonly ProfitTakingPolicyDefinition[] = [
  ...fixedPolicies.map(([policy, fraction]) => definition(policy, 'FIXED_CAPTURE', fraction,
    ['OPEN_CREDIT', 'EXECUTABLE_CLOSE_DEBIT', 'FEES_AND_SLIPPAGE'])),
  definition('TIME_EXIT', 'TIME', null, ['ENTRY_TIME', 'DECISION_TIME', 'VERSIONED_TIME_POLICY']),
  definition('DTE_EXIT', 'DTE', null, ['EXPIRATION', 'DECISION_TIME', 'VERSIONED_DTE_POLICY']),
  definition('DYNAMIC_REMAINING_EV', 'DYNAMIC', null,
    ['EXPECTED_REMAINING_PNL_AFTER_COST', 'CLOSE_NOW_VALUE', 'MODEL_UNCERTAINTY']),
  definition('DYNAMIC_EV_PLUS_HARD_RISK', 'DYNAMIC', null,
    ['EXPECTED_REMAINING_PNL_AFTER_COST', 'CLOSE_NOW_VALUE', 'HARD_RISK_STATE', 'TAIL_RISK']),
  definition('DYNAMIC_EV_PLUS_EVENT', 'DYNAMIC', null,
    ['EXPECTED_REMAINING_PNL_AFTER_COST', 'CLOSE_NOW_VALUE', 'EVENT_STATE', 'EVENT_VALID_THROUGH']),
  definition('DYNAMIC_EV_PLUS_CAPITAL_EFFICIENCY', 'DYNAMIC', null,
    ['EXPECTED_REMAINING_PNL_AFTER_COST', 'CLOSE_NOW_VALUE', 'CAPITAL_DAYS', 'BEST_REDEPLOYMENT_VALUE']),
];

export const canonicalV7ProfitTakingPolicies: readonly V7ProfitTakingPolicy[] =
  v7ProfitTakingPolicyDefinitions.map((item) => item.policy);

export const legacyProfitTakingPolicies: readonly LegacyProfitTakingPolicy[] = [
  'TAKE_25', 'TAKE_50', 'TAKE_75', 'RESIDUAL_PREMIUM_EXIT', 'CONTINUATION_VALUE',
];

export const allProfitTakingPolicies: readonly ProfitTakingPolicy[] = [
  ...canonicalV7ProfitTakingPolicies, ...legacyProfitTakingPolicies,
];

export interface FixedProfitTargetObservation {
  readonly policy: Extract<V7ProfitTakingPolicy, `FIXED_${string}`>;
  readonly capturedFraction: number;
  readonly targetFraction: number;
  readonly benchmarkAction: 'CLOSE' | 'HOLD';
  readonly researchOnly: true;
  readonly brokerAuthority: false;
}

/** Deterministic benchmark only. It is never the canonical management policy. */
export function observeFixedProfitTarget(input: {
  readonly policy: FixedProfitTargetObservation['policy'];
  readonly openCredit: number;
  readonly executableCloseDebit: number;
}): FixedProfitTargetObservation {
  if (!Number.isFinite(input.openCredit) || input.openCredit <= 0) throw new Error('FIXED_TARGET_OPEN_CREDIT_INVALID');
  if (!Number.isFinite(input.executableCloseDebit) || input.executableCloseDebit < 0) throw new Error('FIXED_TARGET_CLOSE_DEBIT_INVALID');
  const item = v7ProfitTakingPolicyDefinitions.find((candidate) => candidate.policy === input.policy);
  if (item?.captureFraction === null || item?.captureFraction === undefined) throw new Error('FIXED_TARGET_POLICY_INVALID');
  const capturedFraction = (input.openCredit - input.executableCloseDebit) / input.openCredit;
  return {
    policy: input.policy, capturedFraction, targetFraction: item.captureFraction,
    benchmarkAction: capturedFraction >= item.captureFraction ? 'CLOSE' : 'HOLD',
    researchOnly: true, brokerAuthority: false,
  };
}
