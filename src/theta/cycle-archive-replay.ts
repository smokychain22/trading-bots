import { createHash } from 'node:crypto';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from './canonical-strategy-frontier.js';
import { decodeCycleEvidenceArchive } from './postgres-cycle-evidence-storage.js';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export interface CycleArchiveReplayIdentity {
  readonly cycleId: string;
  readonly sourceSha: string;
  readonly archiveSha256: string;
  readonly archiveContentHash: string;
}

export type CycleArchiveReplayResult = {
  readonly state: 'SAME_SOURCE_REPRODUCED' | 'SAME_SOURCE_MISMATCH' | 'CROSS_SOURCE_SAME_RESULT' | 'CROSS_SOURCE_CHANGED_RESULT';
  readonly mode: 'HISTORICAL_SAME_POLICY_REPLAY' | 'CURRENT_POLICY_COUNTERFACTUAL_REPLAY';
  readonly cycleId: string;
  readonly originatingSourceSha: string;
  readonly replaySourceSha: string;
  readonly expectedFrontierHash: string;
  readonly replayedFrontierHash: string;
  readonly expectedAction: string | null;
  readonly replayedAction: string;
  readonly expectedSelectedCandidateId: string | null;
  readonly replayedSelectedCandidateId: string | null;
  readonly inputContractCount: number;
  readonly providerRequests: 0;
  readonly brokerMutations: 0;
};

const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const shaPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;

/** Replays the complete persisted cycle archive, including large T0s that exceed
 * the optional 4 MiB local-spool bundle. The caller supplies the source SHA.
 * A cross-source result is a counterfactual, never historical reproduction. */
export function replayCycleArchive(
  compressedArchive: Buffer,
  identity: CycleArchiveReplayIdentity,
  replaySourceSha: string,
  implementation: {
    readonly decode: typeof decodeCycleEvidenceArchive;
    readonly build: typeof buildCanonicalStrategyFrontier;
  } = { decode: decodeCycleEvidenceArchive, build: buildCanonicalStrategyFrontier },
): CycleArchiveReplayResult {
  if (!shaPattern.test(identity.sourceSha) || !shaPattern.test(replaySourceSha)
    || !hashPattern.test(identity.archiveSha256) || !hashPattern.test(identity.archiveContentHash)
    || identity.cycleId.length === 0) throw new Error('CYCLE_ARCHIVE_REPLAY_IDENTITY_INVALID');
  if (compressedArchive.byteLength > 4 * 1024 * 1024) throw new Error('CYCLE_ARCHIVE_REPLAY_COMPRESSED_SIZE_INVALID');
  if (sha256(compressedArchive) !== identity.archiveSha256) throw new Error('CYCLE_ARCHIVE_REPLAY_BYTES_HASH_MISMATCH');
  const decoded = implementation.decode(compressedArchive);
  const contentHash = sha256(Buffer.from(canonicalJson(decoded)));
  if (contentHash !== identity.archiveContentHash) throw new Error('CYCLE_ARCHIVE_REPLAY_CONTENT_HASH_MISMATCH');
  const input = decoded.canonicalFrontierInput;
  const expected = decoded.strategyFrontier;
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new Error('CYCLE_ARCHIVE_REPLAY_T0_OR_FRONTIER_MISSING');
  }
  const inputRecord = input as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  if (!Array.isArray(inputRecord.contracts) || typeof inputRecord.snapshotId !== 'string'
    || typeof inputRecord.timestamp !== 'string' || typeof inputRecord.strategyVersion !== 'string'
    || !hashPattern.test(String(expectedRecord.contentHash))) {
    throw new Error('CYCLE_ARCHIVE_REPLAY_T0_OR_FRONTIER_INVALID');
  }
  const replayed = implementation.build(input as unknown as CanonicalStrategyFrontierInput);
  const expectedHash = expectedRecord.contentHash as string;
  const sameSource = identity.sourceSha === replaySourceSha;
  const sameResult = replayed.contentHash === expectedHash;
  return {
    state: sameSource ? (sameResult ? 'SAME_SOURCE_REPRODUCED' : 'SAME_SOURCE_MISMATCH')
      : (sameResult ? 'CROSS_SOURCE_SAME_RESULT' : 'CROSS_SOURCE_CHANGED_RESULT'),
    mode: sameSource ? 'HISTORICAL_SAME_POLICY_REPLAY' : 'CURRENT_POLICY_COUNTERFACTUAL_REPLAY',
    cycleId: identity.cycleId,
    originatingSourceSha: identity.sourceSha,
    replaySourceSha,
    expectedFrontierHash: expectedHash,
    replayedFrontierHash: replayed.contentHash,
    expectedAction: typeof expectedRecord.primaryAction === 'string' ? expectedRecord.primaryAction : null,
    replayedAction: replayed.primaryAction,
    expectedSelectedCandidateId: typeof expectedRecord.selectedCandidateId === 'string'
      ? expectedRecord.selectedCandidateId : null,
    replayedSelectedCandidateId: replayed.selectedCandidateId,
    inputContractCount: inputRecord.contracts.length,
    providerRequests: 0,
    brokerMutations: 0,
  };
}
