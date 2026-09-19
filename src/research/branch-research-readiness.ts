import type { ThetaStrategyBranch } from '../theta/strategy-package.js';

export const branchResearchReadinessVersion = 'theta-branch-research-readiness-v1' as const;

export type ResearchBranch = Extract<ThetaStrategyBranch, 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK'>;
export type EvidenceState = 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface BranchResearchEvidence {
  readonly branch: ResearchBranch;
  readonly evaluatedCandidateCount: number;
  readonly exactContractIdentity: EvidenceState;
  readonly pointInTimeQuote: EvidenceState;
  readonly dteLattice: EvidenceState;
  readonly strikeLattice: EvidenceState;
  readonly liquidity: EvidenceState;
  readonly greeks: EvidenceState;
  readonly volatilityContext: EvidenceState;
  readonly eventContext: EvidenceState;
  readonly ownershipContext: EvidenceState;
  readonly assignmentCapacity: EvidenceState;
  readonly spreadPermission: EvidenceState;
  readonly boundedRiskEconomics: EvidenceState;
  readonly managementFrontier: EvidenceState;
  readonly outcomeLabelContract: EvidenceState;
  readonly strategyVersion: string;
  readonly featureVersion: string;
  readonly riskVersion: string;
  readonly executionVersion: string;
}

export interface BranchResearchReadiness {
  readonly contractVersion: typeof branchResearchReadinessVersion;
  readonly branch: ResearchBranch;
  readonly status: 'READY_FOR_SHADOW_EVIDENCE' | 'BLOCKED_MISSING_EVIDENCE' | 'NO_CANDIDATES_EVALUATED';
  readonly missingEvidence: readonly string[];
  readonly candidateCount: number;
  readonly executionAuthorized: false;
  readonly promotionEligible: false;
}

const commonRequired: readonly (keyof BranchResearchEvidence)[] = [
  'exactContractIdentity', 'pointInTimeQuote', 'dteLattice', 'strikeLattice', 'liquidity',
  'greeks', 'volatilityContext', 'eventContext', 'managementFrontier', 'outcomeLabelContract',
];

const branchRequired: Readonly<Record<ResearchBranch, readonly (keyof BranchResearchEvidence)[]>> = {
  THETA_HOLD_STRIKE: ['ownershipContext', 'assignmentCapacity'],
  THETA_DEFINED_RISK: ['spreadPermission', 'boundedRiskEconomics'],
};

export function assessBranchResearchReadiness(evidence: BranchResearchEvidence): BranchResearchReadiness {
  if (!Number.isInteger(evidence.evaluatedCandidateCount) || evidence.evaluatedCandidateCount < 0) {
    throw new Error('BRANCH_RESEARCH_CANDIDATE_COUNT_INVALID');
  }
  for (const [name, value] of Object.entries({
    strategyVersion:evidence.strategyVersion, featureVersion:evidence.featureVersion,
    riskVersion:evidence.riskVersion, executionVersion:evidence.executionVersion,
  })) if (!value.trim()) throw new Error(`BRANCH_RESEARCH_VERSION_MISSING:${name}`);

  const required = [...commonRequired, ...branchRequired[evidence.branch]];
  const missingEvidence = required.filter((key) => evidence[key] !== 'KNOWN').map(String).sort();
  const status = evidence.evaluatedCandidateCount === 0 ? 'NO_CANDIDATES_EVALUATED'
    : missingEvidence.length > 0 ? 'BLOCKED_MISSING_EVIDENCE' : 'READY_FOR_SHADOW_EVIDENCE';
  return {
    contractVersion: branchResearchReadinessVersion, branch:evidence.branch, status,
    missingEvidence, candidateCount:evidence.evaluatedCandidateCount,
    executionAuthorized:false, promotionEligible:false,
  };
}
