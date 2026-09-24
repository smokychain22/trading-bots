import process from 'node:process';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { archiveCanonicalStrategyFrontiers } from '../src/storage/canonical-frontier-local-archive.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

const value = (prefix: string): string | undefined =>
  process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

const environmentFile = value('--environment-file=') ?? '.env.local';
const spoolPath = value('--sqlite=') ?? '.theta-local-worker/research-spool/theta-research.sqlite';
const sourceSha = value('--source-sha=');
const since = value('--since=');
const limitRaw = value('--limit=');
if (sourceSha === undefined || since === undefined) throw new Error('LOCAL_ARCHIVE_SOURCE_SHA_AND_SINCE_REQUIRED');
const environment = loadEnvironmentFile(environmentFile);
const pool = createRuntimePostgresPool(environment.DATABASE_URL);
try {
  const report = await archiveCanonicalStrategyFrontiers({
    pool,
    spoolPath,
    sourceSha,
    since,
    limit: limitRaw === undefined ? 10_000 : Number(limitRaw),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await pool.end();
}
