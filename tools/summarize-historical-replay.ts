import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashJson, type JsonValue } from '../src/market/fusion-snapshot.js';
import type { HistoricalReplayExportArtifact } from '../src/research/historical-replay-export.js';
import { summarizeHistoricalReplay } from '../src/research/historical-replay-summary.js';

const root = resolve(process.cwd());
const input = process.argv.find((argument) => argument.startsWith('--input='))?.slice('--input='.length);
if (!input) throw new Error('HISTORICAL_REPLAY_INPUT_REQUIRED');
const artifact = JSON.parse(await readFile(resolve(root, input), 'utf8')) as HistoricalReplayExportArtifact;
if (!/^[0-9a-f]{40}$/.test(artifact.canonicalSourceSha)) throw new Error('HISTORICAL_REPLAY_SOURCE_SHA_INVALID');
execFileSync('git', ['cat-file', '-e', `${artifact.canonicalSourceSha}^{commit}`], { cwd: root, stdio: 'ignore' });
const summary = summarizeHistoricalReplay(artifact);
const summaryHash = hashJson(summary as unknown as JsonValue);
const outputDir = resolve(root, 'research_exports', 'historical-replay-summary');
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, `${summaryHash}-${summary.canonicalSourceSha}.json`);
await writeFile(outputPath, `${JSON.stringify({ ...summary, summaryHash }, null, 2)}\n`, { flag: 'wx' }).catch(async (error: unknown) => {
  if (error === null || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
  const existing = JSON.parse(await readFile(outputPath, 'utf8')) as { readonly summaryHash: string };
  if (existing.summaryHash !== summaryHash) throw new Error('HISTORICAL_REPLAY_SUMMARY_COLLISION');
});
process.stdout.write(`${JSON.stringify({
  state: 'SUMMARIZED', path: outputPath, rowCount: summary.rowCount,
  sessions: summary.sessions.map((session) => ({
    date: session.sessionDate, candidates: session.candidateCount,
    executable: session.executableCount, positiveQuantity: session.positiveQuantityCount,
    aegisUnobserved: session.aegisUnobservedCount,
    quoteAgeP95Seconds: session.quoteAgeSeconds.p95,
  })),
  falseRejectRate: summary.falseRejectRate, waitRegret: summary.waitRegret,
  brokerAuthority: false, orderSubmission: 'DISABLED',
})}\n`);
