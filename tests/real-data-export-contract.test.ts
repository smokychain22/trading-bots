import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalize, computeExportContentHash, loadRealDataExport } from '../src/research/real-data-export-contract.js';

const VERSION = 'test-contract-v1';
const CANONICAL_SHA = 'a'.repeat(40);

function evidenceIdsFor(rows: readonly unknown[]): readonly string[] {
  return rows.map((_, i) => `evidence-${i}`);
}

function baseEnvelope(rows: readonly unknown[] = []): Record<string, unknown> {
  return {
    exportContractVersion: VERSION, generatedAt: '2026-09-21T00:00:00Z', sanitized: true,
    sourceDescription: 'x', provider: 'OPTIONOMICS', sourceWindowStart: '2026-01-01T00:00:00Z',
    sourceWindowEnd: '2026-09-01T00:00:00Z', scope: 'SYMBOL_SCOPED', symbolCount: 1,
    canonicalSourceSha: CANONICAL_SHA, evidenceIds: evidenceIdsFor(rows),
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

test('loadRealDataExport rejects an invalid scope value', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), scope: 'GLOBAL' }, VERSION);
  assert.equal(result.reason, 'EXPORT_SCOPE_INVALID');
});

test('loadRealDataExport requires a positive symbolCount for SYMBOL_SCOPED/MIXED exports', () => {
  assert.equal(loadRealDataExport({ ...baseEnvelope(), scope: 'SYMBOL_SCOPED', symbolCount: 0 }, VERSION).reason,
    'EXPORT_SCOPED_EXPORT_REQUIRES_POSITIVE_SYMBOL_COUNT');
  assert.equal(loadRealDataExport({ ...baseEnvelope(), scope: 'MIXED', symbolCount: 0 }, VERSION).reason,
    'EXPORT_SCOPED_EXPORT_REQUIRES_POSITIVE_SYMBOL_COUNT');
  assert.equal(loadRealDataExport({ ...baseEnvelope(), symbolCount: 1.5 }, VERSION).reason, 'EXPORT_SYMBOL_COUNT_INVALID');
});

test('REPAIR: MARKET_WIDE exports (e.g. macro/Fed datasets) may legitimately have zero symbols', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), scope: 'MARKET_WIDE', symbolCount: 0 }, VERSION);
  assert.equal(result.status, 'LOADED');
  assert.equal(result.envelope?.scope, 'MARKET_WIDE');
  assert.equal(result.envelope?.symbolCount, 0);
});

test('loadRealDataExport rejects a MARKET_WIDE export that claims a nonzero symbolCount', () => {
  const result = loadRealDataExport({ ...baseEnvelope(), scope: 'MARKET_WIDE', symbolCount: 3 }, VERSION);
  assert.equal(result.reason, 'EXPORT_MARKET_WIDE_SCOPE_MUST_HAVE_ZERO_SYMBOL_COUNT');
});

test('loadRealDataExport rejects a canonicalSourceSha that is not a real 40-hex-char git SHA (syntax check only)', () => {
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

test('REPAIR: loadRealDataExport requires an evidenceIds manifest aligned 1:1 with rows', () => {
  const rows = [{ a: 1 }, { a: 2 }];
  const tooShort = loadRealDataExport({ ...baseEnvelope(rows), evidenceIds: ['only-one'] }, VERSION);
  assert.equal(tooShort.reason, 'EXPORT_EVIDENCE_IDS_LENGTH_MISMATCH');
  const emptyId = loadRealDataExport({ ...baseEnvelope(rows), evidenceIds: ['e0', '  '] }, VERSION);
  assert.equal(emptyId.reason, 'EXPORT_EVIDENCE_ID_EMPTY_OR_NOT_A_STRING');
  const duplicate = loadRealDataExport({ ...baseEnvelope(rows), evidenceIds: ['same', 'same'] }, VERSION);
  assert.equal(duplicate.reason, 'EXPORT_EVIDENCE_IDS_NOT_UNIQUE');
});

test('loadRealDataExport rejects a content hash that does not match the recomputed hash over rows', () => {
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
  assert.equal(result.envelope?.scope, 'SYMBOL_SCOPED');
  assert.equal(result.envelope?.symbolCount, 1);
  assert.equal(result.envelope?.canonicalSourceSha, CANONICAL_SHA);
  assert.deepEqual(result.envelope?.evidenceIds, ['evidence-0', 'evidence-1']);
});

test('canonicalize sorts object keys recursively but preserves array element order', () => {
  const value = { z: 1, a: { d: 4, b: 2 }, m: [3, 1, 2] };
  assert.deepEqual(canonicalize(value), { a: { b: 2, d: 4 }, m: [3, 1, 2], z: 1 });
});

test('REPAIR: computeExportContentHash is invariant to source key order -- the actual cross-language reproducibility requirement', () => {
  const rowsKeyOrderA = [{ a: 1, b: 2 }];
  const rowsKeyOrderB = [{ b: 2, a: 1 }]; // same data, keys written in a different order
  assert.equal(computeExportContentHash(rowsKeyOrderA), computeExportContentHash(rowsKeyOrderB));
});

test('computeExportContentHash is deterministic for identical rows and differs for genuinely different rows', () => {
  const rowsA = [{ a: 1 }, { a: 2 }];
  const rowsB = [{ a: 1 }, { a: 3 }];
  assert.equal(computeExportContentHash(rowsA), computeExportContentHash(rowsA));
  assert.notEqual(computeExportContentHash(rowsA), computeExportContentHash(rowsB));
});
