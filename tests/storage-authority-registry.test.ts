import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { authorityForClassification, classifyPostgresRelation, storageAuthorityRegistry } from '../src/storage/storage-authority-registry.js';
import {
  assertInlinePayloadWithinPolicy, datasetPolicyForClassification, storageDatasetPolicies,
} from '../src/storage/storage-dataset-policy.js';
import { evaluateRetentionDisposition } from '../src/storage/retention-policy.js';

test('storage authority keeps transactional state in PostgreSQL and research history in Parquet', () => {
  assert.equal(storageAuthorityRegistry.find((entry) => entry.family === 'SOURCE_SCHEMAS_MIGRATIONS_POLICIES_AND_REPRODUCIBILITY_METADATA')?.canonicalHome,
    'GITHUB_REPOSITORY');
  assert.equal(storageAuthorityRegistry.find((entry) => entry.family === 'DATABASE_RECOVERY_ARTIFACTS')?.canonicalHome,
    'BACKUP_STORAGE');
  assert.equal(storageAuthorityRegistry.find((entry) => entry.family === 'STRATEGY_LIFECYCLE_AND_WHOLE_CHAIN_LEDGER')?.canonicalHome, 'POSTGRESQL');
  assert.equal(storageAuthorityRegistry.find((entry) => entry.family === 'RESEARCH_DATASETS_MODELS_AND_COUNTERFACTUALS')?.canonicalHome, 'PARQUET_DUCKDB');
  assert.equal(storageAuthorityRegistry.find((entry) => entry.family === 'CANONICAL_STRATEGY_CANDIDATE_RESEARCH_HISTORY')?.runtimeState,
    'ACTIVE_LOCAL_FRONTIER_ARCHIVE');
  assert.equal(classifyPostgresRelation('broker', 'orders').classification, 'CANONICAL_TRADING_STATE');
  assert.equal(classifyPostgresRelation('research', 'option_contract_risk_history').classification, 'RESEARCH_HISTORY');
  assert.equal(classifyPostgresRelation('market', 'option_quote_observation').classification, 'SHORT_RETENTION_OBSERVATION');
  assert.equal(classifyPostgresRelation('trade', 'candidate_point_in_time_evidence').classification, 'RESEARCH_HISTORY');
  assert.equal(classifyPostgresRelation('trade', 'decision').classification, 'CANONICAL_AUDIT');
  assert.equal(classifyPostgresRelation('legacy_neon', 'artifact_record').classification, 'RESEARCH_HISTORY');
  assert.equal(classifyPostgresRelation('core', 'provider_capability').classification, 'CANONICAL_TRADING_STATE');
  assert.equal(classifyPostgresRelation('copy', 'follower_account').classification, 'CANONICAL_TRADING_STATE');
  assert.equal(classifyPostgresRelation('risk', 'aegis_iv_stress_assessment').classification, 'CANONICAL_AUDIT');
  assert.equal(classifyPostgresRelation('unknown', 'mystery').classification, 'UNKNOWN_REQUIRES_REVIEW');
  assert.equal(authorityForClassification('DERIVABLE_CACHE')?.family, 'REBUILDABLE_PROVIDER_AND_FEATURE_CACHES');
});

test('every source-defined PostgreSQL relation has a governed storage classification', () => {
  const migrationsDirectory = resolve(process.cwd(), 'migrations');
  const createRelationPattern = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/giu;
  const unknown: string[] = [];
  for (const filename of readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(resolve(migrationsDirectory, filename), 'utf8');
    for (const match of sql.matchAll(createRelationPattern)) {
      const qualified = match[1];
      if (qualified === undefined) continue;
      const [schema, relation] = qualified.split('.');
      if (schema === undefined || relation === undefined) continue;
      if (classifyPostgresRelation(schema, relation).classification === 'UNKNOWN_REQUIRES_REVIEW') {
        unknown.push(qualified.toLowerCase());
      }
    }
  }
  assert.deepEqual([...new Set(unknown)].sort(), []);
});

test('each governed relation class has one bounded storage policy', () => {
  const classifications = storageDatasetPolicies.map((policy) => policy.classification);
  assert.equal(new Set(classifications).size, classifications.length);
  assert.deepEqual([...classifications].sort(), [
    'CANONICAL_AUDIT', 'CANONICAL_TRADING_STATE', 'DERIVABLE_CACHE',
    'REDUNDANT', 'RESEARCH_HISTORY', 'SHORT_RETENTION_OBSERVATION',
  ]);
  assert.equal(datasetPolicyForClassification('UNKNOWN_REQUIRES_REVIEW'), null);
  assert.equal(datasetPolicyForClassification('RESEARCH_HISTORY')?.canonicalHome, 'PARQUET_DUCKDB');
  assert.equal(datasetPolicyForClassification('CANONICAL_TRADING_STATE')?.cleanupAuthority, 'NEVER_AUTOMATIC');
  assert.equal(datasetPolicyForClassification('SHORT_RETENTION_OBSERVATION')?.maximumInlinePayloadBytes, 4 * 1024 * 1024);
});

test('inline payload policy rejects oversized evidence without truncation', () => {
  assert.doesNotThrow(() => assertInlinePayloadWithinPolicy({
    classification: 'CANONICAL_AUDIT', serializedBytes: 768 * 1024, errorCode: 'TEST_PAYLOAD_TOO_LARGE',
  }));
  assert.throws(() => assertInlinePayloadWithinPolicy({
    classification: 'CANONICAL_AUDIT', serializedBytes: 768 * 1024 + 1, errorCode: 'TEST_PAYLOAD_TOO_LARGE',
  }), /TEST_PAYLOAD_TOO_LARGE:786433:786432/);
  assert.throws(() => assertInlinePayloadWithinPolicy({
    classification: 'RESEARCH_HISTORY', serializedBytes: -1, errorCode: 'TEST_PAYLOAD_TOO_LARGE',
  }), /STORAGE_INLINE_PAYLOAD_SIZE_INVALID/);
});

test('archive retention never permits cleanup without full parity evidence', () => {
  assert.equal(evaluateRetentionDisposition('ARCHIVE_AFTER_VERIFICATION', null), 'BLOCKED_ARCHIVE_NOT_VERIFIED');
  assert.equal(evaluateRetentionDisposition('ARCHIVE_AFTER_VERIFICATION', {
    manifestVerified: true, sourceRowCount: 2, archivedRowCount: 2,
    sourceDigest: 'a'.repeat(64), archivedDigest: 'a'.repeat(64), parquetReadable: true, schemaVerified: true,
  }), 'ELIGIBLE_FOR_GOVERNED_ARCHIVE_CLEANUP');
  assert.equal(evaluateRetentionDisposition('PERMANENT_CANONICAL', null), 'KEEP_CANONICAL');
  assert.equal(evaluateRetentionDisposition('DERIVABLE_CACHE', null), 'OWNER_APPROVAL_REQUIRED');
});
