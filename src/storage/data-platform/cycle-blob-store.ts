// Hot storage of the complete cycle evidence blob in the time-partitioned dp.cycle_evidence_blob (instead of trade.fusion_snapshot.evidence_archive_gzip, a column of an
// append-only, un-partitionable table that every foreign key points at). The sink runs INSIDE the cycle transaction; with no sink configured the store behaves exactly
// as before. A DEFAULT partition guarantees an INSERT can never fail for want of a partition (the control plane pre-creates real partitions and raises an incident if the
// default partition ever receives rows).
import type { Pool, PoolClient } from 'pg';
import { sha256Hex } from './archive-manifest.js';
import type { ArchiveBackend } from './archive-backend.js';
import { EvidenceReader } from './evidence-reader.js';
import { PostgresPartitionStateStore } from './postgres-partitions.js';

export interface CycleBlobRecord {
  readonly fusionSnapshotId: string;
  readonly decisionTimeUtc: string;
  readonly archiveHash: string;
  readonly uncompressedBytes: number;
  readonly compressedBytes: number;
  readonly blob: Buffer;
}

export type CycleBlobSink = (client: PoolClient, record: CycleBlobRecord) => Promise<void>;

/** NY trading-session date of an instant: the partition key of every session-partitioned dataset. */
export function sessionDateNewYork(instantIso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instantIso));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('SESSION_DATE_INVALID_INSTANT');
  return date;
}

export const postgresCycleBlobSink: CycleBlobSink = async (client, record) => {
  if (!/^[0-9a-f]{64}$/.test(record.archiveHash)) throw new Error('CYCLE_BLOB_ARCHIVE_HASH_INVALID');
  await client.query(
    `INSERT INTO dp.cycle_evidence_blob(fusion_snapshot_id, session_date, decided_at, archive_hash, uncompressed_bytes, compressed_bytes, blob)
     VALUES ($1, $2::date, $3::timestamptz, $4, $5, $6, $7) ON CONFLICT (fusion_snapshot_id, session_date) DO NOTHING`,
    [record.fusionSnapshotId, sessionDateNewYork(record.decisionTimeUtc), record.decisionTimeUtc, record.archiveHash, record.uncompressedBytes, record.compressedBytes, record.blob]);
};

/** The blob column value a fusion snapshot row must carry: NULL when a sink holds the bytes, the archive itself otherwise (legacy behavior). */
export const fusionArchiveColumnValue = (sinkConfigured: boolean, archive: Buffer): Buffer | null => (sinkConfigured ? null : archive);

/** Hot read of a cycle's blob from either hot location (the legacy column or the partitioned table). Null when it is no longer hot (retired and archived). */
export async function readHotCycleBlob(pool: Pool | PoolClient, fusionSnapshotId: string, dataPlatformEnabled: boolean): Promise<Buffer | null> {
  const sql = dataPlatformEnabled
    ? `SELECT COALESCE(s.evidence_archive_gzip, b.blob) AS blob FROM trade.fusion_snapshot s LEFT JOIN dp.cycle_evidence_blob b ON b.fusion_snapshot_id = s.fusion_snapshot_id WHERE s.fusion_snapshot_id = $1`
    : `SELECT s.evidence_archive_gzip AS blob FROM trade.fusion_snapshot s WHERE s.fusion_snapshot_id = $1`;
  const row = (await pool.query(sql, [fusionSnapshotId])).rows[0] as { blob: Buffer | null } | undefined;
  return row?.blob ?? null;
}

/** The SQL expression consumers select instead of `s.evidence_archive_gzip` when the data platform blob store is enabled (requires the LEFT JOIN alias `b`). */
export const cycleBlobSelectExpression = (dataPlatformEnabled: boolean): string => (dataPlatformEnabled ? 'COALESCE(s.evidence_archive_gzip, b.blob)' : 's.evidence_archive_gzip');
export const cycleBlobJoinClause = (dataPlatformEnabled: boolean): string => (dataPlatformEnabled ? 'LEFT JOIN dp.cycle_evidence_blob b ON b.fusion_snapshot_id = s.fusion_snapshot_id' : '');

export const blobIntegrity = (blob: Buffer): string => sha256Hex(blob);

/** Process-wide switch, off by default: both writer and readers must agree, and the dp schema must exist (migration 069) before it is turned on. */
export const dataPlatformBlobStoreEnabled = (environment: Readonly<Record<string, string | undefined>> = process.env): boolean => environment.THETA_DATA_PLATFORM_BLOB_STORE === '1';

/** The bytea column of an archived row is `to_jsonb` text: a `\\x` prefixed hex string. */
export function blobFromArchiveRow(row: Record<string, unknown>): Buffer {
  const value = row.blob;
  if (typeof value !== 'string' || !/^\\x([0-9a-f]{2})*$/.test(value)) throw new Error('CYCLE_BLOB_ARCHIVE_ROW_INVALID');
  return Buffer.from(value.slice(2), 'hex');
}

/** Hot first, then the verified cold archive. The cold read re-verifies the archive object against its manifest before it answers. */
export async function readCycleBlobWithColdFallback(input: { readonly pool: Pool; readonly fusionSnapshotId: string; readonly decisionTimeUtc: string; readonly backend: ArchiveBackend; readonly dataPlatformEnabled: boolean }):
  Promise<{ readonly tier: 'HOT' | 'COLD'; readonly blob: Buffer } | null> {
  const hot = await readHotCycleBlob(input.pool, input.fusionSnapshotId, input.dataPlatformEnabled);
  if (hot !== null) return { tier: 'HOT', blob: hot };
  if (!input.dataPlatformEnabled) return null;
  const reader = new EvidenceReader({ async readRow() { return null; } }, new PostgresPartitionStateStore(input.pool), input.backend);
  const cold = await reader.readRow('cycle-evidence-blob', sessionDateNewYork(input.decisionTimeUtc), 'fusion_snapshot_id', input.fusionSnapshotId);
  return cold === null ? null : { tier: 'COLD', blob: blobFromArchiveRow(cold.row) };
}
