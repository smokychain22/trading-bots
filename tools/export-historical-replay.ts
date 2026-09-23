import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { buildHistoricalReplayExport, type HistoricalReplayExportArtifact } from '../src/research/historical-replay-export.js';

const root = resolve(process.cwd());
const environmentFile = process.argv.find((argument) => argument.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const sessionArgument = process.argv.find((argument) => argument.startsWith('--sessions='))
  ?.slice('--sessions='.length);
const sessionDates = sessionArgument?.split(',').map((value) => value.trim()).filter(Boolean)
  ?? ['2026-09-16', '2026-09-18', '2026-09-21'];
const environment = loadEnvironmentFile(resolve(root, environmentFile), {});
if (!environment.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
const canonicalSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1, application_name: 'theta_historical_replay_export' });

try {
  const artifact = await buildHistoricalReplayExport({
    pool,
    sessionDates,
    canonicalSourceSha,
    generatedAt: new Date().toISOString(),
  });
  const outputDir = resolve(root, 'research_exports', 'historical-replay');
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `${artifact.contentHash}-${artifact.canonicalSourceSha}.json`);
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }).catch(async (error: unknown) => {
    if (error === null || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await readFile(outputPath, 'utf8')) as HistoricalReplayExportArtifact;
    if (existing.contentHash !== artifact.contentHash || existing.canonicalSourceSha !== artifact.canonicalSourceSha
      || existing.rowCount !== artifact.rowCount) throw new Error('HISTORICAL_REPLAY_EXISTING_FILE_MISMATCH');
  });
  process.stdout.write(`${JSON.stringify({
    state: 'CAPTURED',
    path: outputPath,
    rowCount: artifact.rowCount,
    symbolCount: artifact.symbolCount,
    immutableEvidenceIdCount: artifact.immutableEvidenceIdCount,
    importIssueCount: artifact.importIssueCount,
    contentHash: artifact.contentHash,
    canonicalSourceSha: artifact.canonicalSourceSha,
    brokerAuthority: false,
    orderSubmission: 'DISABLED',
  })}\n`);
} finally {
  await pool.end();
}
