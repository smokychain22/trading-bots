import { createHash } from 'node:crypto';
import type {
  CanonicalBranchFrontier, CanonicalFrontierCandidate, CanonicalStrategyFrontier,
} from '../theta/canonical-strategy-frontier.js';

export const seriousSubjectSelectionPolicyVersion = 'theta-serious-subject-selection-v1' as const;

export type SeriousSubjectKind = 'CANDIDATE' | 'WAIT';
export type SeriousSubjectSelectionReason =
  | 'CANONICAL_SELECTED'
  | 'BRANCH_BEST'
  | 'BRANCH_SECOND_BEST'
  | 'BRANCH_BEST_REJECTED'
  | 'FRONTIER_NEAR_MISS'
  | 'BOUNDED_BRANCH_TOP_N'
  | 'CANONICAL_WAIT';

export interface SeriousSubjectPolicy {
  readonly version: typeof seriousSubjectSelectionPolicyVersion;
  readonly topNByBranch: Readonly<Record<'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK', number>>;
  readonly maximumCandidateSubjects: number;
  readonly minimumDecisionIntervalMinutes: number;
  readonly includeWait: true;
}

export const defaultSeriousSubjectPolicy: SeriousSubjectPolicy = {
  version: seriousSubjectSelectionPolicyVersion,
  topNByBranch: { THETA_CONVENTIONAL: 5, THETA_HOLD_STRIKE: 3, THETA_DEFINED_RISK: 3 },
  maximumCandidateSubjects: 12,
  minimumDecisionIntervalMinutes: 60,
  includeWait: true,
};

export interface SeriousCandidateSubject {
  readonly subjectId: string;
  readonly kind: 'CANDIDATE';
  readonly snapshotId: string;
  readonly decisionAt: string;
  readonly decisionBucketAt: string;
  readonly candidateId: string;
  readonly branch: CanonicalFrontierCandidate['branch'];
  readonly rankAtDecision: number | null;
  readonly selected: boolean;
  readonly selectionReasons: readonly SeriousSubjectSelectionReason[];
  readonly candidate: CanonicalFrontierCandidate;
  readonly subjectSelectionPolicyVersion: typeof seriousSubjectSelectionPolicyVersion;
  readonly shadowOnly: true;
  readonly brokerAuthority: false;
  readonly orderSubmitted: false;
  readonly brokerFill: false;
}

export interface SeriousWaitSubject {
  readonly subjectId: string;
  readonly kind: 'WAIT';
  readonly snapshotId: string;
  readonly decisionAt: string;
  readonly decisionBucketAt: string;
  readonly candidateId: null;
  readonly branch: null;
  readonly rankAtDecision: null;
  readonly selected: false;
  readonly selectionReasons: readonly ['CANONICAL_WAIT'];
  readonly primaryAction: 'GLOBAL_WAIT' | 'SYSTEM_HOLD';
  readonly reasons: readonly string[];
  readonly bestRejectedCandidateId: string | null;
  readonly secondBestCandidateId: string | null;
  readonly nearMissCandidateId: string | null;
  readonly subjectSelectionPolicyVersion: typeof seriousSubjectSelectionPolicyVersion;
  readonly shadowOnly: true;
  readonly brokerAuthority: false;
  readonly orderSubmitted: false;
  readonly brokerFill: false;
}

export type SeriousResearchSubject = SeriousCandidateSubject | SeriousWaitSubject;

