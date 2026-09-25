import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { JsonValue } from '../market/fusion-snapshot.js';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import type { CanonicalStrategyFrontier } from './canonical-strategy-frontier.js';
import type { ThetaShadowCycleResult } from './theta-shadow-cycle.js';

export const postgresCycleEvidenceStorageVersion = 'theta-postgres-cycle-evidence-storage-v2' as const;
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
  if (snapshotBytes > MAX_PROJECTION_BYTES) throw new Error(`FUSION_SNAPSHOT_PROJECTION_TOO_LARGE:${snapshotBytes}`);
  const archiveValue = {
    contractVersion: postgresCycleEvidenceStorageVersion,
    snapshotContentHash: cycle.fusionSnapshot.contentHash,
    snapshot: fullSnapshot,
    strategyFrontier: cycle.strategyFrontier,
    thetaQ: cycle.orchestration?.thetaQ ?? null,
    decisionReceipt: cycle.orchestration?.receipt ?? null,
    shadowOpportunities: cycle.orchestration?.shadowOpportunities ?? [],
  };
  const archiveJson = canonicalJson(archiveValue as unknown as JsonValue);
  const archive = gzipSync(Buffer.from(archiveJson), { level: 9 });
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
  const value = JSON.parse(gunzipSync(archive).toString('utf8')) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('FUSION_CYCLE_ARCHIVE_INVALID');
  const record = value as Record<string, JsonValue>;
  if (record.contractVersion !== postgresCycleEvidenceStorageVersion) throw new Error('FUSION_CYCLE_ARCHIVE_VERSION_INVALID');
  return record;
}

export function projectCanonicalFrontierForPostgres(frontier: CanonicalStrategyFrontier): {
  readonly projection: CanonicalStrategyFrontier; readonly projectionHash: string;
} {
  const keep = new Set<string>([
    frontier.selectedCandidateId,
    frontier.nearMissCandidateId,
    frontier.bestRejectedCandidateId,
    ...frontier.branches.flatMap((branch) => [branch.bestCandidateId, branch.secondBestCandidateId, branch.bestRejectedCandidateId]),
  ].filter((value): value is string => value !== null));
  const projection = {
    ...frontier,
    branches: frontier.branches.map((branch) => ({
      ...branch,
      candidates: branch.candidates.filter((candidate) => keep.has(candidate.candidateId)),
    })),
  };
  const projectionJson = canonicalJson(projection as unknown as JsonValue);
  const bytes = Buffer.byteLength(projectionJson);
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
  if (bytes > MAX_PROJECTION_BYTES) throw new Error(`DECISION_RECEIPT_PROJECTION_TOO_LARGE:${bytes}`);
  return { projection, projectionHash: hash(projectionJson) };
}
