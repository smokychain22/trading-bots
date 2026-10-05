import { createHash } from 'node:crypto';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import {
  validateModelRegistryRecord, type ModelRegistryRecord,
} from '../research/empirical-model-registry.js';
import { entryModelTargets, type EntryModelTarget } from '../research/theta-entry-model-readiness.js';
import {
  assessEmpiricalPolicyPromotion, empiricalPolicyPromotionReceiptSchema,
  type EmpiricalPolicyPromotionReceipt,
} from './empirical-policy-promotion.js';
import type { StrategyRoutingResponse } from './strategy-router-contract.js';

export const promotedDecisionPolicyProviderVersion = 'theta-promoted-decision-policy-provider-v1' as const;

export interface ExplicitArtifactApproval {
  readonly state: 'PROMOTED';
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly governanceVersion: string;
  readonly evidenceHash: string;
  readonly contentHash: string;
}

export interface PromotedEntryModelArtifact {
  readonly registryRecord: ModelRegistryRecord;
  readonly approval: ExplicitArtifactApproval;
}

export interface EntryModelDecisionInput {
  readonly snapshotId: string;
  readonly decisionAt: string;
  readonly candidateIds: readonly string[];
  readonly featureSetVersion: string;
  readonly featureContentHash: string;
}

export interface PromotedEntryCandidateEvidence {
  readonly candidateId: string;
  readonly targetId: EntryModelTarget;
  readonly value: number;
  readonly calibratedUncertainty: number;
}

export interface PromotedEntryModelDecision {
  readonly contractVersion: typeof promotedDecisionPolicyProviderVersion;
  readonly snapshotId: string;
  readonly decisionAt: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly targetId: EntryModelTarget;
  readonly datasetHash: string;
  readonly artifactHash: string;
  readonly featureSetVersion: string;
  readonly featureContentHash: string;
  readonly evidenceAvailableAt: string;
  readonly predictions: readonly PromotedEntryCandidateEvidence[];
  readonly brokerAuthority: false;
  readonly executionAuthorized: false;
}

export type EntryModelEvaluator = (input: EntryModelDecisionInput,
  artifact: PromotedEntryModelArtifact) => Promise<PromotedEntryModelDecision>;

function approvalContentHash(approval: Omit<ExplicitArtifactApproval, 'contentHash'>): string {
  return createHash('sha256').update(canonicalJson(approval)).digest('hex');
}

export function validatePromotedEntryModelArtifact(artifact: PromotedEntryModelArtifact): readonly string[] {
  const blockers: string[] = [];
  try { validateModelRegistryRecord(artifact.registryRecord); }
  catch { blockers.push('ENTRY_MODEL_REGISTRY_RECORD_INVALID'); }
  const record = artifact.registryRecord;
  if (!entryModelTargets.includes(record.targetId as EntryModelTarget)) blockers.push('ENTRY_MODEL_TARGET_INVALID');
  if (record.promotionState !== 'PAPER_PROMOTED') blockers.push('ENTRY_MODEL_NOT_PAPER_PROMOTED');
  if (record.finalOosWindow === null) blockers.push('ENTRY_MODEL_OOS_WINDOW_MISSING');
  if (record.calibrationMethod === null || record.calibrationArtifactHash === null) blockers.push('ENTRY_MODEL_CALIBRATION_MISSING');
  if (record.metrics.independentN === null || record.metrics.independentN <= 0) blockers.push('ENTRY_MODEL_INDEPENDENT_N_MISSING');
  if (record.metrics.brierScore === null || record.metrics.logLoss === null) blockers.push('ENTRY_MODEL_CALIBRATION_METRICS_MISSING');
  const evidenceHash = createHash('sha256').update(canonicalJson(record)).digest('hex');
  if (artifact.approval.state !== 'PROMOTED') blockers.push('ENTRY_MODEL_EXPLICIT_APPROVAL_MISSING');
  if (!artifact.approval.approvedBy.trim() || !artifact.approval.governanceVersion.trim()
    || !Number.isFinite(Date.parse(artifact.approval.approvedAt))) blockers.push('ENTRY_MODEL_APPROVAL_IDENTITY_INVALID');
  if (artifact.approval.evidenceHash !== evidenceHash) blockers.push('ENTRY_MODEL_EVIDENCE_HASH_MISMATCH');
  if (record.finalOosWindow !== null && Date.parse(artifact.approval.approvedAt) <= Date.parse(record.finalOosWindow.end))
    blockers.push('ENTRY_MODEL_APPROVAL_PRECEDES_OOS');
  const unsigned = { state: artifact.approval.state, approvedBy: artifact.approval.approvedBy,
    approvedAt: artifact.approval.approvedAt, governanceVersion: artifact.approval.governanceVersion,
    evidenceHash: artifact.approval.evidenceHash } as const;
  if (artifact.approval.contentHash !== approvalContentHash(unsigned)) blockers.push('ENTRY_MODEL_APPROVAL_HASH_INVALID');
  return [...new Set(blockers)].sort();
}

