import { z } from 'zod';
import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';

export const decisionEvidenceVersion = 'theta-decision-evidence-v1' as const;

export const hardGateCode = z.enum([
  'BROKER_DATA_INVALID',
  'BROKER_DATA_STALE',
  'UNSUPPORTED_SESSION',
  'INVALID_CONTRACT',
  'MULTIPLIER_UNKNOWN',
  'EXECUTABLE_QUOTE_UNAVAILABLE',
  'QUANTITY_ZERO',
  'COLLATERAL_INSUFFICIENT',
  'ASSIGNMENT_CAPACITY_INSUFFICIENT',
  'AEGIS_HARD_VETO',
  'ACCOUNT_STATE_INCOMPATIBLE',
  'LIFECYCLE_TRUTH_BROKEN',
  'IDEMPOTENCY_CONFLICT',
  'STRATEGY_ECONOMIC_REJECT',
  'STRATEGY_EVALUATION_INVALID',
]);

export const softEvidenceFamily = z.enum([
  'RSI', 'TREND', 'MOMENTUM', 'IV', 'SKEW', 'TERM_STRUCTURE', 'FLOW',
  'VOLUME_OPEN_INTEREST', 'EVENT_CONTEXT', 'OWNERSHIP', 'REGIME',
]);

export const evidenceState = z.enum(['GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED']);

export const decisionEvidenceItemSchema = z.object({
  family: z.string().min(1),
  category: z.enum(['HARD_GATE', 'SOFT_EVIDENCE']),
  code: z.string().min(1),
  state: evidenceState,
  value: z.unknown(),
  provenance: z.object({
    provider: z.string().min(1),
    operationAlias: z.string().min(1),
    asOf: z.string().datetime({ offset: true }).nullable(),
    retrievedAt: z.string().datetime({ offset: true }),
  }),
});

export type DecisionEvidenceItem = z.infer<typeof decisionEvidenceItemSchema>;
export type HardGateCode = z.infer<typeof hardGateCode>;

export const globalWaitReason = z.enum([
  'NO_POSITIVE_AFTER_COST_EV',
  'NO_RISK_FEASIBLE_CANDIDATE',
  'CAPITAL_UNAVAILABLE',
  'HARD_AEGIS_VETO',
  'DATA_INSUFFICIENT',
  'UNSUPPORTED_SESSION',
  'EXECUTION_NOT_FEASIBLE',
]);

export interface GlobalWaitEvidence {
  readonly reason: z.infer<typeof globalWaitReason>;
  readonly eligibleUnderlyingCount: number;
  readonly underlyingsEvaluated: number;
  readonly contractsEvaluated: number;
  readonly validatedBranchesEligible: readonly string[];
  readonly validatedBranchesEvaluated: readonly string[];
  readonly existingPositionManagementEvaluated: boolean;
  readonly recoveryOpportunitiesEvaluated: boolean;
  readonly coveredCallOpportunitiesEvaluated: boolean;
  readonly redeploymentAlternativesEvaluated: boolean;
  readonly hardGateCounts: Readonly<Partial<Record<HardGateCode, number>>>;
  readonly softEvidenceFamiliesObserved: readonly z.infer<typeof softEvidenceFamily>[];
  readonly blockedBranches: Readonly<Record<string, readonly string[]>>;
  readonly unclassifiedHardBlockers: readonly string[];
  readonly bestCandidateId: string | null;
  readonly secondBestCandidateId: string | null;
  readonly bestRejectedCandidateId: string | null;
}

export interface GlobalWaitValidation {
  readonly earned: boolean;
  readonly violations: readonly string[];
}

