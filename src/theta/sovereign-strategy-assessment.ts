import type {
  CanonicalBranchFrontier,
  CanonicalFrontierAction,
  CanonicalFrontierCandidate,
} from './canonical-strategy-frontier.js';
import type { ThetaStrategyBranch } from './strategy-package.js';
import type { MultiLegBrokerSupport } from '../research/defined-risk-locked-plan.js';

export const sovereignStrategyAssessmentVersion = 'theta-sovereign-strategy-assessment-v1' as const;
export const strategyPaperAdmissionContractVersion = 'theta-strategy-paper-admission-contract-v1' as const;

export type StrategyLeafState =
  | 'PAPER_ELIGIBLE'
  | 'ECONOMIC_REJECT'
  | 'MARKET_INAPPLICABLE'
  | 'CAPITAL_INCOMPATIBLE'
  | 'RISK_REJECT'
  | 'INSUFFICIENT_DATA'
  | 'SHADOW_ONLY'
  | 'NOT_TECHNICALLY_CERTIFIED'
  | 'NOT_PAPER_AUTHORIZED';

export type CanonicalStopClass =
  | 'AUTHORIZED_PAPER_ENTRY'
  | 'MANAGEMENT_AUTHORITY'
  | 'NO_AUTHORIZED_PAPER_ENTRY'
  | 'NO_STRUCTURAL_OPPORTUNITY'
  | 'REQUIRED_DATA_UNAVAILABLE'
  | 'INFRASTRUCTURE_FAILURE'
  | 'SYSTEM_HOLD';

export interface StrategyBranchExplanation {
  readonly branch: ThetaStrategyBranch;
  readonly role: 'NEW_RISK' | 'INVENTORY_LIFECYCLE';
  readonly applicable: boolean;
  readonly candidateCount: number;
  readonly finalistCandidateId: string | null;
  readonly leafState: StrategyLeafState;
  readonly leafReasons: readonly string[];
  readonly capitalState: 'FEASIBLE' | 'INCOMPATIBLE' | 'UNKNOWN' | 'NOT_APPLICABLE';
  readonly riskState: 'PERMITTED' | 'REJECTED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  readonly technicalCertification: 'CERTIFIED' | 'NOT_CERTIFIED' | 'NOT_APPLICABLE';
  readonly paperAuthorization: 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'NOT_APPLICABLE';
  readonly brokerAuthority: boolean;
}

export interface PaperAdmissionRequirement {
  readonly requirement: 'STRATEGY_IDENTITY' | 'CANDIDATE_LINEAGE' | 'COMPLETE_MARKET_EVIDENCE'
    | 'CONTRACT_IDENTITY' | 'ECONOMIC_STRUCTURE' | 'STRATEGY_SPECIFIC_AEGIS'
    | 'ACCOUNT_COMPATIBILITY' | 'POSITIVE_CANONICAL_QUANTITY' | 'BROKER_CAPABILITY'
    | 'EXECUTION_IMPLEMENTATION' | 'IDEMPOTENCY' | 'RECONCILIATION'
    | 'POSITION_MANAGEMENT_COVERAGE' | 'RESTART_RECOVERY' | 'EXPLICIT_PAPER_AUTHORIZATION';
  readonly state: 'SATISFIED' | 'UNSATISFIED' | 'UNKNOWN_UNVERIFIED';
  readonly reason: string;
}

export interface StrategyPaperAdmissionAssessment {
  readonly contractVersion: typeof strategyPaperAdmissionContractVersion;
  readonly branch: 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';
  readonly state: 'NOT_READY' | 'READY_AWAITING_OWNER_AUTHORIZATION';
  readonly requirements: readonly PaperAdmissionRequirement[];
  readonly paperAuthorized: false;
  readonly brokerAuthority: false;
}

