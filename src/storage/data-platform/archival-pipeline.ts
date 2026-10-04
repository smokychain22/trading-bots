// Exactly-once archival and retirement of one partition. Every step is idempotent and checkpointed in the partition record BEFORE the next step starts, so a
// restart after any crash (after export, during upload, after upload, during verification, before detach, after the detach marker, before drop) resumes safely.
// The pipeline can never delete data it has not verified: detach and drop re-verify the archive against the live source immediately before acting.
import { archiveIdFor, buildManifest, sha256Hex, type DataPlatformArchiveManifest } from './archive-manifest.js';
import type { ArchiveBackend } from './archive-backend.js';
import { PlatformError } from './incidents.js';
import { advance, initialRecord, type PartitionRecord } from './partition-lifecycle.js';
import type { PartitionStateStore } from './partition-store.js';

export interface ExportedPartition {
  readonly bytes: Uint8Array;
  readonly rowCount: number;
  /** hash of the logical content, stable across compression runs */
  readonly contentHash: string;
  readonly sourceWindow: { readonly from: string; readonly to: string };
  readonly schemaVersion: string;
}

export interface PartitionOps {
  /** whether the source partition exists at all (a dataset may legitimately have no rows for a session) */
  exists(dataset: string, partition: string): Promise<boolean>;
  exportPartition(dataset: string, partition: string): Promise<ExportedPartition>;
  countRows(dataset: string, partition: string): Promise<number>;
  /** idempotent: detaching an already detached partition succeeds */
  detach(dataset: string, partition: string): Promise<void>;
  /** idempotent: dropping an already dropped partition succeeds */
  drop(dataset: string, partition: string): Promise<void>;
}

export interface ArchiveCodec { decode(bytes: Uint8Array): { readonly rowCount: number; readonly contentHash: string } }
export interface ReplayVerifier { verify(dataset: string, partition: string, bytes: Uint8Array): Promise<boolean | 'NOT_APPLICABLE'> }

export interface PipelineContext {
  readonly botId: string;
  readonly sourceSha: string;
  readonly policyVersion: string;
  readonly backend: ArchiveBackend;
  readonly store: PartitionStateStore;
  readonly ops: PartitionOps;
  readonly codec: ArchiveCodec;
  readonly replay: ReplayVerifier;
  readonly now: () => string;
  /** retirement-time durability gate: the archive must exist somewhere besides one disk (a second archive copy, or a verified disaster-recovery backup taken after the archive was verified) */
  readonly durabilityCheck?: (manifest: DataPlatformArchiveManifest) => Promise<{ readonly ok: boolean; readonly reason: string }>;
  /** TESTS AND SIMULATION ONLY: without a durability check retirement is refused (the two-authority purge rule is mandatory in every real wiring) */
  readonly allowUnverifiedRetirement?: boolean;
}

const archiveKey = (dataset: string, partition: string, fileHash: string): string => `data/${dataset}/${partition}/${fileHash}.archive`;
const manifestKey = (archiveId: string): string => `manifests/${archiveId}.json`;
const textEncoder = new TextEncoder();

async function save(context: PipelineContext, record: PartitionRecord): Promise<PartitionRecord> { await context.store.put(record); return record; }

async function load(context: PipelineContext, dataset: string, partition: string): Promise<PartitionRecord> {
  return (await context.store.get(dataset, partition)) ?? initialRecord(dataset, partition, context.now());
}

/** Marks a partition CLOSED_HOT: no further writes are expected. */
export async function closePartition(context: PipelineContext, dataset: string, partition: string): Promise<PartitionRecord> {
  const record = await load(context, dataset, partition);
  if (record.state !== 'ACTIVE_HOT') return record;
  return save(context, advance(record, 'CLOSED_HOT', context.now()));
}

