import { createHash } from 'node:crypto';
import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import type { CanonicalFrontierAction } from './canonical-strategy-frontier.js';
import { canonicalThetaStrategySources, type ThetaStrategyBranch } from './strategy-package.js';
import { buildCanonicalShadowComparison } from './canonical-shadow-comparison.js';

export const adaptiveDecisionBrainVersion = 'theta-adaptive-decision-brain-shadow-v3' as const;

export type EvidenceValueState = 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE' | 'INVALID';
export type EvidencePolicyRole =
  | 'HARD_SAFETY'
  | 'STRATEGY_APPLICABILITY'
  | 'ECONOMIC_OBJECTIVE'
  | 'UNCERTAINTY_MODIFIER';

export const sovereignDecisionPath = [
  'CURRENT_DECISION_STATE', 'STRATEGY_APPLICABILITY', 'CANDIDATE_GENERATION',
  'CANDIDATE_ECONOMICS', 'PORTFOLIO_RISK', 'CANDIDATE_FRONTIER', 'AEGIS',
  'SIZING', 'FINAL_ACTION', 'EXECUTION', 'LIFECYCLE_MANAGEMENT',
] as const;

export const adaptiveBrainLayerOwnership = {
  STATE_AND_RISK_KERNEL: [
    'BROKER_ACCOUNT', 'CASH_EQUITY_OPTIONS_BP', 'POSITIONS', 'ORDERS', 'PENDING_INTENT',
    'MARKET_SESSION', 'UNDERLYING_STATE', 'QUOTES', 'OPTION_CHAIN', 'EVENTS',
    'PORTFOLIO_CONCENTRATION', 'ASSIGNMENT_CAPACITY', 'RECOVERY_CAPACITY',
    'WORKER_RECONCILIATION', 'PROVIDER_FRESHNESS', 'POLICY_MODEL_VERSIONS',
  ],
  ADAPTIVE_STRATEGY_ORCHESTRATOR: [
    'APPLICABILITY', 'CANDIDATE_GENERATION', 'STRUCTURAL_ECONOMICS', 'PARETO_FRONTIER',
    'SHADOW_COMPARISON', 'STRUCTURED_EXPLANATION',
  ],
  EMPIRICAL_POLICY_LAYER: [
    'MODEL_TRAINING', 'CALIBRATION', 'OOS_VALIDATION', 'PROMOTION', 'POLICY_VERSIONING',
  ],
} as const;

export interface KernelEvidence<T> {
  readonly state: EvidenceValueState;
  readonly value: T | null;
  readonly observedAt: string | null;
  readonly source: string;
  readonly version: string;
  readonly reason: string | null;
}

export interface CurrentDecisionState {
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly brokerAccount: KernelEvidence<Readonly<Record<string, unknown>>>;
  readonly portfolio: KernelEvidence<Readonly<Record<string, unknown>>>;
  readonly marketSession: KernelEvidence<string>;
  readonly marketData: KernelEvidence<Readonly<Record<string, unknown>>>;
  readonly providerFreshness: KernelEvidence<Readonly<Record<string, unknown>>>;
  readonly reconciliation: KernelEvidence<Readonly<Record<string, unknown>>>;
  readonly policyVersions: Readonly<Record<string, string>>;
}

export function validateKernelEvidence<T>(evidence: KernelEvidence<T>): readonly string[] {
  const errors: string[] = [];
  if (evidence.state === 'KNOWN' && evidence.value === null) errors.push('KNOWN_VALUE_MISSING');
  if (evidence.state !== 'KNOWN' && evidence.value !== null) errors.push('NON_KNOWN_VALUE_MUST_BE_NULL');
  if (evidence.state === 'INVALID' && evidence.reason === null) errors.push('INVALID_REASON_REQUIRED');
  return errors;
}