export interface SovereignStrategyAssessment {
  readonly contractVersion: typeof sovereignStrategyAssessmentVersion;
  readonly authoritativePaperEligibility: {
    readonly branch: 'THETA_CONVENTIONAL';
    readonly state: 'ELIGIBLE' | 'INELIGIBLE' | 'SYSTEM_HOLD' | 'NOT_APPLICABLE';
    readonly selectedCandidateId: string | null;
    readonly selectedQuantity: number;
    readonly paperAuthorized: true;
    readonly shadowAlternativeCanOverride: false;
  };
  readonly shadowCrossStrategyOpportunity: {
    readonly state: 'STRUCTURAL_COMPARISON' | 'NOT_COMPARABLE';
    readonly candidateIds: readonly string[];
    readonly structuralLeaderCandidateIds: readonly string[];
    readonly empiricalUtilityState: 'EV_MODEL_NOT_EMPIRICALLY_READY';
    readonly brokerAuthority: false;
    readonly selectionAuthority: false;
  };
  readonly branchExplanations: readonly StrategyBranchExplanation[];
  readonly canonicalStopClass: CanonicalStopClass;
  readonly hPaperAdmission: StrategyPaperAdmissionAssessment;
  readonly dPaperAdmission: StrategyPaperAdmissionAssessment;
  readonly soleSelectionAuthority: 'CANONICAL_STRATEGY_FRONTIER';
  readonly routerAuthority: 'APPLICABILITY_ONLY';
}

const accountIncompatible = (candidate: CanonicalFrontierCandidate): boolean =>
  candidate.accountPolicyCompatibility?.accountFeasible === false
  || candidate.hardBlockers.some((reason) => reason.includes('ACCOUNT_POLICY') || reason.includes('BROKER_CAPACITY'))
  || candidate.sizing.bindingConstraint.includes('ACCOUNT_POLICY')
  || candidate.sizing.bindingConstraint.includes('BROKER_CAPACITY');

const riskUnknown = (candidate: CanonicalFrontierCandidate): boolean => candidate.aegisState === null
  || candidate.unknownEvidence.some((reason) => reason.includes('AEGIS_REQUIRED_INPUT_UNKNOWN')
    || reason.startsWith('EXECUTION_QUOTE_REQUIRED:'))
  || candidate.sizing.bindingConstraint.includes('UNKNOWN');

const riskRejected = (candidate: CanonicalFrontierCandidate): boolean =>
  candidate.aegisState === 'HARD_VETO' || candidate.aegisState === 'HOLD_ONLY'
  || candidate.aegisState === 'EMERGENCY_EXIT_ONLY'
  || candidate.hardBlockers.some((reason) => reason.startsWith('AEGIS_'));

function branchRole(branch: ThetaStrategyBranch): StrategyBranchExplanation['role'] {
  return branch === 'THETA_RECOVERY' || branch === 'THETA_CC' ? 'INVENTORY_LIFECYCLE' : 'NEW_RISK';
}

function branchFinalist(branch: CanonicalBranchFrontier): CanonicalFrontierCandidate | null {
  const finalistId = branch.bestCandidateId ?? branch.bestRejectedCandidateId;
  return finalistId === null ? branch.candidates[0] ?? null
    : branch.candidates.find((candidate) => candidate.candidateId === finalistId) ?? branch.candidates[0] ?? null;
}

