import assert from 'node:assert/strict';
import test from 'node:test';
import { computeExportContentHash, loadRealDataExport } from '../src/research/real-data-export-contract.js';

const VERSION = 'test-contract-v1';
const CANONICAL_SHA = 'a'.repeat(40);

function baseEnvelope(rows: readonly unknown[] = []): Record<string, unknown> {
  return {
    exportContractVersion: VERSION, generatedAt: '2026-09-21T00:00:00Z', sanitized: true,
    sourceDescription: 'x', provider: 'OPTIONOMICS', sourceWindowStart: '2026-01-01T00:00:00Z',
    sourceWindowEnd: '2026-09-01T00:00:00Z', symbolCount: 1, canonicalSourceSha: CANONICAL_SHA,
    contentHash: computeExportContentHash(rows), rowCount: rows.length, rows,
  };
}

test('loadRealDataExport reports AWAITING_REAL_EXPORT for null/undefined input, never a validation failure', () => {
  assert.equal(loadRealDataExport(null, VERSION).status, 'AWAITING_REAL_EXPORT');
  assert.equal(loadRealDataExport(undefined, VERSION).status, 'AWAITING_REAL_EXPORT');
});

test('loadRealDataExport rejects a non-object payload', () => {
  const result = loadRealDataExport('not-an-object', VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_NOT_AN_OBJECT');
});

test('loadRealDataExport rejects a mismatched contract version rather than silently accepting an old export shape', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), exportContractVersion: 'wrong-version' }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_CONTRACT_VERSION_MISMATCH');
});

test('loadRealDataExport rejects an export that is not explicitly attested sanitized', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), sanitized: false }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_NOT_ATTESTED_SANITIZED');
});

test('loadRealDataExport rejects an invalid generatedAt timestamp', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), generatedAt: 'not-a-date' }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_GENERATED_AT_INVALID');
});

test('loadRealDataExport rejects a missing sourceDescription', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), sourceDescription: '  ' }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_SOURCE_DESCRIPTION_MISSING');
});

test('loadRealDataExport rejects a missing provider', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), provider: '' }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_PROVIDER_MISSING');
});

test('loadRealDataExport rejects an invalid or inverted source window', () => {
  const invalidStart = loadRealDataExport({ ...baseEnvelope(), sourceWindowStart: 'nope' }, VERSION);
  assert.equal(invalidStart.reason, 'EXPORT_SOURCE_WINDOW_START_INVALID');
  const invalidEnd = loadRealDataExport({ ...baseEnvelope(), sourceWindowEnd: 'nope' }, VERSION);
  assert.equal(invalidEnd.reason, 'EXPORT_SOURCE_WINDOW_END_INVALID');
  const inverted = loadRealDataExport({
    ...baseEnvelope(), sourceWindowStart: '2026-09-01T00:00:00Z', sourceWindowEnd: '2026-01-01T00:00:00Z',
  }, VERSION);
  assert.equal(inverted.reason, 'EXPORT_SOURCE_WINDOW_END_BEFORE_START');
});

test('loadRealDataExport rejects a non-positive or non-integer symbolCount', () => {
  assert.equal(loadRealDataExport({ ...baseEnvelope(), symbolCount: 0 }, VERSION).reason, 'EXPORT_SYMBOL_COUNT_INVALID');
  assert.equal(loadRealDataExport({ ...baseEnvelope(), symbolCount: 1.5 }, VERSION).reason, 'EXPORT_SYMBOL_COUNT_INVALID');
});

test('loadRealDataExport rejects a canonicalSourceSha that is not a real 40-hex-char git SHA', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), canonicalSourceSha: 'not-a-sha' }, VERSION);
  assert.equal(result.reason, 'EXPORT_CANONICAL_SOURCE_SHA_INVALID');
});

test('loadRealDataExport rejects rows that are not an array', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), rows: 'nope' }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_ROWS_NOT_AN_ARRAY');
});

test('loadRealDataExport catches a rowCount that does not match the actual rows array length', () => {
  const result = loadRealDataExport({ ...baseEnvelope([{ a: 1 }]), rowCount: 5 }, VERSION);
  assert.equal(result.status, 'EXPORT_ROW_COUNT_MISMATCH');
});

test('loadRealDataExport rejects a content hash that does not match the recomputed hash over rows -- repair for the Codex df88f3f review finding', () => {
  const result = loadRealDataExport({ ...baseEnvelope([{ a: 1 }]), contentHash: '0'.repeat(64) }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTENT_HASH_MISMATCH');
});

test('loadRealDataExport rejects a malformed (non-64-hex-char) contentHash', () => {
  const result = loadRealDataExport({ ...baseEnvelope([{ a: 1 }]), contentHash: 'short' }, VERSION);
  assert.equal(result.reason, 'EXPORT_CONTENT_HASH_INVALID');
});

test('loadRealDataExport accepts and returns a fully valid envelope', () => {
  const rows = [{ a: 1 }, { a: 2 }];
  const result = loadRealDataExport<{ a: number }>(baseEnvelope(rows), VERSION);
  assert.equal(result.status, 'LOADED');
  assert.equal(result.envelope?.rows.length, 2);
  assert.equal(result.envelope?.sanitized, true);
  assert.equal(result.envelope?.provider, 'OPTIONOMICS');
  assert.equal(result.envelope?.symbolCount, 1);
  assert.equal(result.envelope?.canonicalSourceSha, CANONICAL_SHA);
});

test('computeExportContentHash is deterministic for identical rows and differs for different rows', () => {
  const rowsA = [{ a: 1 }, { a: 2 }];
  const rowsB = [{ a: 1 }, { a: 3 }];
  assert.equal(computeExportContentHash(rowsA), computeExportContentHash(rowsA));
  assert.notEqual(computeExportContentHash(rowsA), computeExportContentHash(rowsB));
});
