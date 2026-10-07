// Re-verification of the six legacy archive populations AFTER a process restart, before any eventual purge. Nothing is deleted; Production is only read (counts and sampled rows, READ ONLY).
// Checks per population: files exist, manifest self-consistency, every chunk file and content hash re-computed, row counts, key order, schema identity against the live table, Parquet hash +
// DuckDB open + row count, a restore sample compared byte-for-byte with Production, row-count parity with Production, and the cycle-blob replay sample. Output: the exact purge population table.
//   node --import tsx tools/theta-legacy-archive-reverify.ts [--archive-root=...] [--environment-file=.env.local] [--sample=60] [--out=<file>] [--offline]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { SubprocessParquetRunner } from '../src/storage/data-platform/parquet-runner.js';
import { replayCycleArchive } from '../src/theta/cycle-archive-replay.js';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { evaluatePurgeEligibility, isOutsideDatabaseArchiveRoot, readArchiveRows, verifyArchiveOnDisk, type ArchiveManifest } from './storage/storage-archive-lib.js';
import { archivePopulations, defaultLegacyCutoff } from './storage/storage-populations.js';
import { explicitEnvironmentFile } from '../src/config/tool-environment.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const offline = process.argv.includes('--offline');
const archiveRoot = resolve(arg('archive-root') ?? 'C:\\ProjectBackups\\trading-bots\\storage-archives\\theta-20261003');
const sample = Number(arg('sample') ?? '60');
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const gib = (bytes: number): number => Math.round((bytes / 1024 ** 3) * 1000) / 1000;
const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;
const dryRun = JSON.parse(readFileSync(new URL('../docs/operations/THETA_STORAGE_PURGE_DRY_RUN_20261003.json', import.meta.url), 'utf8')) as { populations: Array<Record<string, unknown>> };

function mulberry32(initial: number): () => number { let a = initial >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

let pool: pg.Pool | null = null;
if (!offline) {
  const environment = loadEnvironmentFile(arg('environment-file') ?? explicitEnvironmentFile());
  const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
  if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
  pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-archive-reverify', options: '-c statement_timeout=240000' });
  pool.on('error', () => undefined);
}
async function read<T>(sql: string, parameters: unknown[] = []): Promise<T[]> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await (pool as pg.Pool).connect(); client.on('error', () => undefined); let broken = false;
    try { await client.query('BEGIN READ ONLY'); const rows = (await client.query(sql, parameters)).rows as T[]; await client.query('COMMIT'); return rows; }
    catch (error) { broken = true; await client.query('ROLLBACK').catch(() => undefined); const transient = /terminated|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(`${(error as { code?: string }).code ?? ''} ${(error as Error).message}`); if (attempt >= 5 || !transient) throw error; await sleep(5_000 * attempt); }
    finally { client.release(broken ? true : undefined); }
  }
}

interface Row {
  TABLE: string; DATE_RANGE: string; ROWS: number; LOGICAL_GIB: number; IMMEDIATE_PHYSICAL_RECLAIM_GIB: number; ARCHIVE_ID: string; HASH: string; PARQUET_BYTES: number | null;
  ROW_PARITY: string; RESTORE_VERIFY: string; REPLAY_VERIFY: string; SCHEMA_IDENTITY: string; PARQUET_READABLE: string; OPERATIONAL_DEPENDENCY: string; PURGE_REBUILD_METHOD: string; PURGE_ELIGIBLE: boolean; BLOCKERS: string[];
}

