import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inspectLegacyV1ExportHash } from '../src/research/legacy-v1-export-hash.js';
import { canonicalJson, sha256 } from '../src/research/point-in-time-evidence.js';

const rootArg = process.argv.find((arg) => arg.startsWith('--root='));
if (rootArg === undefined) throw new Error('HISTORICAL_EXPORT_ROOT_REQUIRED');
const root = resolve(rootArg.slice('--root='.length));
const shaName = /^[a-f0-9]{64}$/;
const supported = /^theta-r6-dataset-v[2-6]$/;
const report = {
  contractVersion: 'theta-historical-export-hash-audit-v1',
  sourceRoot: root,
  inspected: 0,
  producerHashReproduced: 0,
  dateElision: 0,
  dateAware: 0,
  timestampIntegrityUnprotected: 0,
  countsBySchema: {} as Record<string, number>,
  countsByVariant: {} as Record<string, number>,
  issues: [] as Array<{ directory: string; reason: string }>,
  promotionGrade: false,
};

for (const directory of readdirSync(root).filter((name) => shaName.test(name)).sort()) {
  report.inspected += 1;
  try {
    const manifest = JSON.parse(readFileSync(join(root, directory, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const artifact = JSON.parse(readFileSync(join(root, directory, 'dataset.json'), 'utf8')) as Record<string, unknown>;
    if (manifest.datasetHash !== directory || artifact.datasetHash !== directory
      || manifest.schemaVersion !== artifact.schemaVersion) {
      throw new Error('MANIFEST_ARTIFACT_IDENTITY_MISMATCH');
    }
    if (canonicalJson(manifest.rowCounts) !== canonicalJson(artifact.rowCounts)
      || canonicalJson(manifest.sourceWindow) !== canonicalJson(artifact.sourceWindow)
      || manifest.exportedAt !== artifact.exportedAt) {
      throw new Error('MANIFEST_ARTIFACT_PROVENANCE_MISMATCH');
    }
    const schema = artifact.schemaVersion;
    if (typeof schema !== 'string') throw new Error('SCHEMA_VERSION_INVALID');
    report.countsBySchema[schema] = (report.countsBySchema[schema] ?? 0) + 1;
    if (artifact.rows === null || typeof artifact.rows !== 'object' || Array.isArray(artifact.rows)
      || artifact.rowCounts === null || typeof artifact.rowCounts !== 'object'
      || Array.isArray(artifact.rowCounts)) throw new Error('ROWS_OR_COUNTS_INVALID');
    const rows = artifact.rows as Record<string, unknown>;
    for (const [family, count] of Object.entries(artifact.rowCounts as Record<string, unknown>)) {
      if (!Array.isArray(rows[family]) || rows[family].length !== count) {
        throw new Error(`ROW_COUNT_MISMATCH:${family}`);
      }
    }
    let variant: string;
    if (schema === 'theta-r6-dataset-v1') {
      const verdict = inspectLegacyV1ExportHash(artifact);
      if (verdict.state !== 'PRODUCER_HASH_REPRODUCED' || verdict.producerVariant === null) {
        throw new Error('PRODUCER_HASH_UNRESOLVED');
      }
      variant = verdict.producerVariant;
      if (verdict.timestampIntegrityProtected) report.dateAware += 1;
      else { report.dateElision += 1; report.timestampIntegrityUnprotected += 1; }
    } else {
      if (!supported.test(schema)) throw new Error('SCHEMA_VERSION_UNSUPPORTED');
      const identity = Object.fromEntries(Object.entries(artifact)
        .filter(([key]) => key !== 'datasetHash' && key !== 'exportedAt'));
      if (sha256(canonicalJson(identity)) !== directory) throw new Error('PRODUCER_HASH_UNRESOLVED');
      variant = 'DATE_AWARE_MODERN';
      report.dateAware += 1;
    }
    report.countsByVariant[variant] = (report.countsByVariant[variant] ?? 0) + 1;
    report.producerHashReproduced += 1;
  } catch (error) {
    report.issues.push({ directory, reason: error instanceof Error ? error.message.split(':', 1)[0] ?? 'UNKNOWN' : 'UNKNOWN' });
  }
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.issues.length > 0) process.exitCode = 2;
