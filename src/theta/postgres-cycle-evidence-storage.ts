import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from 'node:zlib';
import type { JsonValue } from '../market/fusion-snapshot.js';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { assertInlinePayloadWithinPolicy } from '../storage/storage-dataset-policy.js';
import { rebuildOptionomicsContractFeaturesV1 } from './optionomics-feature-engine.js';
import type { NormalizedOptionomicsEntry } from './optionomics-provider.js';
import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import type { ThetaShadowCycleResult } from './theta-shadow-cycle.js';

export const postgresCycleEvidenceStorageVersion = 'theta-postgres-cycle-evidence-storage-v3' as const;
const previousStorageVersion = 'theta-postgres-cycle-evidence-storage-v2';
const packedArchivePrefix = Buffer.from('THETA_BR1\0');
const MAX_PROJECTION_BYTES = 768 * 1024;
const MAX_COMPRESSED_ARCHIVE_BYTES = 4 * 1024 * 1024;

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, JsonValue> : {};
}

function contractIdentity(value: JsonValue): string | null {
  const row = object(value);
  const identity = row.occSymbol ?? row.optionSymbol;
  return typeof identity === 'string' && identity.length > 0 ? identity : null;
}

function referencedContractIds(cycle: ThetaShadowCycleResult): Set<string> {
  const ids = new Set<string>();
  const frontier = cycle.strategyFrontier;
  if (frontier !== null && frontier !== undefined) {
    const candidateIds = new Set<string>([
      frontier.selectedCandidateId,
      frontier.nearMissCandidateId,
      frontier.bestRejectedCandidateId,
      ...frontier.branches.flatMap((branch) => [branch.bestCandidateId, branch.secondBestCandidateId, branch.bestRejectedCandidateId]),
    ].filter((value): value is string => value !== null));
    for (const candidate of frontier.branches.flatMap((branch) => branch.candidates)) {
      if (candidateIds.has(candidate.candidateId)) {
        for (const leg of candidate.legs) ids.add(leg.optionSymbol);
      }
    }
  }
  const receipt = cycle.orchestration?.receipt;
  if (receipt?.selectedCandidateId !== null && receipt?.selectedCandidateId !== undefined
    && receipt.selectedCandidateId !== 'WAIT') ids.add(receipt.selectedCandidateId);
  for (const candidate of cycle.orchestration?.thetaQ?.candidates.slice(0, 3) ?? []) ids.add(candidate.candidateId);
  const positionState = object(cycle.fusionSnapshot?.snapshot.positionState);
  const positions = Array.isArray(positionState.positions) ? positionState.positions : [];
  for (const position of positions) {
    const row = object(position);
    for (const key of ['contractSymbol', 'contract_symbol', 'optionSymbol', 'symbol']) {
      const value = row[key];
      if (typeof value === 'string' && value.length > 0) ids.add(value);
    }
  }
  return ids;
}

function compactContractKeyedMap(value: JsonValue | undefined, ids: ReadonlySet<string>): JsonValue {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => ids.has(key)));
}

function compactRiskState(value: JsonValue | undefined, ids: ReadonlySet<string>): JsonValue {
  const state = object(value);
  const alpaca = object(state.alpacaContractIvStress);
  if (Object.keys(alpaca).length === 0) return state;
  return { ...state, alpacaContractIvStress: {
    ...alpaca,
    assessmentsByContract: compactContractKeyedMap(alpaca.assessmentsByContract, ids),
  } };
}

function compactRegimeState(value: JsonValue | undefined, ids: ReadonlySet<string>): JsonValue {
  const state = object(value);
  if (!('companyEventByOptionSymbol' in state)) return state;
  return { ...state, companyEventByOptionSymbol: compactContractKeyedMap(state.companyEventByOptionSymbol, ids) };
}

function optionomicsManifest(value: JsonValue | undefined): JsonValue {
  const state = object(value);
  const features = object(state.features);
  const raw = Array.isArray(state.rawObservations) ? state.rawObservations : [];
  const contracts = Array.isArray(features.contracts) ? features.contracts : [];
  const flow = Array.isArray(state.netFlowWindows) ? state.netFlowWindows : [];
  return {
    storageState: 'FULL_STATE_IN_COMPRESSED_CYCLE_ARCHIVE',
    fullStateHash: hash(canonicalJson(state)),
    rawObservationCount: raw.length,
    featureContractCount: contracts.length,
    netFlowWindowCount: flow.length,
    schemaVersion: features.schemaVersion ?? null,
    unavailableFamilies: features.unavailableFamilies ?? [],
  };
}

