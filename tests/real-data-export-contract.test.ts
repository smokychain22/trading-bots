import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRealDataExport } from '../src/research/real-data-export-contract.js';

const VERSION = 'test-contract-v1';

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
  const result = loadRealDataExport({
    exportContractVersion: 'wrong-version', generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'x', rowCount: 0, rows: [],
  }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_CONTRACT_VERSION_MISMATCH');
});

test('loadRealDataExport rejects an export that is not explicitly attested sanitized', () => {
  const result = loadRealDataExport({
    exportContractVersion: VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: false, sourceDescription: 'x', rowCount: 0, rows: [],
  }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_NOT_ATTESTED_SANITIZED');
});

test('loadRealDataExport rejects an invalid generatedAt timestamp', () => {
  const result = loadRealDataExport({
    exportContractVersion: VERSION, generatedAt: 'not-a-date',
    sanitized: true, sourceDescription: 'x', rowCount: 0, rows: [],
  }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_GENERATED_AT_INVALID');
});

test('loadRealDataExport rejects a missing sourceDescription', () => {
  const result = loadRealDataExport({
    exportContractVersion: VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: '  ', rowCount: 0, rows: [],
  }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_SOURCE_DESCRIPTION_MISSING');
});

test('loadRealDataExport rejects rows that are not an array', () => {
  const result = loadRealDataExport({
    exportContractVersion: VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'x', rowCount: 0, rows: 'nope',
  }, VERSION);
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
  assert.equal(result.reason, 'EXPORT_ROWS_NOT_AN_ARRAY');
});

test('loadRealDataExport catches a rowCount that does not match the actual rows array length', () => {
  const result = loadRealDataExport({
    exportContractVersion: VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'x', rowCount: 5, rows: [{ a: 1 }],
  }, VERSION);
  assert.equal(result.status, 'EXPORT_ROW_COUNT_MISMATCH');
});

test('loadRealDataExport accepts and returns a fully valid envelope', () => {
  const result = loadRealDataExport<{ a: number }>({
    exportContractVersion: VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'x', rowCount: 2, rows: [{ a: 1 }, { a: 2 }],
  }, VERSION);
  assert.equal(result.status, 'LOADED');
  assert.equal(result.envelope?.rows.length, 2);
  assert.equal(result.envelope?.sanitized, true);
});
