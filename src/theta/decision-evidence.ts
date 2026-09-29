import { z } from 'zod';
import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import { jsonValueSchema } from '../market/fusion-snapshot.js';

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
  value: jsonValueSchema,
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
  'NO_VALID_CONTRACT',
  'NO_POSITIVE_EDGE',
  'RISK_VETO',
  'PORTFOLIO_CAPACITY',
  'STRATEGY_INAPPLICABLE',
  'EXECUTION_UNQUALIFIED',
]);

export interface GlobalWaitEvidence {
  readonly reason: z.infer<typeof globalWaitReason>;
  readonly eligibleUnderlyingCount: number;
  readonly underlyingsEvaluated: number;
  readonly contractsEvaluated: number;
  readonly hardSafetyRejected: number;
  readonly strategyInapplicable: number;
  readonly softRanked: number;
  readonly unknownSafetyBlocked: number;
  readonly unknownOptionalEvidence: number;
  readonly unclassifiedUnknownEvidence: number;
  readonly aegisHeld: number;
  readonly quantityZero: number;
  readonly economicallyDominated: number;
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
  readonly unclassifiedUnknownReasons: readonly string[];
  readonly nearMissCandidateIds: readonly string[];
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
  for (const [name,value] of Object.entries({hardSafetyRejected:input.hardSafetyRejected,
    strategyInapplicable:input.strategyInapplicable,softRanked:input.softRanked,
    unknownSafetyBlocked:input.unknownSafetyBlocked,unknownOptionalEvidence:input.unknownOptionalEvidence,
    unclassifiedUnknownEvidence:input.unclassifiedUnknownEvidence,aegisHeld:input.aegisHeld,
    quantityZero:input.quantityZero,economicallyDominated:input.economicallyDominated})) {
    if (!Number.isInteger(value)||value<0) violations.push(`WAIT_DECOMPOSITION_COUNT_INVALID:${name}`);
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
  if (input.unclassifiedUnknownReasons.length > 0) violations.push('UNCLASSIFIED_UNKNOWN_EVIDENCE');
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

const requiredUnknownReason=(reason:string):boolean => reason==='AEGIS_STATE_UNKNOWN'
  ||reason==='ASSIGNMENT_CAPACITY_UNKNOWN'||reason==='EVENT_STATE_UNKNOWN'||reason==='DELTA_UNKNOWN'
  ||reason==='OPEN_INTEREST_UNKNOWN'||reason==='VOLUME_UNKNOWN'||reason.startsWith('EXECUTION_QUOTE_REQUIRED:');

const optionalUnknownReason=(reason:string):boolean => reason==='IV_UNKNOWN';

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
  const unknownReasons=candidates.flatMap((candidate)=>candidate.unknownEvidence.map((reason)=>({candidateId:candidate.candidateId,reason})));
  const unclassifiedUnknownReasons=[...new Set(unknownReasons.filter(({reason})=>
    !requiredUnknownReason(reason)&&!optionalUnknownReason(reason)).map(({reason})=>reason))].toSorted();
  const countUnknownCandidates=(predicate:(reason:string)=>boolean):number=>new Set(unknownReasons
    .filter(({reason})=>predicate(reason)).map(({candidateId})=>candidateId)).size;
  const unknownSafetyBlocked=countUnknownCandidates(requiredUnknownReason);
  const unknownOptionalEvidence=countUnknownCandidates(optionalUnknownReason);
  const unclassifiedUnknownEvidence=countUnknownCandidates((value)=>!requiredUnknownReason(value)&&!optionalUnknownReason(value));
  const hardKeys=new Set(Object.keys(hardGateCounts));
  const sizingZeroCandidates=candidates.filter((candidate)=>candidate.sizing.quantity===0);
  const aegisHeld=sizingZeroCandidates.filter((candidate)=>candidate.sizing.bindingConstraint?.startsWith('AEGIS_')===true
    ||candidate.hardBlockers.some((value)=>value.startsWith('AEGIS_'))).length;
  const capacityZero=sizingZeroCandidates.some((candidate)=>['RISK_BUDGET','COLLATERAL_CAP','CONCENTRATION_CAP',
    'ASSIGNMENT_CAPACITY_CAP','TAIL_RISK_CAP','CORRELATION_CAP','LIQUIDITY_CAP','BROKER_ALLOWED',
    'BUYING_POWER_AFFORDABLE','REAL_ASSIGNMENT_CAPACITY'].includes(candidate.sizing.bindingConstraint??''));
  const reason:GlobalWaitEvidence['reason']=hardKeys.has('STRATEGY_EVALUATION_INVALID')
    ||unknownSafetyBlocked>0||unclassified.size>0||unclassifiedUnknownReasons.length>0?'DATA_INSUFFICIENT'
    :hardKeys.has('AEGIS_HARD_VETO')||aegisHeld>0?'RISK_VETO'
      :hardKeys.has('EXECUTABLE_QUOTE_UNAVAILABLE')?'EXECUTION_UNQUALIFIED'
        :hardKeys.has('COLLATERAL_INSUFFICIENT')||hardKeys.has('ASSIGNMENT_CAPACITY_INSUFFICIENT')||capacityZero?'PORTFOLIO_CAPACITY'
          :hardKeys.has('ACCOUNT_STATE_INCOMPATIBLE')?'STRATEGY_INAPPLICABLE'
            :paperBranches.length>0&&paperBranches.every((branch)=>!branch.applicable)?'STRATEGY_INAPPLICABLE'
            :hardKeys.has('INVALID_CONTRACT')||candidates.length===0?'NO_VALID_CONTRACT'
              :hardKeys.has('STRATEGY_ECONOMIC_REJECT')?'NO_POSITIVE_EDGE':'NO_RISK_FEASIBLE_CANDIDATE';
  const eligiblePaperBranches=input.frontier.branchesConsidered.filter((branch)=>branch==='THETA_CONVENTIONAL');
  const evaluatedPaperBranches=input.frontier.branchesEvaluated.filter((branch)=>branch==='THETA_CONVENTIONAL');
  return {reason,eligibleUnderlyingCount:input.eligibleUnderlyingCount,underlyingsEvaluated:input.underlyingsEvaluated,
    contractsEvaluated:candidates.length,
    hardSafetyRejected:candidates.filter((candidate)=>candidate.hardBlockers.some((blocker)=>{
      const category=blockerClass(blocker);
      return category!==null&&!['STRATEGY_ECONOMIC_REJECT','STRATEGY_EVALUATION_INVALID','ACCOUNT_STATE_INCOMPATIBLE'].includes(category);
    })).length,
    strategyInapplicable:paperBranches.filter((branch)=>!branch.applicable).length,
    softRanked:paperBranches.reduce((sum,branch)=>sum+branch.softRanked,0),
    unknownSafetyBlocked,unknownOptionalEvidence,unclassifiedUnknownEvidence,aegisHeld,
    quantityZero:sizingZeroCandidates.length,
    economicallyDominated:candidates.filter((candidate)=>candidate.dominatedBy.length>0).length,
    validatedBranchesEligible:eligiblePaperBranches,
    validatedBranchesEvaluated:evaluatedPaperBranches,
    existingPositionManagementEvaluated:input.existingPositionManagementEvaluated,
    recoveryOpportunitiesEvaluated:input.recoveryOpportunitiesEvaluated,
    coveredCallOpportunitiesEvaluated:input.coveredCallOpportunitiesEvaluated,
    redeploymentAlternativesEvaluated:input.redeploymentAlternativesEvaluated,hardGateCounts,
    softEvidenceFamiliesObserved,blockedBranches,unclassifiedHardBlockers:[...unclassified].toSorted(),
    unclassifiedUnknownReasons,nearMissCandidateIds:[input.frontier.nearMissCandidateId,input.frontier.secondBestCandidateId]
      .filter((value):value is string=>value!==null&&value!==undefined),
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