export interface SeriousSubjectSelectionReceipt {
  readonly policyVersion: typeof seriousSubjectSelectionPolicyVersion;
  readonly rawCandidateCount: number;
  readonly longLivedCandidateSubjectCount: number;
  readonly waitSubjectCount: number;
  readonly subjects: readonly SeriousResearchSubject[];
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

function candidateSort(a: CanonicalFrontierCandidate, b: CanonicalFrontierCandidate): number {
  const rankA = a.paretoRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.paretoRank ?? Number.MAX_SAFE_INTEGER;
  return rankA - rankB || a.candidateId.localeCompare(b.candidateId);
}

function branchTopN(branch: CanonicalBranchFrontier, policy: SeriousSubjectPolicy): readonly string[] {
  if (!(branch.branch in policy.topNByBranch)) return [];
  const limit = policy.topNByBranch[branch.branch as keyof SeriousSubjectPolicy['topNByBranch']];
  return [...branch.candidates].sort(candidateSort).slice(0, limit).map((candidate) => candidate.candidateId);
}

function addReason(
  selected: Map<string, Set<SeriousSubjectSelectionReason>>,
  candidateId: string | null,
  reason: SeriousSubjectSelectionReason,
): void {
  if (candidateId === null) return;
  const reasons = selected.get(candidateId) ?? new Set<SeriousSubjectSelectionReason>();
  reasons.add(reason);
  selected.set(candidateId, reasons);
}

/**
 * Selects a deterministic bounded research cohort from the already persisted
 * canonical frontier. It never changes strategy rank, quantity, or authority.
 */
export function selectSeriousResearchSubjects(
  frontier: CanonicalStrategyFrontier,
  policy: SeriousSubjectPolicy = defaultSeriousSubjectPolicy,
): SeriousSubjectSelectionReceipt {
  if (policy.version !== seriousSubjectSelectionPolicyVersion) throw new Error('SERIOUS_SUBJECT_POLICY_VERSION_INVALID');
  if (!Number.isInteger(policy.maximumCandidateSubjects) || policy.maximumCandidateSubjects < 1) {
    throw new Error('SERIOUS_SUBJECT_POLICY_BOUND_INVALID');
  }
  if (!Number.isInteger(policy.minimumDecisionIntervalMinutes) || policy.minimumDecisionIntervalMinutes < 5
    || policy.minimumDecisionIntervalMinutes > 390) throw new Error('SERIOUS_SUBJECT_POLICY_INTERVAL_INVALID');
  const decisionMs = Date.parse(frontier.timestamp);
  if (!Number.isFinite(decisionMs)) throw new Error('SERIOUS_SUBJECT_DECISION_TIME_INVALID');
  const bucketMs = policy.minimumDecisionIntervalMinutes * 60_000;
  const decisionBucketAt = new Date(Math.floor(decisionMs / bucketMs) * bucketMs).toISOString();
  for (const value of Object.values(policy.topNByBranch)) {
    if (!Number.isInteger(value) || value < 0) throw new Error('SERIOUS_SUBJECT_POLICY_TOP_N_INVALID');
  }

  const candidates = frontier.branches.flatMap((branch) => branch.candidates);
  const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  if (byId.size !== candidates.length) throw new Error('SERIOUS_SUBJECT_CANDIDATE_ID_DUPLICATE');
  const reasons = new Map<string, Set<SeriousSubjectSelectionReason>>();
  addReason(reasons, frontier.selectedCandidateId, 'CANONICAL_SELECTED');
  addReason(reasons, frontier.nearMissCandidateId, 'FRONTIER_NEAR_MISS');
  for (const branch of frontier.branches) {
    addReason(reasons, branch.bestCandidateId, 'BRANCH_BEST');
    addReason(reasons, branch.secondBestCandidateId, 'BRANCH_SECOND_BEST');
    addReason(reasons, branch.bestRejectedCandidateId, 'BRANCH_BEST_REJECTED');
    for (const candidateId of branchTopN(branch, policy)) addReason(reasons, candidateId, 'BOUNDED_BRANCH_TOP_N');
  }
  for (const candidateId of reasons.keys()) {
    if (!byId.has(candidateId)) throw new Error(`SERIOUS_SUBJECT_FRONTIER_REFERENCE_MISSING:${candidateId}`);
  }

  const priority: Readonly<Record<SeriousSubjectSelectionReason, number>> = {
    CANONICAL_SELECTED: 0, BRANCH_BEST: 1, BRANCH_SECOND_BEST: 2,
    BRANCH_BEST_REJECTED: 3, FRONTIER_NEAR_MISS: 4, BOUNDED_BRANCH_TOP_N: 5,
    CANONICAL_WAIT: 6,
  };
  const ordered = [...reasons.entries()].sort(([idA, reasonsA], [idB, reasonsB]) => {
    const priorityA = Math.min(...[...reasonsA].map((reason) => priority[reason]));
    const priorityB = Math.min(...[...reasonsB].map((reason) => priority[reason]));
    return priorityA - priorityB || candidateSort(byId.get(idA)!, byId.get(idB)!);
  }).slice(0, policy.maximumCandidateSubjects);

  const subjects: SeriousResearchSubject[] = ordered.map(([candidateId, selectedReasons]) => {
    const candidate = byId.get(candidateId)!;
    return {
      subjectId: digest(`${policy.version}:${decisionBucketAt}:CANDIDATE:${candidateId}`),
      kind: 'CANDIDATE', snapshotId: frontier.snapshotId, decisionAt: frontier.timestamp, decisionBucketAt,
      candidateId, branch: candidate.branch, rankAtDecision: candidate.paretoRank,
      selected: candidateId === frontier.selectedCandidateId,
      selectionReasons: [...selectedReasons].sort((a, b) => priority[a] - priority[b] || a.localeCompare(b)),
      candidate, subjectSelectionPolicyVersion: policy.version,
      shadowOnly: true, brokerAuthority: false, orderSubmitted: false, brokerFill: false,
    };
  });
  if (policy.includeWait && (frontier.primaryAction === 'GLOBAL_WAIT' || frontier.primaryAction === 'SYSTEM_HOLD')) {
    subjects.push({
      subjectId: digest(`${policy.version}:${decisionBucketAt}:WAIT:${frontier.primaryAction}`),
      kind: 'WAIT', snapshotId: frontier.snapshotId, decisionAt: frontier.timestamp, decisionBucketAt,
      candidateId: null, branch: null, rankAtDecision: null, selected: false,
      selectionReasons: ['CANONICAL_WAIT'], primaryAction: frontier.primaryAction,
      reasons: [...frontier.globalWaitReasons], bestRejectedCandidateId: frontier.bestRejectedCandidateId,
      secondBestCandidateId: frontier.secondBestCandidateId, nearMissCandidateId: frontier.nearMissCandidateId,
      subjectSelectionPolicyVersion: policy.version,
      shadowOnly: true, brokerAuthority: false, orderSubmitted: false, brokerFill: false,
    });
  }
  return {
    policyVersion: policy.version, rawCandidateCount: candidates.length,
    longLivedCandidateSubjectCount: ordered.length,
    waitSubjectCount: subjects.filter((subject) => subject.kind === 'WAIT').length,
    subjects,
  };
}
