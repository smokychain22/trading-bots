// EvidenceReader: replay and research code must not care whether evidence is currently HOT (PostgreSQL) or COLD (the archive). Reads hot first; when the row is gone it
// resolves the archive manifest for the partition, fetches the immutable archive object, verifies its hash against the manifest and returns the original row. Every cold
// read re-verifies the archive (hash and content hash) so a corrupted archive can never answer a replay.
import { canonicalJson, sha256Hex, type DataPlatformArchiveManifest } from './archive-manifest.js';
import type { ArchiveBackend } from './archive-backend.js';
import { PlatformError } from './incidents.js';
import { contentHashOfLines, decodeNdjsonGzipLines } from './ndjson-codec.js';
import type { PartitionStateStore } from './partition-store.js';

export type EvidenceTier = 'HOT' | 'COLD';
export interface EvidenceRow { readonly tier: EvidenceTier; readonly row: Record<string, unknown>; readonly archiveId: string | null }

export interface HotEvidenceSource {
  /** returns the row from PostgreSQL, or null when it is no longer (or not yet) hot */
  readRow(dataset: string, partition: string, keyColumn: string, key: string): Promise<Record<string, unknown> | null>;
}

export class EvidenceReader {
  /** small cache of decoded archive partitions: key column value -> row, bounded to a few partitions */
  private readonly cache = new Map<string, Map<string, Record<string, unknown>>>();
  constructor(private readonly hot: HotEvidenceSource, private readonly store: PartitionStateStore, private readonly backend: ArchiveBackend, private readonly maxCachedPartitions = 4) {}

  async readRow(dataset: string, partition: string, keyColumn: string, key: string): Promise<EvidenceRow | null> {
    const hot = await this.hot.readRow(dataset, partition, keyColumn, key);
    if (hot !== null) return { tier: 'HOT', row: hot, archiveId: null };
    const record = await this.store.get(dataset, partition);
    const manifest = record?.manifest ?? null;
    if (manifest === null || record?.uploaded === null || record?.uploaded === undefined) return null;
    const rows = await this.loadPartition(manifest, record.uploaded.key, keyColumn);
    const found = rows.get(key);
    return found === undefined ? null : { tier: 'COLD', row: found, archiveId: manifest.archiveId };
  }

  private async loadPartition(manifest: DataPlatformArchiveManifest, objectKey: string, keyColumn: string): Promise<Map<string, Record<string, unknown>>> {
    const cacheKey = `${manifest.archiveId}\u0000${keyColumn}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const bytes = await this.backend.get(objectKey);
    if (bytes === null) throw new PlatformError('ARCHIVE_OBJECT_MISSING', 'ARCHIVE_CORRUPTION', false);
    if (sha256Hex(bytes) !== manifest.fileHash) throw new PlatformError('ARCHIVE_FILE_HASH_MISMATCH', 'ARCHIVE_CORRUPTION', false);
    const lines = decodeNdjsonGzipLines(bytes);
    if (contentHashOfLines(lines) !== manifest.contentHash || lines.length !== manifest.rowCount) throw new PlatformError('ARCHIVE_CONTENT_MISMATCH', 'ARCHIVE_CORRUPTION', false);
    const rows = new Map<string, Record<string, unknown>>();
    for (const line of lines) { const row = JSON.parse(line) as Record<string, unknown>; rows.set(String(row[keyColumn]), row); }
    if (this.cache.size >= this.maxCachedPartitions) { const oldest = this.cache.keys().next().value; if (oldest !== undefined) this.cache.delete(oldest); }
    this.cache.set(cacheKey, rows);
    return rows;
  }

  /** all rows of a partition, hot if the partition still exists else cold, never both (hot wins); used by research scans */
  async readPartition(dataset: string, partition: string, keyColumn: string, hotRows: () => Promise<readonly Record<string, unknown>[] | null>): Promise<{ readonly tier: EvidenceTier; readonly rows: readonly Record<string, unknown>[] }> {
    const hot = await hotRows();
    if (hot !== null) return { tier: 'HOT', rows: hot };
    const record = await this.store.get(dataset, partition);
    if (record?.manifest === null || record?.manifest === undefined || record.uploaded === null) return { tier: 'COLD', rows: [] };
    const rows = await this.loadPartition(record.manifest, record.uploaded.key, keyColumn);
    return { tier: 'COLD', rows: [...rows.values()] };
  }
}

/** DuckDB SQL that exposes one logical dataset over two physical tiers: PostgreSQL (hot, via postgres_query) and the Parquet archive (cold). Hot wins on key overlap. */
export function logicalDatasetViewSql(options: { readonly viewName: string; readonly keyColumn: string; readonly hotRelation: string | null; readonly parquetGlob: string }): string {
  const identifier = /^[a-z_][a-z0-9_]*$/;
  if (!identifier.test(options.viewName) || !identifier.test(options.keyColumn)) throw new Error('INVALID_VIEW_IDENTIFIER');
  const cold = `SELECT * EXCLUDE (dp_session_date), 'COLD' AS tier FROM read_parquet('${options.parquetGlob.replace(/'/g, "''")}', hive_partitioning = true)`;
  if (options.hotRelation === null) return `CREATE OR REPLACE VIEW ${options.viewName} AS ${cold}`;
  return `CREATE OR REPLACE VIEW ${options.viewName} AS SELECT *, 'HOT' AS tier FROM ${options.hotRelation} UNION ALL BY NAME SELECT * FROM (${cold}) c WHERE c.${options.keyColumn} NOT IN (SELECT ${options.keyColumn} FROM ${options.hotRelation})`;
}

export { canonicalJson };