function validateEntryDecision(input: EntryModelDecisionInput, artifact: PromotedEntryModelArtifact,
  decision: PromotedEntryModelDecision): readonly string[] {
  const blockers: string[] = [];
  if (decision.contractVersion !== promotedDecisionPolicyProviderVersion) blockers.push('ENTRY_DECISION_VERSION_INVALID');
  if (decision.snapshotId !== input.snapshotId || decision.decisionAt !== input.decisionAt) blockers.push('ENTRY_DECISION_IDENTITY_MISMATCH');
  if (decision.modelId !== artifact.registryRecord.modelId || decision.modelVersion !== artifact.registryRecord.modelVersion
    || decision.targetId !== artifact.registryRecord.targetId
    || decision.datasetHash !== artifact.registryRecord.datasetHash || decision.artifactHash !== artifact.registryRecord.artifactHash
    || decision.featureSetVersion !== artifact.registryRecord.featureSetVersion
    || decision.featureSetVersion !== input.featureSetVersion
    || decision.featureContentHash !== input.featureContentHash) blockers.push('ENTRY_DECISION_ARTIFACT_MISMATCH');
  if (!Number.isFinite(Date.parse(decision.evidenceAvailableAt))
    || Date.parse(decision.evidenceAvailableAt) > Date.parse(input.decisionAt)) blockers.push('ENTRY_DECISION_PIT_VIOLATION');
  const expected = new Set(input.candidateIds);
  const seen = new Set<string>();
  for (const candidate of decision.predictions) {
    if (!expected.has(candidate.candidateId) || seen.has(candidate.candidateId)) blockers.push('ENTRY_DECISION_CANDIDATE_ID_INVALID');
    seen.add(candidate.candidateId);
    if (candidate.targetId !== decision.targetId || !Number.isFinite(candidate.value)
      || !Number.isFinite(candidate.calibratedUncertainty) || candidate.calibratedUncertainty < 0
      || (decision.targetId === 'P_WHOLE_CHAIN_PROFITABLE' && (candidate.value < 0 || candidate.value > 1)))
      blockers.push('ENTRY_DECISION_VALUE_INVALID');
  }
  if (seen.size !== expected.size) blockers.push('ENTRY_DECISION_CANDIDATE_COVERAGE_INCOMPLETE');
  if (decision.brokerAuthority !== false || decision.executionAuthorized !== false) blockers.push('ENTRY_DECISION_AUTHORITY_INVALID');
  return [...new Set(blockers)].sort();
}

export interface PromotedEntryModelProvider {
  readonly authority: 'EMPIRICALLY_PROMOTED_ENTRY_MODEL';
  evaluate(input: EntryModelDecisionInput): Promise<PromotedEntryModelDecision | null>;
}

export function createPromotedEntryModelProvider(artifact: PromotedEntryModelArtifact | null,
  evaluator: EntryModelEvaluator): PromotedEntryModelProvider | null {
  if (artifact === null || validatePromotedEntryModelArtifact(artifact).length > 0) return null;
  const pinned = structuredClone(artifact);
  return { authority: 'EMPIRICALLY_PROMOTED_ENTRY_MODEL', evaluate: async (input) => {
    if (!Number.isFinite(Date.parse(input.decisionAt)) || !input.snapshotId.trim() || !input.featureSetVersion.trim()
      || !/^[0-9a-f]{64}$/.test(input.featureContentHash) || input.candidateIds.length === 0
      || new Set(input.candidateIds).size !== input.candidateIds.length) return null;
    const decision = await evaluator(structuredClone(input), structuredClone(pinned));
    return validateEntryDecision(input, pinned, decision).length === 0 ? decision : null;
  } };
}

export interface PromotedStrategyRouterArtifact {
  readonly receipt: EmpiricalPolicyPromotionReceipt;
  readonly approval: ExplicitArtifactApproval;
}

export interface StrategyRouterDecisionInput {
  readonly snapshotId: string;
  readonly decisionAt: string;
  readonly bootstrap: StrategyRoutingResponse;
}

export interface PromotedStrategyRouterDecision {
  readonly snapshotId: string;
  readonly decisionAt: string;
  readonly policyVersion: string;
  readonly datasetHash: string;
  readonly evidenceAvailableAt: string;
  readonly routing: StrategyRoutingResponse;
  readonly brokerAuthority: false;
  readonly executionAuthorized: false;
}

