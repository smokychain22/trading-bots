import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { archiveCanonicalStrategyFrontiers } from '../src/storage/canonical-frontier-local-archive.js';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

const argument = (prefix: string): string | undefined => process.argv.slice(2)
  .find((value) => value.startsWith(prefix))?.slice(prefix.length);
const environmentFile = argument('--environment-file=') ?? '.env.local';
const spoolPath = argument('--sqlite=') ?? '.theta-local-worker/research-spool/theta-research.sqlite';
const parquetRoot = argument('--parquet-root=') ?? 'C:\\ProjectBackups\\trading-bots\\research-archives';
const verificationCache = argument('--verification-cache=')
  ?? '.theta-local-worker/research-spool/parquet-verification.json';
const sourceSha = argument('--source-sha=');
const since = argument('--since=');
const limit = Number(argument('--limit=') ?? '1000');
const maxPasses = Number(argument('--max-passes=') ?? '100');
if (sourceSha === undefined || !/^[0-9a-f]{40}$/.test(sourceSha)) {
  throw new Error('ARCHIVE_CERTIFICATION_SOURCE_SHA_REQUIRED');
}
if (since === undefined || !Number.isFinite(new Date(since).getTime())) {
  throw new Error('ARCHIVE_CERTIFICATION_SINCE_REQUIRED');
}
if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('ARCHIVE_CERTIFICATION_LIMIT_INVALID');
if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 1_000) {
  throw new Error('ARCHIVE_CERTIFICATION_MAX_PASSES_INVALID');
}

const python = existsSync('.venv\\Scripts\\python.exe') ? '.venv\\Scripts\\python.exe' : 'python';
const runJson = (command: string, args: readonly string[]): Record<string, unknown> => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const output = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
  if (result.status !== 0) throw new Error(`ARCHIVE_CERTIFICATION_CHILD_FAILED:${result.stderr.trim()}`);
  try { return JSON.parse(output) as Record<string, unknown>; }
  catch { throw new Error('ARCHIVE_CERTIFICATION_CHILD_OUTPUT_INVALID'); }
};

const environment = loadEnvironmentFile(environmentFile);
const pool = createRuntimePostgresPool(environment.DATABASE_URL);
const archiveReports: Awaited<ReturnType<typeof archiveCanonicalStrategyFrontiers>>[] = [];
try {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const report = await archiveCanonicalStrategyFrontiers({ pool, spoolPath, sourceSha, since, limit });
    archiveReports.push(report);
    if (report.coverageComplete) break;
  }
} finally { await pool.end(); }
const finalArchiveReport = archiveReports.at(-1);
if (finalArchiveReport === undefined || !finalArchiveReport.coverageComplete) {
  throw new Error('ARCHIVE_CERTIFICATION_SQLITE_COVERAGE_INCOMPLETE');
}

const beforeCompactionSpool = new LocalResearchHistorySpool(spoolPath);
const beforeCompaction = beforeCompactionSpool.stats();
const sqliteVerification = beforeCompactionSpool.verify();
beforeCompactionSpool.close();
if (!sqliteVerification.valid) throw new Error('ARCHIVE_CERTIFICATION_SQLITE_HASH_FAILED');

const compactions: Record<string, unknown>[] = [];
for (let pass = 0; pass < maxPasses; pass += 1) {
  const receipt = runJson(python, ['tools/compact-local-research-spool.py', '--sqlite', spoolPath,
    '--destination', parquetRoot, '--limit', String(limit)]);
  compactions.push(receipt);
  if (receipt.state === 'NO_PENDING_BATCHES' || Number(receipt.backlogEnd) === 0) break;
}
const afterCompactionSpool = new LocalResearchHistorySpool(spoolPath);
const afterCompaction = afterCompactionSpool.stats();
const finalSqliteVerification = afterCompactionSpool.verify();
afterCompactionSpool.close();
if (!finalSqliteVerification.valid || afterCompaction.pendingParquetBatchCount !== 0) {
  throw new Error('ARCHIVE_CERTIFICATION_COMPACTION_INCOMPLETE');
}
const parquetVerification = runJson(python, ['tools/verify-local-research-parquet.py',
  '--root', parquetRoot, '--cache', verificationCache]);
if (parquetVerification.state !== 'PASS') throw new Error('ARCHIVE_CERTIFICATION_PARQUET_VERIFY_FAILED');

process.stdout.write(`${JSON.stringify({
  contractVersion: 'theta-cycle-archive-research-export-certification-v1',
  sourceSha,
  since: new Date(since).toISOString(),
  generatedAt: new Date().toISOString(),
  postgresArchiveAuthority: 'CANONICAL_AUDIT',
  relationalCandidatePersistence: false,
  archiveMode: 'ARCHIVE_ONLY_BY_DESIGN',
  archivePassCount: archiveReports.length,
  sourceFrontierCount: finalArchiveReport.sourceFrontierCount,
  backlogStart: archiveReports[0]?.backlogStart ?? 0,
  batchesProcessed: archiveReports.reduce((sum, report) => sum + report.batchesProcessed, 0),
  backlogEnd: finalArchiveReport.backlogEnd,
  coverageComplete: finalArchiveReport.coverageComplete,
  sqliteBeforeCompaction: beforeCompaction,
  sqliteAfterCompaction: afterCompaction,
  sqliteHashVerification: finalSqliteVerification,
  parquetCompactionPassCount: compactions.length,
  parquetVerification,
  brokerAuthority: false,
})}\n`);
