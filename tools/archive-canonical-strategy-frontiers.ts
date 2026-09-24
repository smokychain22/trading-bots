import process from 'node:process';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { archiveCanonicalStrategyFrontiers } from '../src/storage/canonical-frontier-local-archive.js';
import {
  archiveRetryAllowed,
  classifyArchiveFailure,
  writeArchiveHealth,
} from '../src/storage/local-research-archive-health.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

const value = (prefix: string): string | undefined =>
  process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

const environmentFile = value('--environment-file=') ?? '.env.local';
const spoolPath = value('--sqlite=') ?? '.theta-local-worker/research-spool/theta-research.sqlite';
const healthPath = value('--health=') ?? '.theta-local-worker/research-spool/archive-health.json';
const parquetRoot = value('--parquet-root=') ?? 'C:\\ProjectBackups\\trading-bots\\research-archives';
const sourceSha = value('--source-sha=');
const since = value('--since=');
const limitRaw = value('--limit=');
const duckdbVerificationRaw = value('--duckdb-verification=');
const duckdbVerification = duckdbVerificationRaw === 'PASS' || duckdbVerificationRaw === 'FAILED'
  || duckdbVerificationRaw === 'NOT_AVAILABLE' ? duckdbVerificationRaw : undefined;
const now = new Date();
if (process.argv.includes('--health-only')) {
  const health = writeArchiveHealth({
    healthPath, spoolPath, parquetRoot, observedAt: now,
    archiveState: 'HEALTH_REFRESHED', outcome: 'UNCHANGED',
    duckdbVerificationOverride: duckdbVerification,
  });
  process.stdout.write(`${JSON.stringify({ state: health.archiveState, researchRowCount: 0, health })}\n`);
  process.exit(0);
}
if (sourceSha === undefined || since === undefined) throw new Error('LOCAL_ARCHIVE_SOURCE_SHA_AND_SINCE_REQUIRED');
if (!archiveRetryAllowed(healthPath, now)) {
  const health = writeArchiveHealth({
    healthPath, spoolPath, parquetRoot, observedAt: now,
    archiveState: 'DEFERRED_TRANSFER_QUOTA_COOLDOWN', outcome: 'UNCHANGED',
  });
  process.stdout.write(`${JSON.stringify({ state: health.archiveState, researchRowCount: 0, health })}\n`);
  process.exit(0);
}
const environment = loadEnvironmentFile(environmentFile);
const pool = createRuntimePostgresPool(environment.DATABASE_URL);
try {
  writeArchiveHealth({
    healthPath, spoolPath, parquetRoot, observedAt: now,
    archiveState: 'ARCHIVE_QUERY_IN_PROGRESS', outcome: 'RETRYING',
  });
  try {
    const report = await archiveCanonicalStrategyFrontiers({
      pool,
      spoolPath,
      sourceSha,
      since,
      limit: limitRaw === undefined ? 10_000 : Number(limitRaw),
    });
    const health = writeArchiveHealth({
      healthPath, spoolPath, parquetRoot, observedAt: new Date(),
      archiveState: report.state, outcome: 'SUCCESS',
    });
    process.stdout.write(`${JSON.stringify({ ...report, health })}\n`);
  } catch (error) {
    const failureFamily = classifyArchiveFailure(error);
    const quota = failureFamily === 'DATABASE_RESOURCE_QUOTA';
    const health = writeArchiveHealth({
      healthPath, spoolPath, parquetRoot, observedAt: new Date(),
      archiveState: quota ? 'DEFERRED_TRANSFER_QUOTA' : 'FAILED_NONCRITICAL',
      outcome: quota ? 'QUOTA_EXHAUSTED' : 'FAILURE', failureFamily,
    });
    const safe = { state: health.archiveState, researchRowCount: 0, failureFamily, health };
    if (quota) process.stdout.write(`${JSON.stringify(safe)}\n`);
    else {
      process.stderr.write(`${JSON.stringify(safe)}\n`);
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
