// Partition lifecycle: ACTIVE_HOT -> CLOSED_HOT -> ARCHIVE_PENDING -> ARCHIVED_VERIFIED -> DETACH_ELIGIBLE -> DETACHED -> DROPPED.
// Pure transition rules plus the persisted record. A partition may only move forward, except that a failed integrity check sends it back to ARCHIVE_PENDING
// (never forward). No state may skip verification: DETACH_ELIGIBLE and later require a verified archive.
import type { DataPlatformArchiveManifest, PartitionState } from './archive-manifest.js';

export type ArchiveStep = 'NONE' | 'UPLOADED' | 'VERIFIED' | 'REPLAY_VERIFIED' | 'ARCHIVED' | 'DETACH_STARTED' | 'DETACHED' | 'DROP_STARTED' | 'DROPPED';

export interface UploadedArchive {
  readonly key: string;
  readonly fileHash: string;
  readonly contentHash: string;
  readonly rowCount: number;
  readonly compressedBytes: number;
  readonly sourceWindow: { readonly from: string; readonly to: string };
  readonly schemaVersion: string;
  readonly createdAt: string;
}

export interface PartitionRecord {
  readonly dataset: string;
  readonly partition: string;
  readonly state: PartitionState;
  readonly step: ArchiveStep;
  readonly uploaded: UploadedArchive | null;
  readonly verifiedAt: string | null;
  readonly replayVerified: boolean | 'NOT_APPLICABLE' | null;
  readonly manifest: DataPlatformArchiveManifest | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export const initialRecord = (dataset: string, partition: string, now: string): PartitionRecord =>
  ({ dataset, partition, state: 'ACTIVE_HOT', step: 'NONE', uploaded: null, verifiedAt: null, replayVerified: null, manifest: null, attempts: 0, lastError: null, updatedAt: now });

const FORWARD: Readonly<Record<PartitionState, readonly PartitionState[]>> = {
  ACTIVE_HOT: ['CLOSED_HOT'],
  CLOSED_HOT: ['ARCHIVE_PENDING'],
  ARCHIVE_PENDING: ['ARCHIVED_VERIFIED'],
  ARCHIVED_VERIFIED: ['DETACH_ELIGIBLE', 'ARCHIVE_PENDING'],
  DETACH_ELIGIBLE: ['DETACHED', 'ARCHIVE_PENDING'],
  DETACHED: ['DROPPED'],
  DROPPED: [],
};

export function canTransition(from: PartitionState, to: PartitionState): boolean { return FORWARD[from].includes(to); }

export function assertTransition(record: PartitionRecord, to: PartitionState): void {
  if (!canTransition(record.state, to)) throw new Error(`PARTITION_ILLEGAL_TRANSITION:${record.state}->${to}`);
  const needsVerified = to === 'ARCHIVED_VERIFIED' || to === 'DETACH_ELIGIBLE' || to === 'DETACHED' || to === 'DROPPED';
  if (needsVerified && (record.verifiedAt === null || record.uploaded === null)) throw new Error(`PARTITION_REQUIRES_VERIFIED_ARCHIVE:${to}`);
  if ((to === 'DETACHED' || to === 'DROPPED') && record.replayVerified === false) throw new Error(`PARTITION_REQUIRES_REPLAY_VERIFICATION:${to}`);
}

export function advance(record: PartitionRecord, to: PartitionState, now: string, patch: Partial<PartitionRecord> = {}): PartitionRecord {
  const next: PartitionRecord = { ...record, ...patch, state: to, updatedAt: now };
  assertTransition(record, to);
  return next;
}

/** which partitions are past their hot window: the N most recent CLOSED partitions (by partition key order) stay hot. */
export function partitionsPastHotWindow(closedPartitionKeysAscending: readonly string[], hotSessions: number): readonly string[] {
  if (!Number.isFinite(hotSessions)) return [];
  const sorted = [...closedPartitionKeysAscending].sort();
  return hotSessions >= sorted.length ? [] : sorted.slice(0, sorted.length - hotSessions);
}