export interface PostgresCycleEvidenceProjection {
  readonly snapshot: Readonly<Record<string, JsonValue>>;
  readonly snapshotProjectionHash: string;
  readonly fullContractCount: number;
  readonly projectedContractCount: number;
  readonly archive: Buffer;
  readonly archiveHash: string;
  readonly archiveUncompressedBytes: number;
  readonly archiveCompressedBytes: number;
}

type PackedReference = 'OPTIONOMICS_RAW_OBSERVATION_PAYLOAD' | 'CANONICAL_FRONTIER_CONTRACTS'
  | 'STRATEGY_FRONTIER_OPTIONOMICS_CONTEXT' | 'CANONICAL_FRONTIER_OPTIONOMICS_CONTEXT'
  | 'OPTIONOMICS_FEATURE_CONTRACTS_V1';

function rebuildFeatureContracts(snapshot: Readonly<Record<string, JsonValue>>): JsonValue | null {
  const state = object(snapshot.optionomicsFeatureState);
  if (!Array.isArray(state.optionChain) || !Array.isArray(snapshot.contractCandidates)) return null;
  const contracts = snapshot.contractCandidates.map((value) => object(value));
  const firstPrice = contracts[0]?.underlyingLast;
  const stockPrice = typeof firstPrice === 'number' && Number.isFinite(firstPrice) ? firstPrice : null;
  const multiplierByContract = new Map<string, number>();
  for (const contract of contracts) {
    if (typeof contract.occSymbol === 'string' && typeof contract.multiplier === 'number') {
      multiplierByContract.set(contract.occSymbol, contract.multiplier);
    }
  }
  try {
    return rebuildOptionomicsContractFeaturesV1({
      entries: state.optionChain as unknown as NormalizedOptionomicsEntry[],
      stockPrice, multiplierByContract,
    }) as unknown as JsonValue;
  } catch {
    return null;
  }
}

function packCycleEvidence(value: Record<string, unknown>): { readonly evidence: Record<string, unknown>; readonly references: PackedReference[] } {
  const references: PackedReference[] = [];
  let snapshot = value.snapshot as Record<string, JsonValue>;
  const optionomics = object(snapshot.optionomicsFeatureState);
  const rawObservation = object(optionomics.rawObservation);
  const rawObservations = Array.isArray(optionomics.rawObservations) ? optionomics.rawObservations : [];
  const firstRawObservation = object(rawObservations[0]);
  if (rawObservation.payload !== undefined && firstRawObservation.payload !== undefined
    && canonicalJson(rawObservation.payload) === canonicalJson(firstRawObservation.payload)) {
    snapshot = { ...snapshot, optionomicsFeatureState: {
      ...optionomics, rawObservation: { ...rawObservation, payload: null },
    } };
    references.push('OPTIONOMICS_RAW_OBSERVATION_PAYLOAD');
  }
  let canonicalFrontierInput = value.canonicalFrontierInput;
  const featureContext = object(object(snapshot.optionomicsFeatureState).features);
  const featureContextJson = Object.keys(featureContext).length > 0 ? canonicalJson(featureContext) : null;
  const featureContracts = featureContext.contracts;
  if (Array.isArray(featureContracts) && featureContracts.length > 0) {
    const rebuilt = rebuildFeatureContracts(snapshot);
    if (rebuilt !== null && canonicalJson(rebuilt) === canonicalJson(featureContracts)) {
      const state = object(snapshot.optionomicsFeatureState);
      snapshot = { ...snapshot, optionomicsFeatureState: { ...state,
        features: { ...featureContext, contracts: {
          storageState: 'REBUILD_FROM_NORMALIZED_OPTION_CHAIN_V1',
          fullStateHash: hash(canonicalJson(featureContracts)),
        } },
      } };
      references.push('OPTIONOMICS_FEATURE_CONTRACTS_V1');
    }
  }
  let strategyFrontier = value.strategyFrontier;
  if (featureContextJson !== null
    && strategyFrontier !== null && typeof strategyFrontier === 'object' && !Array.isArray(strategyFrontier)) {
    const frontier = strategyFrontier as Record<string, JsonValue>;
    if (frontier.optionomicsContext !== undefined
      && (frontier.optionomicsContext === featureContext
        || canonicalJson(frontier.optionomicsContext) === featureContextJson)) {
      strategyFrontier = { ...frontier, optionomicsContext: null };
      references.push('STRATEGY_FRONTIER_OPTIONOMICS_CONTEXT');
    }
  }
  if (canonicalFrontierInput !== null && typeof canonicalFrontierInput === 'object' && !Array.isArray(canonicalFrontierInput)) {
    const input = canonicalFrontierInput as Record<string, JsonValue>;
    let packedInput = input;
    if (featureContextJson !== null && input.optionomicsContext !== undefined
      && (input.optionomicsContext === featureContext
        || canonicalJson(input.optionomicsContext) === featureContextJson)) {
      packedInput = { ...packedInput, optionomicsContext: null };
      references.push('CANONICAL_FRONTIER_OPTIONOMICS_CONTEXT');
    }
    if (Array.isArray(input.contracts) && input.contracts.length > 0
      && canonicalJson(input.contracts) === canonicalJson(snapshot.contractCandidates ?? null)) {
      packedInput = { ...packedInput, contracts: [] };
      references.push('CANONICAL_FRONTIER_CONTRACTS');
    }
    canonicalFrontierInput = packedInput;
  }
  return { evidence: { ...value, snapshot, strategyFrontier, canonicalFrontierInput }, references };
}

