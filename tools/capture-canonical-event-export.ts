import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { canonicalEventExportContract, canonicalExportHash, type CanonicalEventExport } from '../src/research/canonical-event-export.js';

interface WorkerIdentity { readonly workerId: string; readonly buildSha: string }
const root = resolve(process.cwd());
const identity = JSON.parse((await readFile(resolve(root, '.theta-local-worker/runtime.json'), 'utf8')).replace(/^\uFEFF/, '')) as WorkerIdentity;
const token = (await readFile(resolve(root, '.theta-local-worker/worker.token'), 'utf8')).trim();
if (!/^[a-z0-9_.:-]{8,160}$/i.test(identity.workerId) || !/^[0-9a-f]{40}$/.test(identity.buildSha) || token.length < 32)
  throw new Error('LOCAL_WORKER_IDENTITY_INVALID');
const response = await fetch('https://trading-bots-one.vercel.app/api/theta-runtime', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Theta-Worker-Id': identity.workerId,
    'X-Theta-Host-Id': hostname(), 'X-Theta-Build-Sha': identity.buildSha,
    'X-Theta-Operation': 'canonical-event-export' }, signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`CANONICAL_EVENT_EXPORT_HTTP_${response.status}`);
const body = await response.json() as { artifact?: CanonicalEventExport; orderSubmission?: string };
const artifact = body.artifact;
if (!artifact || artifact.exportContractVersion !== canonicalEventExportContract || body.orderSubmission !== 'DISABLED'
  || artifact.sanitized !== true || artifact.rowCount !== artifact.rows.length
  || artifact.evidenceIds.length !== artifact.rowCount || new Set(artifact.evidenceIds).size !== artifact.rowCount
  || artifact.contentHash !== canonicalExportHash(artifact.rows)) throw new Error('CANONICAL_EVENT_EXPORT_INVALID');
const mainSha = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
if (artifact.canonicalSourceSha !== mainSha || artifact.releaseEvidence.canonicalSourceSha !== mainSha)
  throw new Error('CANONICAL_EVENT_EXPORT_MAIN_SHA_MISMATCH');
const outputDir = resolve(root, 'research_exports', 'canonical-events');
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, `${artifact.contentHash}.json`);
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }).catch((error: unknown) => {
  if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return;
  throw error;
});
process.stdout.write(`${JSON.stringify({ state: 'CAPTURED', path: outputPath, rowCount: artifact.rowCount,
  scope: artifact.scope, symbolCount: artifact.symbolCount, contentHash: artifact.contentHash,
  canonicalSourceSha: artifact.canonicalSourceSha, orderSubmission: 'DISABLED' })}\n`);