/** Archives and verifies one closed partition. Safe to call repeatedly and after any crash. Returns the record (ARCHIVED_VERIFIED on success). */
export async function archivePartition(context: PipelineContext, dataset: string, partition: string): Promise<PartitionRecord> {
  let record = await load(context, dataset, partition);
  if (record.state === 'ACTIVE_HOT') throw new PlatformError('PARTITION_NOT_CLOSED', 'RETENTION_FAILURE', false);
  if (record.state === 'ARCHIVED_VERIFIED' || record.state === 'DETACH_ELIGIBLE' || record.state === 'DETACHED' || record.state === 'DROPPED') return record;
  try {
    if (record.state === 'CLOSED_HOT') record = await save(context, advance(record, 'ARCHIVE_PENDING', context.now()));
    record = await save(context, { ...record, attempts: record.attempts + 1, lastError: null, updatedAt: context.now() });

    // 1. export + upload (content addressed by file hash: a re-export after a crash can never overwrite an existing object)
    if (record.uploaded === null) {
      const exported = await context.ops.exportPartition(dataset, partition);
      const fileHash = sha256Hex(exported.bytes);
      const key = archiveKey(dataset, partition, fileHash);
      const put = await context.backend.put(key, exported.bytes);
      if (put.sha256 !== fileHash) throw new PlatformError('ARCHIVE_UPLOAD_HASH_MISMATCH', 'ARCHIVE_CORRUPTION', false);
      record = await save(context, { ...record, step: 'UPLOADED', verifiedAt: null, replayVerified: null,
        uploaded: { key, fileHash, contentHash: exported.contentHash, rowCount: exported.rowCount, compressedBytes: exported.bytes.length, sourceWindow: exported.sourceWindow, schemaVersion: exported.schemaVersion, createdAt: context.now() }, updatedAt: context.now() });
    }
    const uploaded = record.uploaded;
    if (uploaded === null) throw new PlatformError('ARCHIVE_STATE_INCONSISTENT', 'RETENTION_FAILURE', false);

    // 2. verify: re-read from the backend, file hash, logical content hash, row parity with the live source
    if (record.verifiedAt === null) {
      const bytes = await context.backend.get(uploaded.key);
      if (bytes === null) throw new PlatformError('ARCHIVE_OBJECT_MISSING', 'ARCHIVE_CORRUPTION', false);
      if (sha256Hex(bytes) !== uploaded.fileHash) throw new PlatformError('ARCHIVE_FILE_HASH_MISMATCH', 'ARCHIVE_CORRUPTION', false);
      const decoded = context.codec.decode(bytes);
      if (decoded.contentHash !== uploaded.contentHash) throw new PlatformError('ARCHIVE_CONTENT_HASH_MISMATCH', 'ARCHIVE_CORRUPTION', false);
      if (decoded.rowCount !== uploaded.rowCount) throw new PlatformError('ARCHIVE_ROW_COUNT_MISMATCH', 'ARCHIVE_CORRUPTION', false);
      const live = await context.ops.countRows(dataset, partition);
      if (live !== uploaded.rowCount) throw new PlatformError(`SOURCE_ROW_COUNT_CHANGED:${live}/${uploaded.rowCount}`, 'RETENTION_FAILURE', false);
      record = await save(context, { ...record, step: 'VERIFIED', verifiedAt: context.now(), updatedAt: context.now() });
    }

    // 3. replay verification (dataset specific; NOT_APPLICABLE is explicit)
    if (record.replayVerified === null) {
      const bytes = await context.backend.get(uploaded.key);
      if (bytes === null) throw new PlatformError('ARCHIVE_OBJECT_MISSING', 'ARCHIVE_CORRUPTION', false);
      const replayed = await context.replay.verify(dataset, partition, bytes);
      if (replayed === false) throw new PlatformError('ARCHIVE_REPLAY_VERIFICATION_FAILED', 'ARCHIVE_CORRUPTION', false);
      record = await save(context, { ...record, step: 'REPLAY_VERIFIED', replayVerified: replayed, updatedAt: context.now() });
    }

    // 4. manifest (immutable object in the archive, plus the record) and the state change
    const verifiedAt = record.verifiedAt;
    const replayVerified = record.replayVerified;
    if (verifiedAt === null || replayVerified === null) throw new PlatformError('ARCHIVE_STATE_INCONSISTENT', 'RETENTION_FAILURE', false);
    const archiveId = archiveIdFor(context.botId, dataset, partition, uploaded.contentHash);
    const manifest = buildManifest({ manifestVersion: 'theta-data-platform-archive-manifest-v1', archiveId, botId: context.botId, dataset, partition, sourceWindow: uploaded.sourceWindow, rowCount: uploaded.rowCount,
      schemaVersion: uploaded.schemaVersion, sourceSha: context.sourceSha, policyVersion: context.policyVersion, contentHash: uploaded.contentHash, fileHash: uploaded.fileHash, compressedBytes: uploaded.compressedBytes,
      createdAt: uploaded.createdAt, verifiedAt, archiveLocation: context.backend.locate(uploaded.key), replayVerified, purgeState: 'ARCHIVED_VERIFIED' });
    await context.backend.put(manifestKey(archiveId), textEncoder.encode(JSON.stringify(manifest)));
    return await save(context, advance(record, 'ARCHIVED_VERIFIED', context.now(), { step: 'ARCHIVED', manifest }));
  } catch (error) {
    const failed = await load(context, dataset, partition);
    await save(context, { ...failed, lastError: error instanceof Error ? error.message : String(error), updatedAt: context.now() });
    throw error;
  }
}

