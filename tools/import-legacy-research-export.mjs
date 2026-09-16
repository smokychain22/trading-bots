import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? '');
const endpoint = process.env.THETA_RUNTIME_ENDPOINT ?? 'https://trading-bots-one.vercel.app/api/theta-runtime';
const token = process.env.THETA_OPERATOR_TOKEN ?? '';
const buildSha = process.env.THETA_BUILD_SHA ?? '';
if (!process.argv[2]) throw new Error('EXPORT_DIRECTORY_REQUIRED');
if (token.length < 32) throw new Error('THETA_OPERATOR_TOKEN_REQUIRED');
if (!/^[0-9a-f]{7,40}$/.test(buildSha)) throw new Error('THETA_BUILD_SHA_REQUIRED');

const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const dataset = JSON.parse(await readFile(resolve(directory, 'dataset.json'), 'utf8'));
if (dataset.datasetHash !== manifest.datasetHash || basename(directory) !== manifest.datasetHash)
  throw new Error('DATASET_IDENTITY_MISMATCH');
const declaredRowCount = Object.values(manifest.rowCounts).reduce((sum, value) => sum + Number(value), 0);
const sourceProjectHash = sha256('NEON_LEGACY:skillswap7/trading-bots:production');
const fileNames = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
const files = [];
for (const fileName of fileNames) {
  const path = resolve(directory, fileName);
  const bytes = await readFile(path);
  files.push({ artifactFileId: randomUUID(), fileName, byteLength: (await stat(path)).size,
    fileSha256: sha256(bytes), classification: 'REAL_PRODUCTION_EVIDENCE' });
}

const start = await post({
  kind: 'START', importBatchId: randomUUID(), sourceProjectHash, sourceBranch: 'main', artifactType: 'R6_DATASET',
  datasetHash: manifest.datasetHash, schemaVersion: manifest.schemaVersion,
  sourceWindowStart: new Date(manifest.sourceWindow.start).toISOString(),
  sourceWindowEnd: new Date(manifest.sourceWindow.end).toISOString(),
  originalExportedAt: new Date(manifest.exportedAt).toISOString(), declaredRowCount,
  metadata: { sourceClass: 'REAL_POINT_IN_TIME_SHADOW', featureSetVersion: manifest.featureSetVersion,
    strategyVersions: manifest.strategyVersions, localArtifactInventory: true }, files,
});
const importBatchId = start.receipt.importBatchId;
let submitted = Number(start.receipt.importedRowCount ?? 0);
process.stdout.write(JSON.stringify({ state: 'STARTED', importBatchId, declaredRowCount, alreadyImported: submitted }) + '\n');

for (const [sourceFamily, rows] of Object.entries(dataset.rows)) {
  if (!Array.isArray(rows) || rows.length === 0) continue;
  let batch = [];
  let batchBytes = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const payload = rows[index];
    const sourceRecordKey = recordKey(sourceFamily, payload, index);
    const record = {
      artifactRecordId: randomUUID(), sourceRecordKey,
      sourceChecksum: sha256(`${sourceFamily}\0${sourceRecordKey}\0${JSON.stringify(payload)}`),
      originalCreatedAt: recordTimestamp(payload), originalUpdatedAt: null,
      classification: sourceFamily === 'executionEvidence' ? 'REAL_PROVIDER_EVIDENCE' : 'REAL_PRODUCTION_EVIDENCE',
      pitEligibility: 'ELIGIBLE', payload,
    };
    const recordBytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
    if (batch.length > 0 && batchBytes + recordBytes > 850_000) {
      const result = await post({ kind: 'RECORDS', importBatchId, sourceFamily, records: batch });
      submitted = Number(result.receipt.importedRowCount);
      process.stdout.write(JSON.stringify({ state: 'IMPORTING', sourceFamily, importedRowCount: submitted }) + '\n');
      batch = [];
      batchBytes = 0;
    }
    batch.push(record);
    batchBytes += recordBytes;
  }
  if (batch.length > 0) {
    const result = await post({ kind: 'RECORDS', importBatchId, sourceFamily, records: batch });
    submitted = Number(result.receipt.importedRowCount);
    process.stdout.write(JSON.stringify({ state: 'IMPORTING', sourceFamily, importedRowCount: submitted }) + '\n');
  }
}

const complete = await post({ kind: 'COMPLETE', importBatchId, expectedRowCount: declaredRowCount });
process.stdout.write(JSON.stringify({ state: complete.receipt.state, importBatchId,
  importedRowCount: complete.receipt.importedRowCount, datasetHash: manifest.datasetHash }) + '\n');

async function post(body) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`,
      'x-theta-operation': 'database-legacy-import', 'x-theta-database-change': 'AIVEN_BOOTSTRAP_050',
      'x-theta-worker-id': 'codex-legacy-import', 'x-theta-host-id': 'windows-owner', 'x-theta-build-sha': buildSha },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`LEGACY_IMPORT_HTTP_${response.status}:${result.failureCode ?? result.error ?? 'UNKNOWN'}`);
  return result;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function recordKey(family, payload, index) {
  if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (/Id$/.test(key) && typeof value === 'string' && value.length > 0) return value;
    }
    if (typeof payload.contentHash === 'string' && /^[0-9a-f]{64}$/.test(payload.contentHash)) return payload.contentHash;
  }
  return `${family}:${index}`;
}

function recordTimestamp(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['decisionTime','observedAt','resolutionTimestamp','decisionTimestamp','createdAt']) {
    const value = payload[key];
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}
