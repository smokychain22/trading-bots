import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectExportSchemaDrift, assertExportSchemaCompatible, RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION,
} from '../src/research/export-schema-drift-detector.js';

function fullArchive(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    contractVersion: RESEARCH_EXPECTED_EXPORT_CONTRACT_VERSION,
    snapshotContentHash: 'hash-1', snapshot: {}, strategyFrontier: null,
    thetaQ: null, decisionReceipt: null, shadowOpportunities: [],
    ...overrides,
  };
}

test('CORE CLAIM: an exact-version, complete archive is COMPATIBLE', () => {
  const result = detectExportSchemaDrift(fullArchive());
  assert.equal(result.verdict, 'COMPATIBLE');
  assert.equal(result.missingRequiredFields.length, 0);
});

test('a missing required field is MISSING_REQUIRED_FIELD, never silently ignored', () => {
  const archive = fullArchive();
  delete (archive as Record<string, unknown>).decisionReceipt;
  const result = detectExportSchemaDrift(archive);
  assert.equal(result.verdict, 'MISSING_REQUIRED_FIELD');
  assert.deepEqual(result.missingRequiredFields, ['decisionReceipt']);
});

test('CORE CLAIM: an unknown candidate-status enum value is UNKNOWN_ENUM_VALUE, never silently accepted', () => {
  const result = detectExportSchemaDrift(fullArchive(), ['SELECTED', 'FUTURE_ENUM_CODEX_ADDED']);
  assert.equal(result.verdict, 'UNKNOWN_ENUM_VALUE');
  assert.equal(result.unknownEnumFindings.length, 1);
  assert.equal(result.unknownEnumFindings[0]?.value, 'FUTURE_ENUM_CODEX_ADDED');
});

test('a missing contractVersion field is MISSING_REQUIRED_FIELD', () => {
  const archive = fullArchive();
  delete (archive as Record<string, unknown>).contractVersion;
  const result = detectExportSchemaDrift(archive);
  assert.equal(result.verdict, 'MISSING_REQUIRED_FIELD');
});

test('a real but different (unrecognized) version string is VERSION_AHEAD_UNSUPPORTED or VERSION_BEHIND_UNSUPPORTED, never guessed compatible', () => {
  const ahead = detectExportSchemaDrift(fullArchive({ contractVersion: 'theta-postgres-cycle-evidence-storage-v3' }));
  assert.equal(ahead.verdict, 'VERSION_AHEAD_UNSUPPORTED');
  const behind = detectExportSchemaDrift(fullArchive({ contractVersion: 'theta-postgres-cycle-evidence-storage-v1' }));
  assert.equal(behind.verdict, 'VERSION_BEHIND_UNSUPPORTED');
});

test('ADVERSARIAL: assertExportSchemaCompatible throws with the exact verdict on a drifted archive', () => {
  const archive = fullArchive();
  delete (archive as Record<string, unknown>).thetaQ;
  assert.throws(() => assertExportSchemaCompatible(archive), /EXPORT_SCHEMA_DRIFT:MISSING_REQUIRED_FIELD/);
});

test('assertExportSchemaCompatible does not throw on a compatible archive', () => {
  assert.doesNotThrow(() => assertExportSchemaCompatible(fullArchive()));
});
