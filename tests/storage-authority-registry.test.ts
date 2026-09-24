import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPostgresRelation, storageAuthorityRegistry } from '../src/storage/storage-authority-registry.js';
import { evaluateRetentionDisposition } from '../src/storage/retention-policy.js';

test('storage authority keeps transactional state in PostgreSQL and research history in Parquet', () => {
  assert.equal(storageAuthorityRegistry.find((entry) => entry.family === 'STRATEGY_LIFECYCLE_AND_WHOLE_CHAIN_LEDGER')?.canonicalHome, 'POSTGRESQL');
  assert.equal(storageAuthorityRegistry.find((entry) => entry.family === 'RESEARCH_DATASETS_MODELS_AND_COUNTERFACTUALS')?.canonicalHome, 'PARQUET_DUCKDB');
  assert.equal(classifyPostgresRelation('broker', 'orders').classification, 'CANONICAL_TRADING_STATE');
  assert.equal(classifyPostgresRelation('research', 'option_contract_risk_history').classification, 'RESEARCH_HISTORY');
  assert.equal(classifyPostgresRelation('market', 'option_quote_observation').classification, 'SHORT_RETENTION_OBSERVATION');
  assert.equal(classifyPostgresRelation('trade', 'candidate_point_in_time_evidence').classification, 'RESEARCH_HISTORY');
  assert.equal(classifyPostgresRelation('trade', 'decision').classification, 'CANONICAL_AUDIT');
  assert.equal(classifyPostgresRelation('legacy_neon', 'artifact_record').classification, 'RESEARCH_HISTORY');
  assert.equal(classifyPostgresRelation('core', 'provider_capability').classification, 'CANONICAL_TRADING_STATE');
  assert.equal(classifyPostgresRelation('copy', 'follower_account').classification, 'CANONICAL_TRADING_STATE');
  assert.equal(classifyPostgresRelation('unknown', 'mystery').classification, 'UNKNOWN_REQUIRES_REVIEW');
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