export type StrategyRouterEvaluator = (input: StrategyRouterDecisionInput,
  artifact: PromotedStrategyRouterArtifact) => Promise<PromotedStrategyRouterDecision>;

export function validatePromotedStrategyRouterArtifact(artifact: PromotedStrategyRouterArtifact): readonly string[] {
  const parsed = empiricalPolicyPromotionReceiptSchema.safeParse(artifact.receipt);
  if (!parsed.success) return ['STRATEGY_ROUTER_PROMOTION_RECEIPT_INVALID'];
  const blockers = [...assessEmpiricalPolicyPromotion(parsed.data).blockers];
  if (parsed.data.policyKind !== 'STRATEGY_ROUTER') blockers.push('POLICY_KIND_NOT_STRATEGY_ROUTER');
  const evidenceHash = createHash('sha256').update(canonicalJson(parsed.data)).digest('hex');
  if (artifact.approval.state !== 'PROMOTED') blockers.push('STRATEGY_ROUTER_EXPLICIT_APPROVAL_MISSING');
  if (artifact.approval.evidenceHash !== evidenceHash) blockers.push('STRATEGY_ROUTER_EVIDENCE_HASH_MISMATCH');
  if (!artifact.approval.approvedBy.trim() || !artifact.approval.governanceVersion.trim()
    || !Number.isFinite(Date.parse(artifact.approval.approvedAt))) blockers.push('STRATEGY_ROUTER_APPROVAL_IDENTITY_INVALID');
  if (Date.parse(artifact.approval.approvedAt) <= Date.parse(parsed.data.outOfSampleWindow.end))
    blockers.push('STRATEGY_ROUTER_APPROVAL_PRECEDES_OOS');
  const unsigned = { state: artifact.approval.state, approvedBy: artifact.approval.approvedBy,
    approvedAt: artifact.approval.approvedAt, governanceVersion: artifact.approval.governanceVersion,
    evidenceHash: artifact.approval.evidenceHash } as const;
  if (artifact.approval.contentHash !== approvalContentHash(unsigned)) blockers.push('STRATEGY_ROUTER_APPROVAL_HASH_INVALID');
  return [...new Set(blockers)].sort();
}

export interface PromotedStrategyRouterProvider {
  readonly authority: 'EMPIRICALLY_PROMOTED_STRATEGY_ROUTER';
  route(input: StrategyRouterDecisionInput): Promise<PromotedStrategyRouterDecision | null>;
}

export function createPromotedStrategyRouterProvider(artifact: PromotedStrategyRouterArtifact | null,
  evaluator: StrategyRouterEvaluator): PromotedStrategyRouterProvider | null {
  if (artifact === null || validatePromotedStrategyRouterArtifact(artifact).length > 0) return null;
  const pinned = structuredClone(artifact);
  return { authority: 'EMPIRICALLY_PROMOTED_STRATEGY_ROUTER', route: async (input) => {
    if (!input.snapshotId.trim() || !Number.isFinite(Date.parse(input.decisionAt))
      || input.bootstrap.snapshotId !== input.snapshotId || input.bootstrap.timestamp !== input.decisionAt) return null;
    const decision = await evaluator(structuredClone(input), structuredClone(pinned));
    if (decision.snapshotId !== input.snapshotId || decision.decisionAt !== input.decisionAt
      || decision.policyVersion !== pinned.receipt.policyVersion || decision.datasetHash !== pinned.receipt.datasetHash
      || !Number.isFinite(Date.parse(decision.evidenceAvailableAt))
      || Date.parse(decision.evidenceAvailableAt) > Date.parse(input.decisionAt)
      || decision.routing.snapshotId !== input.bootstrap.snapshotId
      || decision.routing.timestamp !== input.bootstrap.timestamp
      || decision.brokerAuthority !== false || decision.executionAuthorized !== false) return null;
    return decision;
  } };
}

export async function resolvePromotedOrBootstrapRouting(provider: PromotedStrategyRouterProvider | null,
  input: StrategyRouterDecisionInput): Promise<{ routing: StrategyRoutingResponse; authority: string }> {
  if (provider === null) return { routing: input.bootstrap, authority: 'BOOTSTRAP_APPLICABILITY_ROUTER' };
  const promoted = await provider.route(input);
  return promoted === null ? { routing: input.bootstrap, authority: 'BOOTSTRAP_FALLBACK_PROMOTED_ROUTER_REJECTED' }
    : { routing: promoted.routing, authority: provider.authority };
}