function explainBranch(input: {
  readonly branch: CanonicalBranchFrontier;
  readonly primaryAction: CanonicalFrontierAction | 'GLOBAL_WAIT' | 'MANAGEMENT_AUTHORITY' | 'SYSTEM_HOLD';
  readonly selectedCandidateId: string | null;
}): StrategyBranchExplanation {
  const { branch } = input;
  const role = branchRole(branch.branch);
  const selectedQCandidate = branch.branch === 'THETA_CONVENTIONAL' && input.selectedCandidateId !== null
    ? branch.candidates.find((candidate) => candidate.candidateId === input.selectedCandidateId) ?? null
    : null;
  const finalist = selectedQCandidate ?? branchFinalist(branch);
  const routeReasons = branch.routeReasons.length > 0 ? [...branch.routeReasons] : ['ROUTER_REASON_NOT_RECORDED'];
  const base = {
    branch: branch.branch, role, applicable: branch.applicable, candidateCount: branch.candidateCount,
    finalistCandidateId: finalist?.candidateId ?? null, brokerAuthority: false,
  } as const;
  if (!branch.applicable) return { ...base, leafState: 'MARKET_INAPPLICABLE',
    leafReasons: role === 'INVENTORY_LIFECYCLE' ? ['NOT_APPLICABLE_NO_INVENTORY', ...routeReasons] : routeReasons,
    capitalState: 'NOT_APPLICABLE', riskState: 'NOT_APPLICABLE', technicalCertification: 'NOT_APPLICABLE',
    paperAuthorization: 'NOT_APPLICABLE' };
  if (branch.evaluationState === 'BRANCH_CONSTRUCTION_FAILED') return { ...base, leafState: 'INSUFFICIENT_DATA',
    leafReasons: ['BRANCH_CONSTRUCTION_FAILED', ...routeReasons], capitalState: 'UNKNOWN', riskState: 'UNKNOWN',
    technicalCertification: 'NOT_CERTIFIED', paperAuthorization: branch.branch === 'THETA_CONVENTIONAL' ? 'AUTHORIZED' : 'NOT_AUTHORIZED' };
  if (branch.evaluationState === 'BLOCKED_MISSING_INPUT' || finalist === null) return { ...base,
    leafState: branch.candidateCount === 0 && branch.evaluationState !== 'BLOCKED_MISSING_INPUT'
      ? 'MARKET_INAPPLICABLE' : 'INSUFFICIENT_DATA',
    leafReasons: [branch.evaluationState === 'BLOCKED_MISSING_INPUT' ? 'REQUIRED_BRANCH_INPUT_MISSING' : 'NO_STRUCTURAL_CANDIDATE', ...routeReasons],
    capitalState: 'UNKNOWN', riskState: 'UNKNOWN', technicalCertification: branch.branch === 'THETA_CONVENTIONAL' ? 'CERTIFIED' : 'NOT_CERTIFIED',
    paperAuthorization: branch.branch === 'THETA_CONVENTIONAL' ? 'AUTHORIZED' : 'NOT_AUTHORIZED' };
  if (accountIncompatible(finalist)) return { ...base, leafState: 'CAPITAL_INCOMPATIBLE',
    leafReasons: [finalist.sizing.bindingConstraint, ...(finalist.accountPolicyCompatibility?.reasons ?? [])],
    capitalState: 'INCOMPATIBLE', riskState: riskUnknown(finalist) ? 'UNKNOWN' : riskRejected(finalist) ? 'REJECTED' : 'PERMITTED',
    technicalCertification: branch.branch === 'THETA_CONVENTIONAL' ? 'CERTIFIED' : 'NOT_CERTIFIED',
    paperAuthorization: branch.branch === 'THETA_CONVENTIONAL' ? 'AUTHORIZED' : 'NOT_AUTHORIZED' };
  if (riskUnknown(finalist)) return { ...base, leafState: 'INSUFFICIENT_DATA',
    leafReasons: [...new Set([...finalist.unknownEvidence, ...finalist.sizing.reasons, finalist.sizing.bindingConstraint])],
    capitalState: 'FEASIBLE', riskState: 'UNKNOWN', technicalCertification: branch.branch === 'THETA_CONVENTIONAL' ? 'CERTIFIED' : 'NOT_CERTIFIED',
    paperAuthorization: branch.branch === 'THETA_CONVENTIONAL' ? 'AUTHORIZED' : 'NOT_AUTHORIZED' };
  if (riskRejected(finalist)) return { ...base, leafState: 'RISK_REJECT',
    leafReasons: [...new Set([...finalist.hardBlockers, ...finalist.sizing.reasons, finalist.sizing.bindingConstraint])],
    capitalState: 'FEASIBLE', riskState: 'REJECTED', technicalCertification: branch.branch === 'THETA_CONVENTIONAL' ? 'CERTIFIED' : 'NOT_CERTIFIED',
    paperAuthorization: branch.branch === 'THETA_CONVENTIONAL' ? 'AUTHORIZED' : 'NOT_AUTHORIZED' };
  if (branch.branch === 'THETA_CONVENTIONAL') {
    const selected = input.selectedCandidateId === finalist.candidateId && input.primaryAction === 'OPEN_CSP';
    return { ...base, leafState: selected ? 'PAPER_ELIGIBLE' : 'ECONOMIC_REJECT',
      leafReasons: selected ? ['CANONICAL_Q_SELECTION'] : ['THETA_Q_DID_NOT_SELECT_FINALIST'],
      capitalState: 'FEASIBLE', riskState: 'PERMITTED', technicalCertification: 'CERTIFIED', paperAuthorization: 'AUTHORIZED' };
  }
  return { ...base, leafState: 'SHADOW_ONLY',
    leafReasons: ['STRUCTURALLY_QUALIFIED_RESEARCH_ALTERNATIVE', 'NOT_TECHNICALLY_CERTIFIED', 'NOT_PAPER_AUTHORIZED'],
    capitalState: 'FEASIBLE', riskState: 'PERMITTED', technicalCertification: 'NOT_CERTIFIED', paperAuthorization: 'NOT_AUTHORIZED' };
}