function unpackCycleEvidence(value: unknown): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('FUSION_CYCLE_ARCHIVE_INVALID');
  const packed = value as Record<string, unknown>;
  if (packed.format !== 'THETA_PACKED_CYCLE_V3' || packed.evidence === null
    || typeof packed.evidence !== 'object' || Array.isArray(packed.evidence)
    || !Array.isArray(packed.references)) throw new Error('FUSION_CYCLE_ARCHIVE_INVALID');
  const evidence = packed.evidence as Record<string, JsonValue>;
  let snapshot = object(evidence.snapshot);
  let strategyFrontier = evidence.strategyFrontier ?? null;
  const hasCanonicalFrontierInput = Object.hasOwn(evidence, 'canonicalFrontierInput');
  let canonicalFrontierInput = evidence.canonicalFrontierInput ?? null;
  const seen = new Set<string>();
  for (const reference of packed.references) {
    if (typeof reference !== 'string' || seen.has(reference)) throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
    seen.add(reference);
    if (reference === 'OPTIONOMICS_RAW_OBSERVATION_PAYLOAD') {
      const optionomics = object(snapshot.optionomicsFeatureState);
      const rawObservation = object(optionomics.rawObservation);
      const observations = Array.isArray(optionomics.rawObservations) ? optionomics.rawObservations : [];
      const first = object(observations[0]);
      if (rawObservation.payload !== null || first.payload === undefined) throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
      snapshot = { ...snapshot, optionomicsFeatureState: {
        ...optionomics, rawObservation: { ...rawObservation, payload: first.payload },
      } };
    } else if (reference === 'CANONICAL_FRONTIER_CONTRACTS') {
      if (canonicalFrontierInput === null || typeof canonicalFrontierInput !== 'object'
        || Array.isArray(canonicalFrontierInput) || !Array.isArray(snapshot.contractCandidates)) {
        throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
      }
      const input = canonicalFrontierInput as Record<string, JsonValue>;
      if (!Array.isArray(input.contracts) || input.contracts.length !== 0) throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
      canonicalFrontierInput = { ...input, contracts: snapshot.contractCandidates };
    } else if (reference === 'STRATEGY_FRONTIER_OPTIONOMICS_CONTEXT'
      || reference === 'CANONICAL_FRONTIER_OPTIONOMICS_CONTEXT') {
      const features = object(object(snapshot.optionomicsFeatureState).features);
      if (Object.keys(features).length === 0) throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
      if (reference === 'STRATEGY_FRONTIER_OPTIONOMICS_CONTEXT') {
        if (strategyFrontier === null || typeof strategyFrontier !== 'object' || Array.isArray(strategyFrontier)
          || (strategyFrontier as Record<string, JsonValue>).optionomicsContext !== null) {
          throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
        }
        strategyFrontier = { ...strategyFrontier, optionomicsContext: features };
      } else {
        if (canonicalFrontierInput === null || typeof canonicalFrontierInput !== 'object'
          || Array.isArray(canonicalFrontierInput)
          || (canonicalFrontierInput as Record<string, JsonValue>).optionomicsContext !== null) {
          throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
        }
        canonicalFrontierInput = { ...canonicalFrontierInput, optionomicsContext: features };
      }
    } else if (reference === 'OPTIONOMICS_FEATURE_CONTRACTS_V1') {
      const state = object(snapshot.optionomicsFeatureState);
      const features = object(state.features);
      const marker = object(features.contracts);
      if (marker.storageState !== 'REBUILD_FROM_NORMALIZED_OPTION_CHAIN_V1'
        || typeof marker.fullStateHash !== 'string') throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
      const rebuilt = rebuildFeatureContracts(snapshot);
      if (rebuilt === null || hash(canonicalJson(rebuilt)) !== marker.fullStateHash) {
        throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
      }
      snapshot = { ...snapshot, optionomicsFeatureState: { ...state,
        features: { ...features, contracts: rebuilt },
      } };
    } else throw new Error('FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID');
  }
  return hasCanonicalFrontierInput
    ? { ...evidence, snapshot, strategyFrontier, canonicalFrontierInput }
    : { ...evidence, snapshot, strategyFrontier };
}

