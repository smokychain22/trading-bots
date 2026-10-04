// CompactionManager: avoid millions of tiny archive files. Plans merges of small, adjacent archive files of the same dataset into files near a target size and
// verifies a merge preserves row count, lineage (every source archive id and content hash) and schema. The byte-level merge itself (Parquet via DuckDB) is done by
// the Compactor implementation; this module owns the policy and the proof obligations.
import { canonicalJson, sha256Hex } from './archive-manifest.js';

export interface ArchiveFileEntry {
  readonly archiveId: string;
  readonly dataset: string;
  readonly partition: string;
  readonly compressedBytes: number;
  readonly rowCount: number;
  readonly contentHash: string;
  readonly schemaVersion: string;
}

export interface CompactionPolicy { readonly targetBytes: number; readonly smallFileBytes: number; readonly minFilesToCompact: number }
export const defaultCompactionPolicy: CompactionPolicy = { targetBytes: 128 * 1024 ** 2, smallFileBytes: 16 * 1024 ** 2, minFilesToCompact: 4 };

export interface CompactionPlan {
  readonly fileCount: number;
  readonly averageFileBytes: number;
  readonly smallFileCount: number;
  readonly compactionRequired: boolean;
  readonly groups: readonly (readonly ArchiveFileEntry[])[];
}

export function planCompaction(entries: readonly ArchiveFileEntry[], policy: CompactionPolicy = defaultCompactionPolicy): CompactionPlan {
  const small = entries.filter((entry) => entry.compressedBytes < policy.smallFileBytes);
  const groups: ArchiveFileEntry[][] = [];
  const byDataset = new Map<string, ArchiveFileEntry[]>();
  for (const entry of small) byDataset.set(entry.dataset, [...(byDataset.get(entry.dataset) ?? []), entry]);
  for (const list of byDataset.values()) {
    const ordered = [...list].sort((a, b) => a.partition.localeCompare(b.partition));
    let current: ArchiveFileEntry[] = [];
    let bytes = 0;
    const flush = (): void => { if (current.length >= policy.minFilesToCompact || (current.length >= 2 && bytes >= policy.targetBytes * 0.5)) groups.push(current); current = []; bytes = 0; };
    for (const entry of ordered) {
      if (bytes + entry.compressedBytes > policy.targetBytes && current.length > 0) flush();
      current.push(entry);
      bytes += entry.compressedBytes;
    }
    flush();
  }
  const total = entries.reduce((sum, entry) => sum + entry.compressedBytes, 0);
  return { fileCount: entries.length, averageFileBytes: entries.length === 0 ? 0 : total / entries.length, smallFileCount: small.length, compactionRequired: groups.length > 0, groups };
}

export interface CompactedArchive {
  readonly archiveId: string;
  readonly dataset: string;
  readonly rowCount: number;
  readonly schemaVersion: string;
  readonly compressedBytes: number;
  /** lineage: every source archive this file replaces, with its logical content hash, in partition order */
  readonly sources: readonly { readonly archiveId: string; readonly partition: string; readonly contentHash: string; readonly rowCount: number }[];
  /** hash of the lineage list; recomputable by anyone holding the source manifests */
  readonly lineageHash: string;
}

export const lineageHashOf = (sources: readonly ArchiveFileEntry[]): string =>
  sha256Hex(canonicalJson([...sources].sort((a, b) => a.partition.localeCompare(b.partition)).map((source) => [source.archiveId, source.partition, source.contentHash, source.rowCount])));

export function verifyCompaction(sources: readonly ArchiveFileEntry[], merged: CompactedArchive): readonly string[] {
  const problems: string[] = [];
  if (sources.length === 0) problems.push('NO_SOURCES');
  if (new Set(sources.map((source) => source.dataset)).size > 1 || sources.some((source) => source.dataset !== merged.dataset)) problems.push('DATASET_MISMATCH');
  if (new Set(sources.map((source) => source.schemaVersion)).size > 1 || sources.some((source) => source.schemaVersion !== merged.schemaVersion)) problems.push('SCHEMA_MISMATCH');
  if (merged.rowCount !== sources.reduce((sum, source) => sum + source.rowCount, 0)) problems.push('ROW_COUNT_MISMATCH');
  const listed = new Set(merged.sources.map((source) => source.archiveId));
  if (sources.some((source) => !listed.has(source.archiveId)) || listed.size !== sources.length) problems.push('LINEAGE_INCOMPLETE');
  for (const source of sources) {
    const claimed = merged.sources.find((candidate) => candidate.archiveId === source.archiveId);
    if (claimed === undefined || claimed.contentHash !== source.contentHash || claimed.rowCount !== source.rowCount) problems.push(`LINEAGE_HASH_MISMATCH:${source.archiveId}`);
  }
  if (merged.lineageHash !== lineageHashOf(sources)) problems.push('LINEAGE_HASH_INVALID');
  return problems;
}
