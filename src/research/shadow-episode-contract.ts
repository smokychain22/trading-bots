import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';
import type { SeriousResearchSubject } from './serious-subject-policy.js';

export const shadowEpisodeContractVersion = 'theta-shadow-episode-v1' as const;

export interface ShadowEpisodeContract {
  readonly contractVersion: typeof shadowEpisodeContractVersion;
  readonly shadowEpisodeId: string;
  readonly subjectId: string;
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly candidateId: string | null;
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
  readonly strategyVersion: string;
  readonly riskVersion: string;
  readonly costVersion: string;
  readonly executionModelVersion: string;
  readonly sourceSha: string;
  readonly workerSha: string;
}): ShadowEpisodeContract {
  if (input.decisionId.trim() === '' || !SHA256.test(input.featureSnapshotHash)
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
  const withoutHashes = {
    contractVersion: shadowEpisodeContractVersion,
    subjectId: input.subject.subjectId,
    decisionId: input.decisionId,
    snapshotId: input.subject.snapshotId,
    candidateId: input.subject.candidateId,
    strategy: input.subject.kind === 'CANDIDATE' ? input.subject.branch : 'WAIT',
    decisionAt: new Date(decisionAtMs).toISOString(),
    decisionBucketAt: new Date(bucketAtMs).toISOString(),
    legs,
    featureSnapshotHash: input.featureSnapshotHash,
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