function requirement(
  name: PaperAdmissionRequirement['requirement'],
  state: PaperAdmissionRequirement['state'],
  reason: string,
): PaperAdmissionRequirement {
  return { requirement: name, state, reason };
}

export function buildStrategyPaperAdmissionAssessments(input: {
  readonly hBranch: CanonicalBranchFrontier | undefined;
  readonly dBranch: CanonicalBranchFrontier | undefined;
  readonly dBrokerSupport: MultiLegBrokerSupport;
}): Pick<SovereignStrategyAssessment, 'hPaperAdmission' | 'dPaperAdmission'> {
  const common = (branch: CanonicalBranchFrontier | undefined): readonly PaperAdmissionRequirement[] => {
    const finalist = branch === undefined ? null : branchFinalist(branch);
    return [
      requirement('STRATEGY_IDENTITY', branch === undefined ? 'UNSATISFIED' : 'SATISFIED', branch === undefined ? 'CANONICAL_BRANCH_MISSING' : 'CANONICAL_BRANCH_IDENTITY'),
      requirement('CANDIDATE_LINEAGE', finalist === null ? 'UNSATISFIED' : 'SATISFIED', finalist === null ? 'NO_FINALIST_LINEAGE' : 'SNAPSHOT_BOUND_CANONICAL_CANDIDATE'),
      requirement('COMPLETE_MARKET_EVIDENCE', finalist !== null && finalist.unknownEvidence.length === 0 ? 'SATISFIED' : 'UNKNOWN_UNVERIFIED', finalist === null ? 'NO_FINALIST' : finalist.unknownEvidence.join('|') || 'COMPLETE_CURRENT_EVIDENCE'),
      requirement('CONTRACT_IDENTITY', finalist !== null && finalist.legs.every((leg) => leg.occSymbol === leg.optionSymbol && leg.contractTradable === true) ? 'SATISFIED' : 'UNSATISFIED', 'EXACT_OCC_AND_TRADABILITY_REQUIRED'),
      requirement('ECONOMIC_STRUCTURE', finalist?.structurallyFeasible === true ? 'SATISFIED' : 'UNSATISFIED', 'CANONICAL_STRATEGY_ECONOMICS'),
      requirement('STRATEGY_SPECIFIC_AEGIS', finalist !== null && ['ALLOW_FULL', 'ALLOW_REDUCED', 'DEFINED_RISK_ONLY'].includes(finalist.aegisState ?? '') ? 'SATISFIED' : 'UNKNOWN_UNVERIFIED', 'CANDIDATE_BOUND_STRATEGY_RISK_REQUIRED'),
      requirement('ACCOUNT_COMPATIBILITY', finalist?.accountPolicyCompatibility?.accountFeasible === true ? 'SATISFIED' : 'UNKNOWN_UNVERIFIED', 'STRATEGY_SPECIFIC_ACCOUNT_POLICY_REQUIRED'),
      requirement('POSITIVE_CANONICAL_QUANTITY', (finalist?.sizing.quantity ?? 0) > 0 ? 'SATISFIED' : 'UNSATISFIED', 'POSITIVE_WHOLE_STRATEGY_UNIT_REQUIRED'),
    ];
  };
  const hRequirements = [
    ...common(input.hBranch),
    requirement('BROKER_CAPABILITY', 'SATISFIED', 'ALPACA_SINGLE_LEG_OPTION_ORDER_PATH_EXISTS'),
    requirement('EXECUTION_IMPLEMENTATION', 'UNSATISFIED', 'H_MASTER_PAPER_HANDOFF_NOT_IMPLEMENTED'),
    requirement('IDEMPOTENCY', 'UNSATISFIED', 'H_IDEMPOTENT_ORDER_IDENTITY_NOT_CERTIFIED'),
    requirement('RECONCILIATION', 'UNSATISFIED', 'H_ORDER_RECONCILIATION_NOT_CERTIFIED'),
    requirement('POSITION_MANAGEMENT_COVERAGE', 'UNSATISFIED', 'H_SHORT_DTE_LIFECYCLE_NOT_CERTIFIED'),
    requirement('RESTART_RECOVERY', 'UNSATISFIED', 'H_RESTART_RECOVERY_NOT_CERTIFIED'),
    requirement('EXPLICIT_PAPER_AUTHORIZATION', 'UNSATISFIED', 'OWNER_AUTHORIZATION_NOT_GRANTED'),
  ];
  const dBrokerState = input.dBrokerSupport === 'ATOMIC_MULTI_LEG_SUPPORTED' ? 'SATISFIED'
    : input.dBrokerSupport === 'PROVIDER_LIMITED' || input.dBrokerSupport === 'LEG_BY_LEG_ONLY' ? 'UNSATISFIED' : 'UNKNOWN_UNVERIFIED';
  const dRequirements = [
    ...common(input.dBranch),
    requirement('BROKER_CAPABILITY', dBrokerState, `ALPACA_MULTI_LEG:${input.dBrokerSupport}`),
    requirement('EXECUTION_IMPLEMENTATION', 'UNSATISFIED', 'ATOMIC_MLEG_MUTATION_ADAPTER_NOT_IMPLEMENTED'),
    requirement('IDEMPOTENCY', 'UNSATISFIED', 'MLEG_PARENT_AND_LEG_IDEMPOTENCY_NOT_CERTIFIED'),
    requirement('RECONCILIATION', 'UNSATISFIED', 'MLEG_PARENT_LEG_PARTIAL_FILL_RECONCILIATION_NOT_CERTIFIED'),
    requirement('POSITION_MANAGEMENT_COVERAGE', 'UNSATISFIED', 'D_ASSIGNMENT_EXPIRY_MANAGEMENT_NOT_CERTIFIED'),
    requirement('RESTART_RECOVERY', 'UNSATISFIED', 'MLEG_RESTART_RECOVERY_NOT_CERTIFIED'),
    requirement('EXPLICIT_PAPER_AUTHORIZATION', 'UNSATISFIED', 'OWNER_AUTHORIZATION_NOT_GRANTED'),
  ];
  const build = <B extends 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK'>(branch: B, requirements: readonly PaperAdmissionRequirement[]): StrategyPaperAdmissionAssessment => ({
    contractVersion: strategyPaperAdmissionContractVersion, branch,
    state: requirements.every((item) => item.state === 'SATISFIED') ? 'READY_AWAITING_OWNER_AUTHORIZATION' : 'NOT_READY',
    requirements, paperAuthorized: false, brokerAuthority: false,
  });
  return { hPaperAdmission: build('THETA_HOLD_STRIKE', hRequirements), dPaperAdmission: build('THETA_DEFINED_RISK', dRequirements) };
}