export function projectCycleEvidenceForPostgres(cycle: ThetaShadowCycleResult): PostgresCycleEvidenceProjection {
  if (cycle.fusionSnapshot === null) throw new Error('FUSION_SNAPSHOT_NOT_AVAILABLE');
  const fullSnapshot = cycle.fusionSnapshot.snapshot;
  const allContracts = Array.isArray(fullSnapshot.contractCandidates) ? fullSnapshot.contractCandidates : [];
  const ids = referencedContractIds(cycle);
  const projectedContracts = allContracts.filter((contract) => {
    const identity = contractIdentity(contract);
    return identity !== null && ids.has(identity);
  });
  const snapshot: Readonly<Record<string, JsonValue>> = {
    ...fullSnapshot,
    contractCandidates: projectedContracts,
    optionomicsFeatureState: optionomicsManifest(fullSnapshot.optionomicsFeatureState),
    regimeState: compactRegimeState(fullSnapshot.regimeState, ids),
    riskState: compactRiskState(fullSnapshot.riskState, ids),
  };
  const snapshotJson = canonicalJson(snapshot);
  const snapshotBytes = Buffer.byteLength(snapshotJson);
  assertInlinePayloadWithinPolicy({
    classification: 'CANONICAL_AUDIT', serializedBytes: snapshotBytes,
    errorCode: 'FUSION_SNAPSHOT_POLICY_PAYLOAD_TOO_LARGE',
  });
  if (snapshotBytes > MAX_PROJECTION_BYTES) throw new Error(`FUSION_SNAPSHOT_PROJECTION_TOO_LARGE:${snapshotBytes}`);
  const archiveValue = {
    contractVersion: postgresCycleEvidenceStorageVersion,
    snapshotContentHash: cycle.fusionSnapshot.contentHash,
    snapshot: fullSnapshot,
    strategyFrontier: cycle.strategyFrontier,
    thetaQ: cycle.orchestration?.thetaQ ?? null,
    // Preserve each assessed finalist's own risk result. The representative
    // assessment and frontier blocker codes cannot reconstruct a four-finalist
    // family matrix after the cycle has ended.
    aegisByCandidateId: cycle.orchestration?.aegisByCandidateId ?? {},
    decisionReceipt: cycle.orchestration?.receipt ?? null,
    shadowOpportunities: cycle.orchestration?.shadowOpportunities ?? [],
    // Phase 1 Zero-Unknown Reclosure Pass 3 (T0 replay wiring, item 4): the
    // EXACT object buildCanonicalStrategyFrontier ran on -- reuses this
    // already-existing evidence archive rather than a new/duplicate store,
    // since `snapshot` above already retains the same real contracts this
    // largely overlaps with. An additive field, backward compatible with
    // every existing reader of this contract version (see
    // export-schema-drift-detector.ts's REQUIRED_ARCHIVE_FIELDS, which this
    // does not remove or rename any entry of).
    canonicalFrontierInput: cycle.canonicalFrontierInput,
    // Micro-fix (persisted method-provenance closure): the already-computed
    // per-method input-realness evidence for this exact cycle -- never
    // recomputed here. Persisted alongside canonicalFrontierInput so a
    // post-deploy verification reads durable evidence, never a transient
    // in-memory result.
    methodInputProvenance: cycle.methodInputProvenance,
  };
  const archiveJson = canonicalJson(archiveValue as unknown as JsonValue);
  const packed = packCycleEvidence(archiveValue);
  const packedJson = canonicalJson({ format: 'THETA_PACKED_CYCLE_V3',
    evidence: packed.evidence, references: packed.references } as JsonValue);
  // The outer gzip preserves the existing bytea/backup contract. Brotli's
  // larger window can deduplicate distant option-chain evidence without
  // dropping a single decisive or research field from the decoded archive.
  const compressed = brotliCompressSync(Buffer.from(packedJson), { params: {
    [constants.BROTLI_PARAM_QUALITY]: 6,
    [constants.BROTLI_PARAM_LGWIN]: 24,
  } });
  const archive = gzipSync(Buffer.concat([packedArchivePrefix, compressed]), { level: 1 });
  if (archive.byteLength > MAX_COMPRESSED_ARCHIVE_BYTES && process.env.VERCEL_ENV === 'production') {
    const optionomics = object(fullSnapshot.optionomicsFeatureState);
    const bytes = (value: unknown): number => Buffer.byteLength(canonicalJson(value as JsonValue));
    const compressedBytes = (value: unknown): number => brotliCompressSync(Buffer.from(canonicalJson(value as JsonValue)), {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6, [constants.BROTLI_PARAM_LGWIN]: 24 },
    }).byteLength;
    // The governed cap still fails closed. Sizes alone identify which evidence
    // tier needs work without logging provider responses or changing replay.
    console.error(JSON.stringify({ event: 'THETA_CYCLE_ARCHIVE_OVERSIZE_V1',
      archiveBytes: archive.byteLength, snapshotBytes: bytes(fullSnapshot),
      contractCandidatesBytes: bytes(allContracts),
      optionomicsRawObservationsBytes: bytes(optionomics.rawObservations ?? null),
      optionomicsRawObservationsCompressedBytes: compressedBytes(optionomics.rawObservations ?? null),
      optionomicsFeaturesBytes: bytes(optionomics.features ?? null),
      optionomicsFeaturesCompressedBytes: compressedBytes(optionomics.features ?? null),
      optionomicsOptionChainBytes: bytes(optionomics.optionChain ?? null),
      optionomicsOptionChainCompressedBytes: compressedBytes(optionomics.optionChain ?? null),
      optionomicsFlowBytes: bytes(optionomics.netFlowWindows ?? null),
      frontierBytes: bytes(cycle.strategyFrontier), thetaQBytes: bytes(cycle.orchestration?.thetaQ ?? null),
      canonicalFrontierInputBytes: bytes(cycle.canonicalFrontierInput ?? null),
    }));
  }
  assertInlinePayloadWithinPolicy({
    classification: 'SHORT_RETENTION_OBSERVATION', serializedBytes: archive.byteLength,
    errorCode: 'FUSION_CYCLE_ARCHIVE_POLICY_PAYLOAD_TOO_LARGE',
  });
  if (archive.byteLength > MAX_COMPRESSED_ARCHIVE_BYTES) {
    throw new Error(`FUSION_CYCLE_ARCHIVE_TOO_LARGE:${archive.byteLength}`);
  }
  return {
    snapshot,
    snapshotProjectionHash: hash(snapshotJson),
    fullContractCount: allContracts.length,
    projectedContractCount: projectedContracts.length,
    archive,
    archiveHash: hash(archiveJson),
    archiveUncompressedBytes: Buffer.byteLength(archiveJson),
    archiveCompressedBytes: archive.byteLength,
  };
}