export const canonicalEvidencePolicyRoles = {
  FRESH_BROKER_STATE: 'HARD_SAFETY',
  RECONCILED_LIFECYCLE: 'HARD_SAFETY',
  FRESH_EXECUTABLE_BBO: 'HARD_SAFETY',
  COLLATERAL_CAPACITY: 'HARD_SAFETY',
  ASSIGNMENT_CAPACITY: 'HARD_SAFETY',
  PORTFOLIO_RISK_WITHIN_LIMITS: 'HARD_SAFETY',
  AEGIS_NOT_VETOED: 'HARD_SAFETY',
  VALID_NONZERO_QUANTITY: 'HARD_SAFETY',
  COVERED_SHARES: 'HARD_SAFETY',
  LIFECYCLE_STATE: 'STRATEGY_APPLICABILITY',
  DEFINED_RISK_STRUCTURE: 'STRATEGY_APPLICABILITY',
  MARKET_REGIME: 'STRATEGY_APPLICABILITY',
  VRP: 'ECONOMIC_OBJECTIVE',
  CAPITAL_DAYS: 'ECONOMIC_OBJECTIVE',
  EXECUTION_COST: 'ECONOMIC_OBJECTIVE',
  TAIL_BURDEN: 'ECONOMIC_OBJECTIVE',
  CORRELATION: 'ECONOMIC_OBJECTIVE',
  GEX: 'UNCERTAINTY_MODIFIER',
  FLOW: 'UNCERTAINTY_MODIFIER',
  RESEARCH_CONFIDENCE: 'UNCERTAINTY_MODIFIER',
  EVENT_CONTEXT: 'UNCERTAINTY_MODIFIER',
} as const satisfies Readonly<Record<string, EvidencePolicyRole>>;

export interface AdaptiveStrategyRegistryEntry {
  readonly branch: ThetaStrategyBranch;
  readonly strategyVersion: string;
  readonly maturity: 'RESEARCH_ONLY' | 'SHADOW' | 'PAPER' | 'LIVE_SMALL' | 'LIVE' | 'RETIRED';
  readonly executionEnabled: boolean;
  readonly applicableAccountState: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly optionalEvidence: readonly string[];
  readonly candidateGenerator: string;
  readonly economicObjectiveSet: readonly string[];
  readonly managementActions: readonly string[];
  readonly promotionStatus: string;
}

const applicabilityByBranch: Readonly<Record<ThetaStrategyBranch, readonly string[]>> = {
  THETA_CONVENTIONAL: ['CASH_AVAILABLE', 'CSP_CAPABILITY', 'ASSIGNMENT_CAPACITY'],
  THETA_HOLD_STRIKE: ['CASH_AVAILABLE', 'SHORT_DTE_RESEARCH_CONTEXT'],
  THETA_DEFINED_RISK: ['MULTI_LEG_CAPABILITY', 'BOUNDED_RISK_STRUCTURE_KNOWN'],
  THETA_RECOVERY: ['BROKER_CONFIRMED_OWNED_STOCK'],
  THETA_CC: ['BROKER_CONFIRMED_COVERED_SHARES'],
};

export const adaptiveStrategyRegistry: readonly AdaptiveStrategyRegistryEntry[] = canonicalThetaStrategySources.map((source) => ({
  branch: source.branch,
  strategyVersion: source.strategyVersion,
  maturity: source.status,
  executionEnabled: source.executionEnabled,
  applicableAccountState: applicabilityByBranch[source.branch],
  requiredEvidence: source.hardRules,
  optionalEvidence: source.softFeatureFamilies,
  candidateGenerator: `canonical-strategy-frontier:${source.branch}`,
  economicObjectiveSet: [
    'AFTER_COST_EXPECTED_ECONOMICS', 'CAPITAL_DAYS', 'TAIL_BURDEN', 'ASSIGNMENT_RECOVERY_BURDEN',
    'EXECUTION_COST', 'PORTFOLIO_CONCENTRATION', 'MODEL_UNCERTAINTY',
  ],
  managementActions: source.allowedActions,
  promotionStatus: source.promotionStatus,
}));

export const thetaRManagementRoute = {
  route: 'THETA_R',
  type: 'CROSS_STRATEGY_MANAGEMENT_ROUTE',
  productStrategy: false,
  lifecycleBranches: ['THETA_CONVENTIONAL', 'THETA_RECOVERY', 'THETA_CC'],
  executionAuthority: false,
} as const;

