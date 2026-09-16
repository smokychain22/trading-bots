import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const path = resolve(process.argv[2] ?? '.theta-local-worker/legacy-recovery/neon-control-plane-manifest.json');
const endpoint = process.env.THETA_RUNTIME_ENDPOINT ?? 'https://trading-bots-one.vercel.app/api/theta-runtime';
const token = process.env.THETA_OPERATOR_TOKEN ?? '';
const buildSha = process.env.THETA_BUILD_SHA ?? '';
if (token.length < 32) throw new Error('THETA_OPERATOR_TOKEN_REQUIRED');
if (!/^[0-9a-f]{7,40}$/.test(buildSha)) throw new Error('THETA_BUILD_SHA_REQUIRED');

const bytes = await readFile(path);
const manifest = JSON.parse(bytes.toString('utf8'));
const canonical = stableStringify(manifest);
const datasetHash = sha256(canonical);
const importBatchId = randomUUID();
const artifactRecordId = randomUUID();
const fileSha256 = sha256(bytes);
const capturedAt = new Date(manifest.capturedAt).toISOString();
const start = await post({
  kind: 'START', importBatchId, sourceProjectHash: sha256(`NEON_LEGACY:${manifest.project.id}`),
  sourceBranch: 'control-plane', artifactType: 'NEON_CONTROL_PLANE_MANIFEST', datasetHash,
  schemaVersion: String(manifest.schemaVersion), sourceWindowStart: capturedAt, sourceWindowEnd: capturedAt,
  originalExportedAt: capturedAt, declaredRowCount: 1,
  metadata: { runtimeAuthority: false, projectName: manifest.project.name, branchCount: manifest.branches.length,
    quotaState: manifest.quota.state, containsSecrets: false },
  files: [{ artifactFileId: randomUUID(), fileName: basename(path), byteLength: (await stat(path)).size,
    fileSha256, classification: 'REAL_PRODUCTION_EVIDENCE' }],
});
const resolvedBatchId = start.receipt.importBatchId;
if (Number(start.receipt.importedRowCount ?? 0) === 0) {
  await post({ kind: 'RECORDS', importBatchId: resolvedBatchId, sourceFamily: 'controlPlaneManifest', records: [{
    artifactRecordId, sourceRecordKey: `${manifest.project.id}:${capturedAt}`,
    sourceChecksum: datasetHash, originalCreatedAt: capturedAt, originalUpdatedAt: null,
    classification: 'REAL_PRODUCTION_EVIDENCE', pitEligibility: 'UNKNOWN', payload: manifest,
  }] });
}
const completed = await post({ kind: 'COMPLETE', importBatchId: resolvedBatchId, expectedRowCount: 1 });
process.stdout.write(`${JSON.stringify({ state: completed.receipt.state, importBatchId: resolvedBatchId,
  importedRowCount: completed.receipt.importedRowCount, datasetHash, executionAuthorized: false })}\n`);

async function post(body) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json',
    authorization: `Bearer ${token}`, 'x-theta-operation': 'database-legacy-import',
    'x-theta-database-change': 'AIVEN_BOOTSTRAP_050', 'x-theta-worker-id': 'codex-neon-manifest-import',
    'x-theta-host-id': 'windows-owner', 'x-theta-build-sha': buildSha }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`LEGACY_MANIFEST_IMPORT_HTTP_${response.status}:${result.failureCode ?? result.error ?? 'UNKNOWN'}`);
  return result;
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
