// Lossless NDJSON(.gz) archive codec: one JSON document per line (for PostgreSQL rows, the text of `to_jsonb(row)`), gzip compressed. The logical CONTENT HASH is
// sha256 over the lines joined by "\n", independent of compression level or container, so a re-export after a crash must reproduce the same content hash.
import { createHash } from 'node:crypto';
import { createGzip, gunzipSync, gzipSync } from 'node:zlib';
import { sha256Hex } from './archive-manifest.js';
import type { ArchiveCodec } from './archival-pipeline.js';

export interface EncodedArchive { readonly bytes: Uint8Array; readonly rowCount: number; readonly contentHash: string }

export function contentHashOfLines(lines: readonly string[]): string { return sha256Hex(lines.join('\n')); }

export function encodeNdjsonGzip(lines: readonly string[]): EncodedArchive {
  for (const line of lines) if (line.includes('\n')) throw new Error('ARCHIVE_ROW_CONTAINS_NEWLINE');
  return { bytes: gzipSync(Buffer.from(lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8'), { level: 6 }), rowCount: lines.length, contentHash: contentHashOfLines(lines) };
}

export function decodeNdjsonGzipLines(bytes: Uint8Array): string[] {
  return Buffer.from(gunzipSync(bytes)).toString('utf8').split('\n').filter((line) => line.length > 0);
}

export const ndjsonGzipCodec: ArchiveCodec = {
  decode(bytes) {
    const lines = decodeNdjsonGzipLines(bytes);
    return { rowCount: lines.length, contentHash: contentHashOfLines(lines) };
  },
};

/**
 * Streaming encoder: lines are gzip-compressed and hashed as they arrive, so a large partition is never held as one giant string. The content hash is identical to
 * `contentHashOfLines` (sha256 over the lines joined by a newline).
 */
export class NdjsonGzipWriter {
  private readonly gzip = createGzip({ level: 6 });
  private readonly chunks: Buffer[] = [];
  private readonly hash = createHash('sha256');
  private count = 0;
  constructor() { this.gzip.on('data', (chunk: Buffer) => { this.chunks.push(chunk); }); }
  write(line: string): void {
    if (line.includes('\n')) throw new Error('ARCHIVE_ROW_CONTAINS_NEWLINE');
    if (this.count > 0) this.hash.update('\n');
    this.hash.update(line);
    this.gzip.write(`${line}\n`);
    this.count += 1;
  }
  async finish(): Promise<EncodedArchive> {
    await new Promise<void>((resolve, reject) => { this.gzip.once('end', resolve); this.gzip.once('error', reject); this.gzip.end(); });
    return { bytes: Buffer.concat(this.chunks), rowCount: this.count, contentHash: this.hash.digest('hex') };
  }
}