export interface WaitParalysisDiagnostic {
  readonly contractsEnumerated: number;
  readonly hardSafetyRejected: number;
  readonly strategyInapplicable: number;
  readonly softRanked: number;
  readonly unknownSafetyBlocked: number;
  readonly unknownOptionalEvidence: number;
  readonly aegisHold: number;
  readonly quantityZero: number;
  readonly economicallyDominated: number;
  readonly bestRejectedCandidate: string | null;
  readonly nearMisses: readonly string[];
  readonly finalWaitReason: string;
  readonly ratios: Readonly<Record<string, number | null>>;
}

export function buildWaitParalysisDiagnostic(frontier: CanonicalStrategyFrontier): WaitParalysisDiagnostic {
  const candidates = frontier.branches.flatMap((branch) => branch.candidates);
  const hardSafetyRejected = candidates.filter((candidate) => candidate.hardBlockers.length > 0).length;
  const unknownSafetyBlocked = candidates.filter((candidate) => candidate.hardBlockers.some((reason) => reason.includes('UNKNOWN'))).length;
  const unknownOptionalEvidence = candidates.filter((candidate) => candidate.unknownEvidence.length > 0).length;
  const aegisHold = candidates.filter((candidate) => candidate.hardBlockers.some((reason) => reason.startsWith('AEGIS_'))).length;
  const quantityZero = candidates.filter((candidate) => candidate.sizing.quantity === 0).length;
  const economicallyDominated = candidates.filter((candidate) => candidate.dominatedBy.length > 0).length;
  const denominator = candidates.length;
  const ratio = (value: number): number | null => denominator === 0 ? null : value / denominator;
  return {
    contractsEnumerated: denominator,
    hardSafetyRejected,
    strategyInapplicable: frontier.branches.filter((branch) => !branch.applicable).length,
    softRanked: frontier.branches.reduce((sum, branch) => sum + branch.softRanked, 0),
    unknownSafetyBlocked,
    unknownOptionalEvidence,
    aegisHold,
    quantityZero,
    economicallyDominated,
    bestRejectedCandidate: frontier.bestRejectedCandidateId,
    nearMisses: [frontier.nearMissCandidateId, frontier.secondBestCandidateId].filter((value): value is string => value !== null),
    finalWaitReason: frontier.globalWaitReasons.join('|') || 'NO_GLOBAL_WAIT',
    ratios: {
      hardSafetyRejected: ratio(hardSafetyRejected),
      unknownSafetyBlocked: ratio(unknownSafetyBlocked),
      unknownOptionalEvidence: ratio(unknownOptionalEvidence),
      aegisHold: ratio(aegisHold),
      quantityZero: ratio(quantityZero),
      economicallyDominated: ratio(economicallyDominated),
    },
  };
}

export interface OvertradingDiagnostic {
  readonly candidateAcceptanceRate: number | null;
  readonly newRiskFrequency: number | null;
  readonly capitalUtilization: number | null;
  readonly simultaneousChains: number;
  readonly correlatedExposure: number | null;
  readonly lowConfidenceTrades: number;
  readonly executionCost: number | null;
  readonly turnover: number | null;
  readonly policyState: 'OBSERVATIONAL_NO_EMPIRICAL_THRESHOLDS';
}

export function buildOvertradingDiagnostic(input: {
  candidateCount: number; acceptedCount: number; cycles: number; newRiskActions: number;
  capitalInUse: number | null; accountEquity: number | null; simultaneousChains: number;
  correlatedExposure: number | null; lowConfidenceTrades: number; executionCost: number | null;
  grossTradedNotional: number | null;
}): OvertradingDiagnostic {
  const safeRatio = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator : null;
  return {
    candidateAcceptanceRate: safeRatio(input.acceptedCount, input.candidateCount),
    newRiskFrequency: safeRatio(input.newRiskActions, input.cycles),
    capitalUtilization: input.capitalInUse === null || input.accountEquity === null || input.accountEquity <= 0
      ? null : input.capitalInUse / input.accountEquity,
    simultaneousChains: input.simultaneousChains,
    correlatedExposure: input.correlatedExposure,
    lowConfidenceTrades: input.lowConfidenceTrades,
    executionCost: input.executionCost,
    turnover: input.grossTradedNotional === null || input.accountEquity === null || input.accountEquity <= 0
      ? null : input.grossTradedNotional / input.accountEquity,
    policyState: 'OBSERVATIONAL_NO_EMPIRICAL_THRESHOLDS',
  };
}