/** A global WAIT is valid only after the currently eligible search surface was exhausted. */
export function validateGlobalWaitEvidence(input: GlobalWaitEvidence): GlobalWaitValidation {
  const violations: string[] = [];
  if (!Number.isInteger(input.eligibleUnderlyingCount) || input.eligibleUnderlyingCount < 0) {
    violations.push('ELIGIBLE_UNDERLYING_COUNT_INVALID');
  }
  if (input.underlyingsEvaluated !== input.eligibleUnderlyingCount) {
    violations.push('ELIGIBLE_UNIVERSE_NOT_EXHAUSTED');
  }
  if (!Number.isInteger(input.contractsEvaluated) || input.contractsEvaluated < 0) {
    violations.push('CONTRACT_COUNT_INVALID');
  }
  const evaluated = new Set(input.validatedBranchesEvaluated);
  if (input.validatedBranchesEligible.some((branch) => !evaluated.has(branch))) {
    violations.push('VALIDATED_BRANCHES_NOT_EXHAUSTED');
  }
  if (!input.existingPositionManagementEvaluated) violations.push('MANAGEMENT_FRONTIER_NOT_EVALUATED');
  if (!input.recoveryOpportunitiesEvaluated) violations.push('RECOVERY_FRONTIER_NOT_EVALUATED');
  if (!input.coveredCallOpportunitiesEvaluated) violations.push('COVERED_CALL_FRONTIER_NOT_EVALUATED');
  if (!input.redeploymentAlternativesEvaluated) violations.push('REDEPLOYMENT_FRONTIER_NOT_EVALUATED');
  if (input.bestCandidateId !== null && input.secondBestCandidateId === input.bestCandidateId) {
    violations.push('SECOND_BEST_DUPLICATES_BEST');
  }
  if (input.bestRejectedCandidateId !== null && input.bestRejectedCandidateId === input.bestCandidateId) {
    violations.push('BEST_REJECTED_DUPLICATES_SELECTED');
  }
  if (input.unclassifiedHardBlockers.length > 0) violations.push('UNCLASSIFIED_HARD_BLOCKERS');
  return { earned: violations.length === 0, violations };
}

const blockerClass = (reason:string):HardGateCode|null => {
  if(reason.startsWith('AEGIS_'))return 'AEGIS_HARD_VETO';
  if(reason.startsWith('EXECUTION_QUOTE_REQUIRED:')||reason.includes('EXECUTABLE_STOCK_PRICE'))return 'EXECUTABLE_QUOTE_UNAVAILABLE';
  if(reason.includes('MULTIPLIER'))return 'MULTIPLIER_UNKNOWN';
  if(reason==='NO_ASSIGNMENT_CAPACITY')return 'ASSIGNMENT_CAPACITY_INSUFFICIENT';
  if(reason==='ROUTER_NOT_APPLICABLE'||reason.includes('STOCK_INVENTORY'))return 'ACCOUNT_STATE_INCOMPATIBLE';
  if(reason.startsWith('THETA_Q_INFEASIBLE_REASON:')||reason==='THETA_Q_ACTION_INFEASIBLE')return 'STRATEGY_ECONOMIC_REJECT';
  if(reason.startsWith('THETA_Q_NOT_SENT_UPSTREAM_REJECT:')||reason==='THETA_Q_EVALUATION_STATE_MISSING'
    ||reason==='THETA_Q_RESPONSE_GAP')return 'STRATEGY_EVALUATION_INVALID';
  if(reason.includes('OCC_')||reason.includes('SPREAD')||reason.includes('EXPIRATION')
    ||reason.includes('NET_CREDIT')||reason.includes('CONTRACT'))return 'INVALID_CONTRACT';
  return null;
};

const softFamily=(reason:string):z.infer<typeof softEvidenceFamily>|null => {
  const prefix=reason.split(':',1)[0];
  const map:Readonly<Record<string,z.infer<typeof softEvidenceFamily>>>={
    EVENT_STATE:'EVENT_CONTEXT',TREND:'TREND',MOMENTUM:'MOMENTUM',IV:'IV',SKEW:'SKEW',
    TERM_STRUCTURE:'TERM_STRUCTURE',FLOW:'FLOW',VOLUME:'VOLUME_OPEN_INTEREST',OPEN_INTEREST:'VOLUME_OPEN_INTEREST',
    OWNERSHIP:'OWNERSHIP',REGIME:'REGIME',RSI:'RSI',
  };
  return map[prefix??'']??null;
};