export function buildSovereignStrategyAssessment(input: {
  readonly branches: readonly CanonicalBranchFrontier[];
  readonly primaryAction: CanonicalFrontierAction | 'GLOBAL_WAIT' | 'MANAGEMENT_AUTHORITY' | 'SYSTEM_HOLD';
  readonly selectedCandidateId: string | null;
  readonly selectedQuantity: number;
  readonly globalWaitEarned: boolean;
  readonly paperEvaluationCoverageState: 'COMPLETE' | 'INCOMPLETE' | 'STRUCTURAL_ONLY';
  readonly shadowComparison: {
    readonly state: 'STRUCTURAL_COMPARISON' | 'NO_COMPARISON';
    readonly cohorts: readonly { readonly structuralParetoCandidateIds: readonly string[]; readonly sourceCandidateIds: readonly string[] }[];
  };
  readonly dBrokerSupport: MultiLegBrokerSupport;
}): SovereignStrategyAssessment {
  const branchExplanations = input.branches.map((branch) => explainBranch({ branch,
    primaryAction: input.primaryAction, selectedCandidateId: input.selectedCandidateId }));
  const q = branchExplanations.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const constructionFailure = input.branches.some((branch) => branch.applicable && branch.evaluationState === 'BRANCH_CONSTRUCTION_FAILED');
  const requiredDataUnavailable = input.paperEvaluationCoverageState === 'INCOMPLETE'
    || q?.leafState === 'INSUFFICIENT_DATA';
  const applicableNewRisk = input.branches.filter((branch) => branch.applicable
    && ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'].includes(branch.branch));
  const noStructuralCandidate = applicableNewRisk.length > 0 && applicableNewRisk.every((branch) => branch.candidateCount === 0);
  const canonicalStopClass: CanonicalStopClass = input.primaryAction === 'OPEN_CSP'
    ? 'AUTHORIZED_PAPER_ENTRY'
    : input.primaryAction === 'MANAGEMENT_AUTHORITY' ? 'MANAGEMENT_AUTHORITY'
      : constructionFailure ? 'INFRASTRUCTURE_FAILURE'
        : requiredDataUnavailable ? 'REQUIRED_DATA_UNAVAILABLE'
          : input.primaryAction === 'SYSTEM_HOLD' ? 'SYSTEM_HOLD'
            : noStructuralCandidate ? 'NO_STRUCTURAL_OPPORTUNITY'
              : 'NO_AUTHORIZED_PAPER_ENTRY';
  const paperState = input.primaryAction === 'OPEN_CSP' && input.selectedCandidateId !== null && input.selectedQuantity > 0
    ? 'ELIGIBLE' as const : input.primaryAction === 'SYSTEM_HOLD' ? 'SYSTEM_HOLD' as const
      : q?.applicable === false ? 'NOT_APPLICABLE' as const : 'INELIGIBLE' as const;
  const candidateIds = input.shadowComparison.cohorts.flatMap((cohort) => cohort.sourceCandidateIds);
  const structuralLeaderCandidateIds = input.shadowComparison.cohorts.flatMap((cohort) => cohort.structuralParetoCandidateIds);
  const admissions = buildStrategyPaperAdmissionAssessments({
    hBranch: input.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE'),
    dBranch: input.branches.find((branch) => branch.branch === 'THETA_DEFINED_RISK'),
    dBrokerSupport: input.dBrokerSupport,
  });
  return {
    contractVersion: sovereignStrategyAssessmentVersion,
    authoritativePaperEligibility: { branch: 'THETA_CONVENTIONAL', state: paperState,
      selectedCandidateId: input.selectedCandidateId, selectedQuantity: input.selectedQuantity,
      paperAuthorized: true, shadowAlternativeCanOverride: false },
    shadowCrossStrategyOpportunity: {
      state: input.shadowComparison.state === 'STRUCTURAL_COMPARISON' ? 'STRUCTURAL_COMPARISON' : 'NOT_COMPARABLE',
      candidateIds: [...new Set(candidateIds)].toSorted(),
      structuralLeaderCandidateIds: [...new Set(structuralLeaderCandidateIds)].toSorted(),
      empiricalUtilityState: 'EV_MODEL_NOT_EMPIRICALLY_READY', brokerAuthority: false, selectionAuthority: false,
    },
    branchExplanations, canonicalStopClass, ...admissions,
    soleSelectionAuthority: 'CANONICAL_STRATEGY_FRONTIER', routerAuthority: 'APPLICABILITY_ONLY',
  };
}
