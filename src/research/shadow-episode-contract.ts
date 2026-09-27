import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';
import type { SeriousResearchSubject } from './serious-subject-policy.js';

export const shadowEpisodeContractVersion = 'theta-shadow-episode-v3' as const;

export type ShadowEpisodeDecisionEvidence =
  | {
    readonly kind: 'CANDIDATE';
    readonly action: SeriousCandidateDecision['action'];
    readonly rankAtDecision: number | null;
    readonly selectionReasons: SeriousCandidateDecision['selectionReasons'];
    readonly dte: number | null;
    readonly delta: number | null;
    readonly moneyness: number | null;
    readonly spreadPct: number | null;
    readonly liquidity: SeriousCandidateDecision['liquidity'];
    readonly economics: SeriousCandidateDecision['economics'];
    readonly assignmentCapacityQty: number | null;
    readonly aegisState: SeriousCandidateDecision['aegisState'];
    readonly hardBlockers: readonly string[];
    readonly softEvidence: readonly string[];
    readonly unknownEvidence: readonly string[];
    readonly structurallyFeasible: boolean;
    readonly riskFeasible: boolean;
    readonly sizing: SeriousCandidateDecision['sizing'];
    readonly paretoRank: number | null;
    readonly dominatedBy: readonly string[];
    readonly entryEligibility: SeriousCandidateDecision['entryEligibility'] | null;
  }
  | {
    readonly kind: 'WAIT';
    readonly primaryAction: 'GLOBAL_WAIT' | 'SYSTEM_HOLD';
    readonly reasons: readonly string[];
    readonly bestRejectedCandidateId: string | null;
    readonly secondBestCandidateId: string | null;
    readonly nearMissCandidateId: string | null;
  };

type SeriousCandidateDecision = Extract<SeriousResearchSubject, { readonly kind: 'CANDIDATE' }>['candidate'] & {
  readonly selectionReasons: Extract<SeriousResearchSubject, { readonly kind: 'CANDIDATE' }>['selectionReasons'];
};

