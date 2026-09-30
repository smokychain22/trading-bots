import { createHash } from 'node:crypto';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from './canonical-strategy-frontier.js';
import { decodeCycleEvidenceArchive } from './postgres-cycle-evidence-storage.js';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { filterToRealInputEvidence, type MethodInputProvenance } from './profitability-method-input-provenance.js';

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
  readonly methodProvenanceState: 'PRESENT' | 'MISSING_LEGACY';
  readonly executedMethodIds: readonly string[];
  readonly realInputEligibleMethodIds: readonly string[];
  readonly nonRealExecutedMethodIds: readonly string[];
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
  const rawProvenance = decoded.methodInputProvenance;
  if (rawProvenance !== undefined && rawProvenance !== null && !Array.isArray(rawProvenance)) {
    throw new Error('CYCLE_ARCHIVE_REPLAY_METHOD_PROVENANCE_INVALID');
  }
  const provenance = (rawProvenance ?? []) as unknown[];
  const ids = new Set<string>();
  const validOrigins = new Set(['REAL_PROVIDER', 'REAL_PROVIDER_UNKNOWN', 'REAL_PROVIDER_ERROR',
    'DERIVED_FROM_REAL', 'SYNTHETIC_FIXTURE', 'CALLER_MANUAL', 'NOT_ATTEMPTED',
    'VERSIONED_POLICY_CONSTANT']);
  for (const row of provenance) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('CYCLE_ARCHIVE_REPLAY_METHOD_PROVENANCE_INVALID');
    }
    const value = row as Record<string, unknown>;
    if (typeof value.methodId !== 'string' || value.methodId.length === 0 || ids.has(value.methodId)
      || typeof value.executed !== 'boolean'
      || !['REAL', 'PARTIAL_REAL', 'VERSIONED_POLICY', 'MANUAL', 'SYNTHETIC', 'UNKNOWN'].includes(String(value.inputRealness))
      || !Array.isArray(value.decisiveInputs) || value.decisiveInputs.length === 0
      || value.decisiveInputs.some((item: unknown) => item === null || typeof item !== 'object'
        || Array.isArray(item) || typeof (item as Record<string, unknown>).name !== 'string'
        || !validOrigins.has(String((item as Record<string, unknown>).origin)))) {
      throw new Error('CYCLE_ARCHIVE_REPLAY_METHOD_PROVENANCE_INVALID');
    }
    if (value.inputRealness === 'REAL' && value.decisiveInputs.some((item: unknown) =>
      !['REAL_PROVIDER', 'DERIVED_FROM_REAL', 'VERSIONED_POLICY_CONSTANT'].includes(
        String((item as Record<string, unknown>).origin)))) {
      throw new Error('CYCLE_ARCHIVE_REPLAY_METHOD_PROVENANCE_CONTRADICTORY');
    }
    ids.add(value.methodId);
  }
  const typedProvenance = provenance as MethodInputProvenance[];
  const executedMethodIds = typedProvenance.filter((row) => row.executed).map((row) => row.methodId);
  const realInputEligibleMethodIds = filterToRealInputEvidence(executedMethodIds, typedProvenance);
  const realInputEligible = new Set(realInputEligibleMethodIds);
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
    methodProvenanceState: rawProvenance == null ? 'MISSING_LEGACY' : 'PRESENT',
    executedMethodIds,
    realInputEligibleMethodIds,
    nonRealExecutedMethodIds: executedMethodIds.filter((id) => !realInputEligible.has(id)),
    providerRequests: 0,
    brokerMutations: 0,
  };
}