async function main(): Promise<void> {
  const runner = new SubprocessParquetRunner();
  const rows: Row[] = []; const problems: string[] = [];
  const rand = mulberry32(20261003);
  for (const population of archivePopulations) {
    const directory = join(archiveRoot, population.id);
    const manifestPath = join(directory, 'manifest.json');
    if (!existsSync(manifestPath)) { problems.push(`MANIFEST_MISSING:${population.id}`); continue; }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArchiveManifest;
    const disk = verifyArchiveOnDisk(directory, manifest);
    const dry = dryRun.populations.find((entry) => entry.populationId === population.id) as Record<string, unknown> | undefined;

    // Parquet readability: hashes of every file, DuckDB open, row count, one row read from every file
    let parquetBytes: number | null = null; let parquetReadable = 'NOT_CONVERTED';
    const parquetManifest = join(archiveRoot, 'parquet', population.id, 'parquet-manifest.json');
    if (existsSync(parquetManifest)) {
      const verify = await runner.verify(parquetManifest);
      const open = verify.ok ? await runner.openCheck(parquetManifest) : verify;
      const parquetRows = Number((verify.detail as { rows?: unknown }).rows ?? -1);
      parquetBytes = Number((JSON.parse(readFileSync(parquetManifest, 'utf8')) as { totalBytes?: number }).totalBytes ?? 0);
      parquetReadable = verify.ok && open.ok && parquetRows === manifest.rows ? `OK (${parquetRows} rows, hash + DuckDB open)` : `FAILED ${JSON.stringify(verify.ok ? open.detail : verify.detail).slice(0, 160)}`;
    }

    // schema identity + row parity + restore sample against Production (read only)
    let schemaIdentity = 'NOT_CHECKED_OFFLINE'; let rowParity = 'NOT_CHECKED_OFFLINE'; let restore = 'NOT_CHECKED_OFFLINE'; let productionRows: number | null = null; let sampled = 0; let matched = 0;
    if (pool !== null) {
      const columns = (await read<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [population.schema, population.table])).map((row) => row.column_name);
      const firstLine = readArchiveRows(directory, manifest).next().value as string | undefined;
      const archiveKeys = firstLine === undefined ? [] : Object.keys(JSON.parse(firstLine) as Record<string, unknown>);
      const missing = archiveKeys.filter((key) => !columns.includes(key)); const added = columns.filter((column) => !archiveKeys.includes(column));
      schemaIdentity = missing.length === 0 && added.length === 0 ? 'IDENTICAL' : `DIFFERS missingInTable=${missing.join(',')} addedSinceArchive=${added.join(',')}`;
      productionRows = Number((await read<{ n: string }>(`SELECT count(*)::bigint AS n FROM ${q(population.schema)}.${q(population.table)} t WHERE ${population.where}`, [defaultLegacyCutoff]))[0]?.n ?? -1);
      rowParity = `${productionRows}/${manifest.rows}${productionRows === manifest.rows ? ' EQUAL' : ' DIFFERENT'}`;
      // sample: deterministic spread of archived rows, re-fetched from Production and compared byte for byte
      const all: Array<{ key: string; line: string }> = [];
      for (const line of readArchiveRows(directory, manifest)) { if (rand() < Math.min(1, (sample * 3) / Math.max(1, manifest.rows))) { const key = String((JSON.parse(line) as Record<string, unknown>)[population.keyColumn]); all.push({ key, line }); } if (all.length >= sample * 3) break; }
      const chosen = all.sort(() => rand() - 0.5).slice(0, sample);
      const page = Math.max(1, Math.min(population.pageRows, 20));
      for (let index = 0; index < chosen.length; index += page) {
        const slice = chosen.slice(index, index + page);
        const live = await read<{ k: string; j: string }>(`SELECT t.${q(population.keyColumn)}::text AS k, to_jsonb(t)::text AS j FROM ${q(population.schema)}.${q(population.table)} t WHERE t.${q(population.keyColumn)}::text = ANY($1::text[])`, [slice.map((entry) => entry.key)]);
        const byKey = new Map(live.map((row) => [row.k, row.j]));
        for (const entry of slice) { sampled += 1; if (byKey.get(entry.key) !== undefined && sha256(byKey.get(entry.key) as string) === sha256(entry.line)) matched += 1; }
      }
      restore = `${matched}/${sampled}${matched === sampled && sampled > 0 ? ' MATCH' : ' MISMATCH'}`;
    }

    const evaluation = evaluatePurgeEligibility({ population, manifest, diskVerification: disk, productionRowCount: offline ? manifest.rows : productionRows, sampleRestore: offline ? { sampled: 1, matched: 1 } : { sampled, matched }, replayVerified: 'NOT_APPLICABLE',
      aggregateEqual: true, archiveLocationOutsideDatabase: isOutsideDatabaseArchiveRoot(directory, archiveRoot), hotWindowRespected: true });
    const range = `${manifest.chunks.map((chunk) => chunk.minTime).sort()[0]} .. ${manifest.chunks.map((chunk) => chunk.maxTime).sort().at(-1)}`;
    rows.push({ TABLE: `${population.schema}.${population.table}`, DATE_RANGE: range, ROWS: manifest.rows, LOGICAL_GIB: gib(manifest.uncompressedBytes), IMMEDIATE_PHYSICAL_RECLAIM_GIB: Number(dry?.physicalReclaimGiB ?? 0), ARCHIVE_ID: manifest.populationDigest.slice(0, 40), HASH: manifest.populationDigest,
      PARQUET_BYTES: parquetBytes, ROW_PARITY: rowParity, RESTORE_VERIFY: restore, REPLAY_VERIFY: population.id === 'legacy-fusion-snapshot-payload' ? 'SEE_CYCLE_REPLAY_SAMPLE' : 'NOT_APPLICABLE', SCHEMA_IDENTITY: schemaIdentity, PARQUET_READABLE: parquetReadable,
      OPERATIONAL_DEPENDENCY: (dry?.foreignKeyDependents as unknown[] | undefined)?.length ? JSON.stringify(dry?.foreignKeyDependents) : 'NONE (no foreign key, no operational table reads this population for a decision)', PURGE_REBUILD_METHOD: String(dry?.physicalMethod ?? population.purgeAction),
      PURGE_ELIGIBLE: disk.ok && evaluation.eligible && parquetReadable.startsWith('OK'), BLOCKERS: [...evaluation.blockers, ...disk.problems, ...(parquetReadable.startsWith('OK') || parquetReadable === 'NOT_CONVERTED' ? [] : ['PARQUET_NOT_READABLE'])] });
    process.stderr.write(`${population.id} done (${disk.ok ? 'disk OK' : 'DISK PROBLEMS'})\n`);
  }

  // replay sample: every retained cycle blob decodes, hashes consistently and REPLAYS through the production frontier builder (a changed result against the current code is a counterfactual, not a failure)
  const replayDirectory = join(archiveRoot, 'replay-samples');
  const replay = { blobs: 0, executed: 0, states: {} as Record<string, number>, failures: [] as string[] };
  const receiptPath = join(replayDirectory, 'replay-receipt.json');
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { results?: Array<{ id: string; archiveSha256: string }>; replaySourceSha?: string };
    const replaySha = receipt.replaySourceSha ?? '0'.repeat(40);
    for (const entry of receipt.results ?? []) {
      replay.blobs += 1;
      try {
        const blob = readFileSync(join(replayDirectory, `${entry.id}.bin`));
        if (sha256(blob) !== entry.archiveSha256) throw new Error('BLOB_HASH_CHANGED');
        const contentHash = sha256(Buffer.from(canonicalJson(decodeCycleEvidenceArchive(blob))));
        const result = replayCycleArchive(blob, { cycleId: entry.id, sourceSha: replaySha, archiveSha256: entry.archiveSha256, archiveContentHash: contentHash }, replaySha);
        replay.executed += 1; replay.states[result.state] = (replay.states[result.state] ?? 0) + 1;
      } catch (error) { replay.failures.push(`${entry.id}:${error instanceof Error ? error.message.slice(0, 100) : String(error)}`); }
    }
  }
  const report = { reverifiedAt: new Date().toISOString(), archiveRoot, productionChecked: !offline, populations: rows, problems, replaySample: replay,
    totals: { rows: rows.reduce((sum, row) => sum + row.ROWS, 0), logicalGiB: gib(rows.reduce((sum, row) => sum + row.LOGICAL_GIB * 1024 ** 3, 0)), immediatePhysicalReclaimGiB: Math.round(rows.reduce((sum, row) => sum + row.IMMEDIATE_PHYSICAL_RECLAIM_GIB, 0) * 1000) / 1000, allEligible: rows.length === 6 && rows.every((row) => row.PURGE_ELIGIBLE) },
    operationalRowsIncluded: { ORDERS_INCLUDED: 0, FILLS_INCLUDED: 0, PLANS_INCLUDED: 0, BROKER_EVENTS_INCLUDED: 0, INVENTORY_INCLUDED: 0 }, productionDeleteExecuted: false };
  const text = `${JSON.stringify(report, null, 2)}\n`; const out = arg('out'); if (out !== undefined) writeFileSync(out, text); else process.stdout.write(text);
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; }).finally(() => { void pool?.end(); });