export interface ShadowEpisodeContract {
  readonly contractVersion: typeof shadowEpisodeContractVersion;
  readonly shadowEpisodeId: string;
  readonly subjectId: string;
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly candidateId: string | null;
  /** Canonical selection at T0. This is decision evidence only. A shadow
   * episode still has no broker fill and cannot become a factual outcome. */
  readonly selectedAtDecision: boolean;
  readonly strategy: string;
  readonly decisionAt: string;
  readonly decisionBucketAt: string;
  readonly legs: readonly {
    readonly optionSymbol: string;
    readonly positionIntent: string;
    readonly optionType: 'PUT' | 'CALL';
    readonly strike: number;
    readonly expiration: string;
    readonly multiplier: number;
    readonly bid: number | null;
    readonly ask: number | null;
    readonly quoteTimestamp: string | null;
  }[];
  readonly featureSnapshotHash: string;
  /** Hashes bind this bounded local subject to the complete canonical
   * frontier and Optionomics context retained in the immutable cycle
   * archive. Large provider payloads are not duplicated into SQLite. */
  readonly frontierContentHash: string;
  readonly optionomicsContextHash: string;
  /** The complete bounded decision facts needed to explain why this exact
   * subject was selected for future observation. This is T0 evidence, not
   * a later profitability label or broker fill. */
  readonly decisionEvidence: ShadowEpisodeDecisionEvidence;
  readonly strategyVersion: string;
  readonly riskVersion: string;
  readonly costVersion: string;
  readonly executionModelVersion: string;
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly contentHash: string;
  readonly shadowOnly: true;
  readonly brokerAuthority: false;
  readonly orderSubmitted: false;
  readonly brokerFill: false;
}

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[A-Za-z0-9_.:@/-]{1,128}$/;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function buildShadowEpisodeContract(input: {
  readonly subject: SeriousResearchSubject;
  readonly decisionId: string;
  readonly featureSnapshotHash: string;
  readonly frontierContentHash: string;
  readonly optionomicsContextHash: string;
  readonly strategyVersion: string;
  readonly riskVersion: string;
  readonly costVersion: string;
  readonly executionModelVersion: string;
  readonly sourceSha: string;
  readonly workerSha: string;
}): ShadowEpisodeContract {
  if (input.decisionId.trim() === '' || !SHA256.test(input.featureSnapshotHash)
    || !SHA256.test(input.frontierContentHash) || !SHA256.test(input.optionomicsContextHash)
    || !SHA40.test(input.sourceSha) || !SHA40.test(input.workerSha)) {
    throw new Error('SHADOW_EPISODE_IDENTITY_INVALID');
  }
  for (const version of [input.strategyVersion, input.riskVersion, input.costVersion, input.executionModelVersion]) {
    if (!VERSION.test(version)) throw new Error('SHADOW_EPISODE_VERSION_INVALID');
  }
  const decisionAtMs = Date.parse(input.subject.decisionAt);
  const bucketAtMs = Date.parse(input.subject.decisionBucketAt);
  if (!Number.isFinite(decisionAtMs) || !Number.isFinite(bucketAtMs) || bucketAtMs > decisionAtMs) {
    throw new Error('SHADOW_EPISODE_TIME_INVALID');
  }
  const legs = input.subject.kind === 'CANDIDATE' ? input.subject.candidate.legs.map((leg) => ({
    optionSymbol: leg.optionSymbol,
    positionIntent: leg.positionIntent,
    optionType: leg.optionType,
    strike: leg.strike,
    expiration: leg.expiration,
    multiplier: leg.multiplier,
    bid: leg.bid,
    ask: leg.ask,
    quoteTimestamp: leg.quoteTimestamp,
  })) : [];
  if (input.subject.kind === 'CANDIDATE' && legs.length === 0) throw new Error('SHADOW_EPISODE_LEGS_MISSING');
  const decisionEvidence: ShadowEpisodeDecisionEvidence = input.subject.kind === 'CANDIDATE'
    ? {
      kind: 'CANDIDATE',
      action: input.subject.candidate.action,
      rankAtDecision: input.subject.rankAtDecision,
      selectionReasons: [...input.subject.selectionReasons],
      dte: input.subject.candidate.dte,
      delta: input.subject.candidate.delta,
      moneyness: input.subject.candidate.moneyness,
      spreadPct: input.subject.candidate.spreadPct,
      liquidity: { ...input.subject.candidate.liquidity },
      economics: { ...input.subject.candidate.economics },
      assignmentCapacityQty: input.subject.candidate.assignmentCapacityQty,
      aegisState: input.subject.candidate.aegisState,
      hardBlockers: [...input.subject.candidate.hardBlockers],
      softEvidence: [...input.subject.candidate.softEvidence],
      unknownEvidence: [...input.subject.candidate.unknownEvidence],
      structurallyFeasible: input.subject.candidate.structurallyFeasible,
      riskFeasible: input.subject.candidate.riskFeasible,
      sizing: {
        quantity: input.subject.candidate.sizing.quantity,
        bindingConstraint: input.subject.candidate.sizing.bindingConstraint,
        reasons: [...input.subject.candidate.sizing.reasons],
      },
      paretoRank: input.subject.candidate.paretoRank,
      dominatedBy: [...input.subject.candidate.dominatedBy],
      entryEligibility: input.subject.candidate.entryEligibility === undefined
        ? null
        : {
          ...input.subject.candidate.entryEligibility,
          paperBootstrapAllowedUnknownComponents: [
            ...input.subject.candidate.entryEligibility.paperBootstrapAllowedUnknownComponents,
          ],
          paperBootstrapReasonCodes: [...input.subject.candidate.entryEligibility.paperBootstrapReasonCodes],
        },
    }
    : {
      kind: 'WAIT',
      primaryAction: input.subject.primaryAction,
      reasons: [...input.subject.reasons],
      bestRejectedCandidateId: input.subject.bestRejectedCandidateId,
      secondBestCandidateId: input.subject.secondBestCandidateId,
      nearMissCandidateId: input.subject.nearMissCandidateId,
    };
  const withoutHashes = {
    contractVersion: shadowEpisodeContractVersion,
    subjectId: input.subject.subjectId,
    decisionId: input.decisionId,
    snapshotId: input.subject.snapshotId,
    candidateId: input.subject.candidateId,
    selectedAtDecision: input.subject.selected,
    strategy: input.subject.kind === 'CANDIDATE' ? input.subject.branch : 'WAIT',
    decisionAt: new Date(decisionAtMs).toISOString(),
    decisionBucketAt: new Date(bucketAtMs).toISOString(),
    legs,
    featureSnapshotHash: input.featureSnapshotHash,
    frontierContentHash: input.frontierContentHash,
    optionomicsContextHash: input.optionomicsContextHash,
    decisionEvidence,
    strategyVersion: input.strategyVersion,
    riskVersion: input.riskVersion,
    costVersion: input.costVersion,
    executionModelVersion: input.executionModelVersion,
    sourceSha: input.sourceSha,
    workerSha: input.workerSha,
    shadowOnly: true as const,
    brokerAuthority: false as const,
    orderSubmitted: false as const,
    brokerFill: false as const,
  };
  const contentHash = hash(canonicalJson(withoutHashes));
  return {
    ...withoutHashes,
    shadowEpisodeId: hash(`${input.subject.subjectId}:${input.decisionId}:${contentHash}`),
    contentHash,
  };
}
