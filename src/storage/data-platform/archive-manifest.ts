// Archive manifest for one immutable archived partition/dataset. Small, hashable, and the only thing PostgreSQL needs to keep about archived detail.
import { createHash } from 'node:crypto';

export const archiveManifestSchemaVersion = 'theta-data-platform-archive-manifest-v1' as const;

export const PARTITION_STATES = ['ACTIVE_HOT', 'CLOSED_HOT', 'ARCHIVE_PENDING', 'ARCHIVED_VERIFIED', 'DETACH_ELIGIBLE', 'DETACHED', 'DROPPED'] as const;
export type PartitionState = (typeof PARTITION_STATES)[number];

export interface DataPlatformArchiveManifest {
  readonly manifestVersion: typeof archiveManifestSchemaVersion;
  readonly archiveId: string;
  readonly botId: string;
  readonly dataset: string;
  /** partition key, for example the session date 2026-10-02 */
  readonly partition: string;
  readonly sourceWindow: { readonly from: string; readonly to: string };
  readonly rowCount: number;
  readonly schemaVersion: string;
  readonly sourceSha: string;
  readonly policyVersion: string;
  /** hash of the LOGICAL content (independent of compression/container) */
  readonly contentHash: string;
  /** hash of the archive file bytes */
  readonly fileHash: string;
  readonly compressedBytes: number;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
  readonly archiveLocation: string;
  readonly replayVerified: boolean | 'NOT_APPLICABLE';
  readonly purgeState: PartitionState;
  /** hash of every field above (canonical JSON), detects manifest tampering */
  readonly manifestHash: string;
}

export type ManifestBody = Omit<DataPlatformArchiveManifest, 'manifestHash'>;

const hex64 = /^[0-9a-f]{64}$/;
const sha40 = /^[0-9a-f]{40}$/;

export const sha256Hex = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** canonical JSON: keys sorted at every level, no whitespace; the same rule on every side of a hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function archiveIdFor(botId: string, dataset: string, partition: string, contentHash: string): string {
  return sha256Hex(canonicalJson(['theta-archive-id-v1', botId, dataset, partition, contentHash])).slice(0, 40);
}

export function buildManifest(body: ManifestBody): DataPlatformArchiveManifest {
  return { ...body, manifestHash: sha256Hex(canonicalJson(body)) };
}

export function validateManifest(manifest: DataPlatformArchiveManifest): readonly string[] {
  const problems: string[] = [];
  const { manifestHash, ...body } = manifest;
  if (manifest.manifestVersion !== archiveManifestSchemaVersion) problems.push('MANIFEST_VERSION');
  if (sha256Hex(canonicalJson(body)) !== manifestHash) problems.push('MANIFEST_HASH_MISMATCH');
  if (!hex64.test(manifest.contentHash)) problems.push('CONTENT_HASH_INVALID');
  if (!hex64.test(manifest.fileHash)) problems.push('FILE_HASH_INVALID');
  if (!sha40.test(manifest.sourceSha)) problems.push('SOURCE_SHA_INVALID');
  if (!Number.isInteger(manifest.rowCount) || manifest.rowCount < 0) problems.push('ROW_COUNT_INVALID');
  if (!Number.isInteger(manifest.compressedBytes) || manifest.compressedBytes < 0) problems.push('COMPRESSED_BYTES_INVALID');
  if (manifest.archiveId !== archiveIdFor(manifest.botId, manifest.dataset, manifest.partition, manifest.contentHash)) problems.push('ARCHIVE_ID_MISMATCH');
  if (manifest.archiveLocation.length === 0) problems.push('ARCHIVE_LOCATION_MISSING');
  if (manifest.verifiedAt === null && (manifest.purgeState === 'ARCHIVED_VERIFIED' || manifest.purgeState === 'DETACH_ELIGIBLE' || manifest.purgeState === 'DETACHED' || manifest.purgeState === 'DROPPED')) problems.push('STATE_REQUIRES_VERIFICATION');
  if ((manifest.purgeState === 'DETACHED' || manifest.purgeState === 'DROPPED') && manifest.replayVerified === false) problems.push('RETIRED_WITHOUT_REPLAY_VERIFICATION');
  if (!(PARTITION_STATES as readonly string[]).includes(manifest.purgeState)) problems.push('PURGE_STATE_INVALID');
  return problems;
}
