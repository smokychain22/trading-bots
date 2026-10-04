// Measures the COLD archive size of what the normalized writer produced, from the real rows in a disposable database (theta-pit-production-measure.ts loads the real recent decisions there):
// gzip NDJSON bytes (the verified archive format) and Parquet bytes (the research format) per decision for decision-context, candidate rows and rejection histograms. Also the full cycle
// archive overhead measured on the real retained blobs. Nothing is estimated: every number is a file size.
//   node --import tsx tools/theta-cold-archive-measure.ts [--out=<file>]       (THETA_DATA_PLATFORM_FULL_DATABASE_URL, local only)
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { NdjsonGzipWriter } from '../src/storage/data-platform/ndjson-codec.js';
import { SubprocessParquetRunner } from '../src/storage/data-platform/parquet-runner.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const url = process.env.THETA_DATA_PLATFORM_FULL_DATABASE_URL;
if (url === undefined || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
const KIB = 1024;
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const sizeOfDirectory = (directory: string): number => readdirSync(directory).reduce((sum, name) => { const path = join(directory, name); return sum + (statSync(path).isDirectory() ? sizeOfDirectory(path) : statSync(path).size); }, 0);

const datasets = [
  { id: 'decision-context', table: 'dp.decision_context', order: 'decision_context_id', time: 'decided_at', key: 'decision_context_id' },
  { id: 'candidate-hot-detail', table: 'dp.pit_candidate', order: 'candidate_id', time: 'decision_time', key: 'candidate_id' },
  { id: 'candidate-ordinary-rejected', table: 'dp.rejection_histogram', order: 'decision_id', time: 'created_at', key: 'decision_id' },
] as const;

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const runner = new SubprocessParquetRunner();
  const scratch = mkdtempSync(join(tmpdir(), 'theta-cold-measure-'));
  const report: Record<string, unknown> = { measuredAt: new Date().toISOString(), method: 'files written by the real archive codec (gzip NDJSON of to_jsonb(row)) and the real Parquet converter (ZSTD, typed columns, exact row parity verified), over the rows the real writer produced for real Production decisions' };
  try {
    const decisions = Number((await pool.query('SELECT count(DISTINCT fusion_snapshot_id)::int AS n FROM dp.pit_candidate')).rows[0].n);
    report.decisions = decisions;
    const perDataset: Record<string, unknown> = {};
    for (const dataset of datasets) {
      const rows = (await pool.query(`SELECT to_jsonb(t)::text AS j FROM ${dataset.table} t ORDER BY ${dataset.order}`)).rows as Array<{ j: string }>;
      if (rows.length === 0) { perDataset[dataset.id] = { rows: 0 }; continue; }
      const writer = new NdjsonGzipWriter(); for (const row of rows) writer.write(row.j);
      const encoded = await writer.finish();
      const chunk = join(scratch, `${dataset.id}.ndjson.gz`); writeFileSync(chunk, encoded.bytes);
      const out = join(scratch, `pq-${dataset.id}`);
      const converted = await runner.convert({ chunks: [chunk], outDir: out, dataset: dataset.id, timeColumn: dataset.time, keyColumn: dataset.key, digest: sha(encoded.contentHash), producerSha: '1'.repeat(40) });
      const parquetBytes = converted.ok ? sizeOfDirectory(join(out, dataset.id)) : null;
      perDataset[dataset.id] = { rows: rows.length, logicalBytes: rows.reduce((sum, row) => sum + Buffer.byteLength(row.j), 0), ndjsonGzipBytes: encoded.bytes.length, parquetBytes, parquetOk: converted.ok, parquetDetail: converted.ok ? undefined : converted.detail };
    }
    report.datasets = perDataset;
    const ndjson = Object.values(perDataset).reduce<number>((sum, entry) => sum + (((entry as { ndjsonGzipBytes?: number }).ndjsonGzipBytes) ?? 0), 0);
    const parquet = Object.values(perDataset).reduce<number>((sum, entry) => sum + (((entry as { parquetBytes?: number | null }).parquetBytes) ?? 0), 0);
    report.perDecisionKiB = { ndjsonGzip: Math.round((ndjson / Math.max(1, decisions) / KIB) * 10) / 10, parquet: Math.round((parquet / Math.max(1, decisions) / KIB) * 10) / 10 };

    // the complete cycle archive: the real retained blobs as archive rows (hex in NDJSON, the verified archive format)
    const directory = 'C:\\ProjectBackups\\trading-bots\\storage-archives\\theta-20261003\\replay-samples';
    const blobs = readdirSync(directory).filter((name) => name.endsWith('.bin')).map((name) => readFileSync(join(directory, name)));
    const raw = blobs.reduce((sum, blob) => sum + blob.length, 0);
    const lines = blobs.map((blob, index) => JSON.stringify({ fusion_snapshot_id: `blob-${index}`, session_date: '2026-09-30', decided_at: '2026-09-30T15:00:00+00:00', archive_hash: 'a'.repeat(64), uncompressed_bytes: blob.length * 4, compressed_bytes: blob.length, blob: `\\x${blob.toString('hex')}` }));
    const cold = gzipSync(Buffer.from(`${lines.join('\n')}\n`), { level: 6 }).length;
    report.fullCycleArchive = { blobs: blobs.length, rawBlobBytes: raw, coldNdjsonGzipBytes: cold, coldOverRaw: Math.round((cold / raw) * 10000) / 10000, meanColdKiBPerDecision: Math.round(cold / blobs.length / KIB) };
  } finally { rmSync(scratch, { recursive: true, force: true }); await pool.end(); }
  const text = `${JSON.stringify(report, null, 2)}\n`; const out = arg('out'); if (out !== undefined) writeFileSync(out, text); else process.stdout.write(text);
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
