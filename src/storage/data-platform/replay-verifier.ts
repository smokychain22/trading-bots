// Dataset-specific replay verification for the archival pipeline. A cycle-evidence archive is only trusted when real cycle blobs from it decode, hash to the content hash stored with
// them, and replay through the canonical frontier builder. Other datasets are NOT_APPLICABLE (explicit, never an implicit pass).
import { createHash } from 'node:crypto';
import type { ReplayVerifier } from './archival-pipeline.js';
import { decodeNdjsonGzipLines } from './ndjson-codec.js';
import { decodeCycleEvidenceArchive } from '../../theta/postgres-cycle-evidence-storage.js';
import { replayCycleArchive } from '../../theta/cycle-archive-replay.js';
import { canonicalJson } from '../../research/point-in-time-evidence.js';

const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
/** replayCycleArchive refuses compressed archives above this size (it is a local-spool bound); larger blobs are still decoded and hash-checked */
export const REPLAY_COMPRESSED_LIMIT_BYTES = 4 * 1024 * 1024;

export interface BlobReplayOutcome { readonly rows: number; readonly decoded: number; readonly replayed: number; readonly skippedForSize: number; readonly failures: readonly string[] }

/** `row.blob` is the `to_jsonb` text of a bytea: a `\x` prefixed hex string. */
export function blobFromRow(row: Record<string, unknown>): Buffer {
  const value = row.blob;
  if (typeof value !== 'string' || !value.startsWith('\\x')) throw new Error('CYCLE_BLOB_ROW_WITHOUT_HEX_BLOB');
  return Buffer.from(value.slice(2), 'hex');
}

/** a deterministic spread of the partition: the first, the last, the middle and the largest rows */
export function sampleRows(lines: readonly string[], count: number): readonly string[] {
  if (lines.length <= count) return lines;
  const picks = new Set<number>([0, lines.length - 1, Math.floor(lines.length / 2)]);
  const bySize = lines.map((line, index) => [line.length, index] as const).sort((a, b) => b[0] - a[0]);
  for (const [, index] of bySize) { if (picks.size >= count) break; picks.add(index); }
  return [...picks].sort((a, b) => a - b).map((index) => lines[index] as string);
}

export function verifyCycleBlobRows(lines: readonly string[], sourceSha: string): BlobReplayOutcome {
  let decoded = 0; let replayed = 0; let skippedForSize = 0; const failures: string[] = [];
  for (const line of lines) {
    let id = 'unknown';
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      id = String(row.fusion_snapshot_id ?? 'unknown');
      const blob = blobFromRow(row);
      const archiveHash = String(row.archive_hash ?? '');
      if (blob.length !== Number(row.compressed_bytes)) { failures.push(`${id}:BLOB_SIZE_DIFFERS_FROM_RECORDED`); continue; }
      const content = sha256(Buffer.from(canonicalJson(decodeCycleEvidenceArchive(blob))));
      decoded += 1;
      if (content !== archiveHash) { failures.push(`${id}:CONTENT_HASH_MISMATCH`); continue; }
      if (blob.length > REPLAY_COMPRESSED_LIMIT_BYTES) { skippedForSize += 1; continue; }
      replayCycleArchive(blob, { cycleId: id, sourceSha, archiveSha256: sha256(blob), archiveContentHash: archiveHash }, sourceSha);
      replayed += 1;
    } catch (error) { failures.push(`${id}:${error instanceof Error ? error.message.slice(0, 120) : 'REPLAY_ERROR'}`); }
  }
  return { rows: lines.length, decoded, replayed, skippedForSize, failures };
}

export function cycleBlobReplayVerifier(sourceSha: string, sample = 3): ReplayVerifier {
  return {
    async verify(dataset, _partition, bytes) {
      if (dataset !== 'cycle-evidence-blob') return 'NOT_APPLICABLE';
      const lines = decodeNdjsonGzipLines(bytes);
      if (lines.length === 0) return true;
      const outcome = verifyCycleBlobRows(sampleRows(lines, sample), sourceSha);
      return outcome.failures.length === 0 && outcome.decoded === outcome.rows;
    },
  };
}
