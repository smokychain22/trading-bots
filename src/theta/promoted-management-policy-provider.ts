import { createHash } from 'node:crypto';
import type { ManagementPolicyEvidenceProvider } from './autonomous-runtime.js';
import type { ManagementInputState } from './management-input-state.js';
import type { ManagementPolicyEvidence } from './management-action-frontier.js';
import {
  assessEmpiricalPolicyPromotion, empiricalPolicyPromotionReceiptSchema,
  type EmpiricalPolicyPromotionReceipt,
} from './empirical-policy-promotion.js';

export const promotedManagementPolicyProviderVersion='theta-promoted-management-policy-provider-v1' as const;
export interface ExplicitPolicyPromotion {
  readonly state:'PROMOTED';readonly policyVersion:string;readonly datasetHash:string;
  readonly approvedBy:string;readonly approvedAt:string;readonly governanceVersion:string;readonly contentHash:string;
}
export interface PromotedManagementPolicyArtifact {
  readonly receipt:EmpiricalPolicyPromotionReceipt;readonly promotion:ExplicitPolicyPromotion;
}
export type ManagementPolicyEvaluator=(state:ManagementInputState,artifact:PromotedManagementPolicyArtifact)=>Promise<ManagementPolicyEvidence|null>;

export function validateExplicitPromotion(artifact:PromotedManagementPolicyArtifact):readonly string[]{
  const blockers:string[]=[];
  const parsed=empiricalPolicyPromotionReceiptSchema.safeParse(artifact.receipt);
  if(!parsed.success)return ['PROMOTION_RECEIPT_INVALID'];
  const assessment=assessEmpiricalPolicyPromotion(parsed.data);
  if(!assessment.readyForHumanPromotionReview)blockers.push(...assessment.blockers);
  if(parsed.data.policyKind!=='MANAGEMENT')blockers.push('POLICY_KIND_NOT_MANAGEMENT');
  if(artifact.promotion.state!=='PROMOTED')blockers.push('EXPLICIT_PROMOTION_MISSING');
  if(artifact.promotion.policyVersion!==parsed.data.policyVersion)blockers.push('PROMOTION_POLICY_VERSION_MISMATCH');
  if(artifact.promotion.datasetHash!==parsed.data.datasetHash)blockers.push('PROMOTION_DATASET_HASH_MISMATCH');
  if(Date.parse(artifact.promotion.approvedAt)<=Date.parse(parsed.data.outOfSampleWindow.end))blockers.push('PROMOTION_PRECEDES_OOS_COMPLETION');
  const unsigned={state:artifact.promotion.state,policyVersion:artifact.promotion.policyVersion,datasetHash:artifact.promotion.datasetHash,
    approvedBy:artifact.promotion.approvedBy,approvedAt:artifact.promotion.approvedAt,governanceVersion:artifact.promotion.governanceVersion};
  const expected=createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  if(expected!==artifact.promotion.contentHash)blockers.push('PROMOTION_CONTENT_HASH_INVALID');
  return [...new Set(blockers)].sort();
}

export function createPromotedManagementPolicyProvider(
  artifact:PromotedManagementPolicyArtifact|null,evaluator:ManagementPolicyEvaluator,
):ManagementPolicyEvidenceProvider|null{
  if(artifact===null||validateExplicitPromotion(artifact).length>0)return null;
  return {evaluate:async(state)=>{
    const evidence=await evaluator(state,artifact);
    if(evidence===null||evidence.policyVersion!==artifact.receipt.policyVersion)return null;
    if(evidence.inputContentHash!==state.contentHash||evidence.decidedAt!==state.observedAt)return null;
    return evidence;
  }};
}
