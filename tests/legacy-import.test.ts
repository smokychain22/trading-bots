import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyImportRequestSchema } from '../src/database/legacy-import.js';

test('legacy import contract requires explicit provenance and rejects unknown fields', () => {
  const start = legacyImportRequestSchema.parse({
    kind: 'START', importBatchId: '00000000-0000-4000-8000-000000000001',
    sourceProjectHash: 'a'.repeat(64), sourceBranch: 'main', artifactType: 'R6_DATASET',
    datasetHash: 'b'.repeat(64), schemaVersion: 'theta-r6-dataset-v6',
    sourceWindowStart: '2026-09-14T13:30:34.540Z', sourceWindowEnd: '2026-09-15T15:46:13.375Z',
    originalExportedAt: '2026-09-15T15:46:25.718Z', declaredRowCount: 1, metadata: { sourceClass: 'REAL_POINT_IN_TIME_SHADOW' },
    files: [{ artifactFileId: '00000000-0000-4000-8000-000000000002', fileName: 'dataset.json', byteLength: 12,
      fileSha256: 'c'.repeat(64), classification: 'REAL_PRODUCTION_EVIDENCE' }],
  });
  assert.equal(start.kind, 'START');
  assert.throws(() => legacyImportRequestSchema.parse({ ...start, unexpected: true }));
});

test('legacy record contract preserves UNKNOWN rather than promoting it', () => {
  const request = legacyImportRequestSchema.parse({
    kind: 'RECORDS', importBatchId: '00000000-0000-4000-8000-000000000001', sourceFamily: 'candidates',
    records: [{ artifactRecordId: '00000000-0000-4000-8000-000000000003', sourceRecordKey: 'candidate-1',
      sourceChecksum: 'd'.repeat(64), originalCreatedAt: null, originalUpdatedAt: null,
      classification: 'UNKNOWN', pitEligibility: 'UNKNOWN', payload: { value: null } }],
  });
  assert.equal(request.records[0]?.classification, 'UNKNOWN');
  assert.equal(request.records[0]?.pitEligibility, 'UNKNOWN');
});