export function buildGlobalWaitEvidenceFromFrontier(input:{
  readonly frontier:CanonicalStrategyFrontier;
  readonly eligibleUnderlyingCount:number;
  readonly underlyingsEvaluated:number;
  readonly existingPositionManagementEvaluated:boolean;
  readonly recoveryOpportunitiesEvaluated:boolean;
  readonly coveredCallOpportunitiesEvaluated:boolean;
  readonly redeploymentAlternativesEvaluated:boolean;
}):GlobalWaitEvidence{
  // Global WAIT is the Production-facing new-risk conclusion. Shadow and
  // research branches stay visible in blockedBranches, but their candidate
  // gaps must never poison Q's otherwise-complete Paper search.
  const paperBranches=input.frontier.branches.filter((branch)=>branch.branch==='THETA_CONVENTIONAL');
  const candidates=paperBranches.flatMap((branch)=>branch.candidates);
  const hardGateCounts:Partial<Record<HardGateCode,number>>={};
  const unclassified=new Set<string>();
  for(const reason of candidates.flatMap((candidate)=>candidate.hardBlockers)){
    const category=blockerClass(reason);
    if(category===null)unclassified.add(reason);
    else hardGateCounts[category]=(hardGateCounts[category]??0)+1;
  }
  const blockedBranches=Object.fromEntries(input.frontier.branches
    .filter((branch)=>branch.evaluationState!=='EVALUATED')
    .map((branch)=>[branch.branch,[branch.evaluationState,...branch.routeReasons].filter((reason,index,all)=>all.indexOf(reason)===index)]));
  const softEvidenceFamiliesObserved=[...new Set(candidates.flatMap((candidate)=>candidate.softEvidence)
    .map(softFamily).filter((family):family is z.infer<typeof softEvidenceFamily>=>family!==null))].toSorted();
  const hardKeys=new Set(Object.keys(hardGateCounts));
  const reason:GlobalWaitEvidence['reason']=hardKeys.has('AEGIS_HARD_VETO')?'HARD_AEGIS_VETO'
    :hardKeys.has('EXECUTABLE_QUOTE_UNAVAILABLE')?'EXECUTION_NOT_FEASIBLE'
      :hardKeys.has('COLLATERAL_INSUFFICIENT')||hardKeys.has('ASSIGNMENT_CAPACITY_INSUFFICIENT')?'CAPITAL_UNAVAILABLE'
        :unclassified.size>0?'DATA_INSUFFICIENT':'NO_RISK_FEASIBLE_CANDIDATE';
  const eligiblePaperBranches=input.frontier.branchesConsidered.filter((branch)=>branch==='THETA_CONVENTIONAL');
  const evaluatedPaperBranches=input.frontier.branchesEvaluated.filter((branch)=>branch==='THETA_CONVENTIONAL');
  return {reason,eligibleUnderlyingCount:input.eligibleUnderlyingCount,underlyingsEvaluated:input.underlyingsEvaluated,
    contractsEvaluated:candidates.length,validatedBranchesEligible:eligiblePaperBranches,
    validatedBranchesEvaluated:evaluatedPaperBranches,
    existingPositionManagementEvaluated:input.existingPositionManagementEvaluated,
    recoveryOpportunitiesEvaluated:input.recoveryOpportunitiesEvaluated,
    coveredCallOpportunitiesEvaluated:input.coveredCallOpportunitiesEvaluated,
    redeploymentAlternativesEvaluated:input.redeploymentAlternativesEvaluated,hardGateCounts,
    softEvidenceFamiliesObserved,blockedBranches,unclassifiedHardBlockers:[...unclassified].toSorted(),
    bestCandidateId:input.frontier.selectedCandidateId,secondBestCandidateId:input.frontier.secondBestCandidateId,
    bestRejectedCandidateId:input.frontier.bestRejectedCandidateId};
}

export function splitDecisionEvidence(items: readonly DecisionEvidenceItem[]): {
  readonly hardBlockers: readonly DecisionEvidenceItem[];
  readonly softEvidence: readonly DecisionEvidenceItem[];
} {
  const parsed = items.map((item) => decisionEvidenceItemSchema.parse(item));
  return {
    hardBlockers: parsed.filter((item) => item.category === 'HARD_GATE' && item.state !== 'GOOD'),
    softEvidence: parsed.filter((item) => item.category === 'SOFT_EVIDENCE'),
  };
}