export const fixedVsAdaptiveExperiments = [
  'FIXED_DTE_VS_ADAPTIVE_DTE',
  'FIXED_DELTA_VS_ADAPTIVE_STRIKE',
  'FIXED_TP_VS_MANAGEMENT_FRONTIER',
  'FIXED_SIZE_VS_STATE_AWARE_SIZE',
  'CONVENTIONAL_ONLY_VS_STRATEGY_FRONTIER',
  'STATIC_ROLL_VS_UTILITY_ROLL',
  'IMMEDIATE_CC_VS_RECOVERY_FRONTIER',
  'CURRENT_UNDERLYING_CAP_VS_WIDER_UNIVERSE',
] as const;

export interface AdaptiveShadowDecisionReceipt {
  readonly contractVersion: typeof adaptiveDecisionBrainVersion;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly currentPolicyDecision: {
    readonly action: CanonicalFrontierAction | 'GLOBAL_WAIT' | 'MANAGEMENT_AUTHORITY' | 'SYSTEM_HOLD';
    readonly candidateId: string | null;
    readonly quantity: number;
    readonly strategy: ThetaStrategyBranch | null;
  };
  readonly adaptiveShadowDecision: {
    readonly action: 'NO_COMPARISON' | 'STRUCTURAL_COMPARISON';
    readonly candidateId: null;
    readonly quantity: null;
    readonly strategy: null;
    readonly reasonCodes: readonly string[];
  };
  readonly lineage: readonly string[];
  readonly comparison: 'NO_COMPARISON' | 'STRUCTURAL_COMPARISON';
  readonly shadowComparison: ReturnType<typeof buildCanonicalShadowComparison>;
  readonly executionAuthorized: false;
  readonly brokerMutationAllowed: false;
  readonly contentHash: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function buildAdaptiveShadowDecisionReceipt(input: {
  frontier: Pick<CanonicalStrategyFrontier, 'snapshotId' | 'timestamp' | 'branches'>;
  currentDecision: {
    readonly actionCode: AdaptiveShadowDecisionReceipt['currentPolicyDecision']['action'];
    readonly selectedCandidateRef: string | null;
    readonly quantity: number;
    readonly strategyBranch: ThetaStrategyBranch | null;
  };
}): AdaptiveShadowDecisionReceipt {
  const shadowComparison = buildCanonicalShadowComparison(input.frontier);
  const payload = {
    contractVersion: adaptiveDecisionBrainVersion,
    snapshotId: input.frontier.snapshotId,
    observedAt: input.frontier.timestamp,
    currentPolicyDecision: {
      action: input.currentDecision.actionCode,
      candidateId: input.currentDecision.selectedCandidateRef,
      quantity: input.currentDecision.quantity,
      strategy: input.currentDecision.strategyBranch,
    },
    adaptiveShadowDecision: {
      action: shadowComparison.state,
      candidateId: null,
      quantity: null,
      strategy: null,
      reasonCodes: [
        'ADAPTIVE_POLICY_RESEARCH_ONLY', 'EMPIRICAL_UTILITY_NOT_PROMOTED',
        'NO_BROKER_AUTHORITY', 'NO_ADAPTIVE_ACTION_INFERRED',
      ],
    },
    lineage: sovereignDecisionPath,
    comparison: shadowComparison.state,
    shadowComparison,
    executionAuthorized: false as const,
    brokerMutationAllowed: false as const,
  };
  return { ...payload, contentHash: createHash('sha256').update(canonicalJson(payload)).digest('hex') };
}

export const adaptiveUtilityResearchContract = {
  expression: 'EV_NET-LAMBDA_ES*EXPECTED_SHORTFALL-LAMBDA_DD*DRAWDOWN_RISK-LAMBDA_CD*CAPITAL_DAYS-LAMBDA_AB*ASSIGNMENT_BURDEN-LAMBDA_EX*EXECUTION_COST-LAMBDA_CORR*CONCENTRATION-LAMBDA_U*MODEL_UNCERTAINTY',
  coefficients: 'UNKNOWN_NOT_EMPIRICALLY_GOVERNED',
  activationState: 'RESEARCH_ONLY',
  executionAuthorized: false,
} as const;