export function decodeCycleEvidenceArchive(archive: Buffer): Record<string, JsonValue> {
  const uncompressed = gunzipSync(archive);
  const value = uncompressed.subarray(0, packedArchivePrefix.length).equals(packedArchivePrefix)
    ? unpackCycleEvidence(JSON.parse(brotliDecompressSync(uncompressed.subarray(packedArchivePrefix.length)).toString('utf8')))
    : JSON.parse(uncompressed.toString('utf8')) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('FUSION_CYCLE_ARCHIVE_INVALID');
  const record = value as Record<string, JsonValue>;
  if (record.contractVersion !== postgresCycleEvidenceStorageVersion
    && record.contractVersion !== previousStorageVersion) throw new Error('FUSION_CYCLE_ARCHIVE_VERSION_INVALID');
  return record;
}

export function projectCanonicalFrontierForPostgres(frontier: CanonicalStrategyFrontier): {
  readonly projection: Readonly<Record<string, JsonValue>>; readonly projectionHash: string;
} {
  const keep = new Set<string>([
    frontier.selectedCandidateId,
    frontier.nearMissCandidateId,
    frontier.bestRejectedCandidateId,
    ...frontier.branches.flatMap((branch) => [branch.bestCandidateId, branch.secondBestCandidateId, branch.bestRejectedCandidateId]),
  ].filter((value): value is string => value !== null));
  const adaptive = frontier.adaptiveShadowDecision;
  const projection: Readonly<Record<string, JsonValue>> = {
    ...frontier,
    branches: frontier.branches.map((branch) => ({
      ...branch,
      candidates: branch.candidates.filter((candidate) => keep.has(candidate.candidateId)),
    })),
    optionomicsContext: {
      storageState: 'FULL_STATE_IN_COMPRESSED_CYCLE_ARCHIVE',
      fullStateHash: hash(canonicalJson(frontier.optionomicsContext)),
    },
    adaptiveShadowDecision: adaptive === undefined ? null : {
      ...adaptive,
      storageState: 'FULL_STATE_IN_COMPRESSED_CYCLE_ARCHIVE',
      fullStateHash: hash(canonicalJson(adaptive)),
      shadowComparison: {
        ...adaptive.shadowComparison,
        cohorts: adaptive.shadowComparison.cohorts.map((cohort) => ({
          cohortId: cohort.cohortId,
          sourceCandidateIds: cohort.sourceCandidateIds,
          structuralParetoCandidateIds: cohort.structuralParetoCandidateIds,
          structuralLeaderCandidateId: cohort.structuralLeaderCandidateId,
          structuralLeaderState: cohort.structuralLeaderState,
          unresolvedDimensions: cohort.unresolvedDimensions,
          candidateCount: cohort.candidates.length,
        })),
        excluded: adaptive.shadowComparison.excluded.map((entry) => ({
          candidateId: entry.candidateId, reasons: entry.reasons,
        })),
      },
    },
  } as unknown as Readonly<Record<string, JsonValue>>;
  const projectionJson = canonicalJson(projection);
  const bytes = Buffer.byteLength(projectionJson);
  assertInlinePayloadWithinPolicy({
    classification: 'CANONICAL_AUDIT', serializedBytes: bytes,
    errorCode: 'CANONICAL_FRONTIER_POLICY_PAYLOAD_TOO_LARGE',
  });
  if (bytes > MAX_PROJECTION_BYTES) throw new Error(`CANONICAL_FRONTIER_PROJECTION_TOO_LARGE:${bytes}`);
  return { projection, projectionHash: hash(projectionJson) };
}

export function projectDecisionReceiptForPostgres(value: Record<string, unknown>): {
  readonly projection: Record<string, unknown>; readonly projectionHash: string;
} {
  const authority = value.authority as CanonicalStrategyFrontier | null | undefined;
  const projection = authority === null || authority === undefined
    ? value : { ...value, authority: projectCanonicalFrontierForPostgres(authority).projection };
  const projectionJson = canonicalJson(projection as JsonValue);
  const bytes = Buffer.byteLength(projectionJson);
  assertInlinePayloadWithinPolicy({
    classification: 'CANONICAL_AUDIT', serializedBytes: bytes,
    errorCode: 'DECISION_RECEIPT_POLICY_PAYLOAD_TOO_LARGE',
  });
  if (bytes > MAX_PROJECTION_BYTES) throw new Error(`DECISION_RECEIPT_PROJECTION_TOO_LARGE:${bytes}`);
  return { projection, projectionHash: hash(projectionJson) };
}