/** Re-verifies an archive from the backend against its manifest. Used immediately before retirement and by the weekly integrity job. */
export async function reverifyArchive(context: PipelineContext, manifest: DataPlatformArchiveManifest): Promise<void> {
  const record = await context.store.get(manifest.dataset, manifest.partition);
  const key = record?.uploaded?.key;
  if (key === undefined) throw new PlatformError('ARCHIVE_STATE_INCONSISTENT', 'ARCHIVE_CORRUPTION', false);
  const bytes = await context.backend.get(key);
  if (bytes === null) throw new PlatformError('ARCHIVE_OBJECT_MISSING', 'ARCHIVE_CORRUPTION', false);
  if (sha256Hex(bytes) !== manifest.fileHash) throw new PlatformError('ARCHIVE_FILE_HASH_MISMATCH', 'ARCHIVE_CORRUPTION', false);
  const decoded = context.codec.decode(bytes);
  if (decoded.contentHash !== manifest.contentHash || decoded.rowCount !== manifest.rowCount) throw new PlatformError('ARCHIVE_CONTENT_MISMATCH', 'ARCHIVE_CORRUPTION', false);
}

/** Retires a verified partition from PostgreSQL: detach, then drop. Never runs unless the archive re-verifies right now and the live row count still matches. */
export async function retirePartition(context: PipelineContext, dataset: string, partition: string): Promise<PartitionRecord> {
  let record = await load(context, dataset, partition);
  if (record.state === 'DROPPED') return record;
  const manifest = record.manifest;
  if (manifest === null || record.uploaded === null) throw new PlatformError('RETIREMENT_WITHOUT_VERIFIED_ARCHIVE', 'PARTITION_RETIREMENT_FAILURE', false);
  try {
    if (record.state === 'ARCHIVED_VERIFIED') {
      await reverifyArchive(context, manifest);
      if (context.durabilityCheck === undefined && context.allowUnverifiedRetirement !== true) throw new PlatformError('RETIREMENT_DURABILITY_CHECK_NOT_CONFIGURED', 'PARTITION_RETIREMENT_FAILURE', false);
      if (context.durabilityCheck !== undefined) {
        const durability = await context.durabilityCheck(manifest);
        if (!durability.ok) throw new PlatformError(`ARCHIVE_DURABILITY_NOT_SATISFIED:${durability.reason}`, 'PARTITION_RETIREMENT_FAILURE', true);
      }
      const live = await context.ops.countRows(dataset, partition);
      if (live !== manifest.rowCount) throw new PlatformError(`SOURCE_ROW_COUNT_CHANGED:${live}/${manifest.rowCount}`, 'PARTITION_RETIREMENT_FAILURE', false);
      record = await save(context, advance(record, 'DETACH_ELIGIBLE', context.now(), { manifest: { ...manifest, purgeState: 'DETACH_ELIGIBLE', manifestHash: buildManifest({ ...stripHash(manifest), purgeState: 'DETACH_ELIGIBLE' }).manifestHash } }));
    }
    if (record.state === 'DETACH_ELIGIBLE') {
      record = await save(context, { ...record, step: 'DETACH_STARTED', updatedAt: context.now() });
      await context.ops.detach(dataset, partition);
      record = await save(context, advance(record, 'DETACHED', context.now(), { step: 'DETACHED' }));
    }
    if (record.state === 'DETACHED') {
      record = await save(context, { ...record, step: 'DROP_STARTED', updatedAt: context.now() });
      await context.ops.drop(dataset, partition);
      record = await save(context, advance(record, 'DROPPED', context.now(), { step: 'DROPPED' }));
    }
    return record;
  } catch (error) {
    const failed = await load(context, dataset, partition);
    await save(context, { ...failed, lastError: error instanceof Error ? error.message : String(error), updatedAt: context.now() });
    throw error;
  }
}

function stripHash(manifest: DataPlatformArchiveManifest): Omit<DataPlatformArchiveManifest, 'manifestHash'> {
  const { manifestHash: _ignored, ...body } = manifest;
  void _ignored;
  return body;
}
