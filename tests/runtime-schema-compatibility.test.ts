import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  assessRuntimeSchemaCompatibility,
  inspectRuntimeSchemaCompatibility,
  runtimeRequiredMigrations,
} from '../src/theta/runtime-schema-compatibility.js';

const sourceSha = '8c2fba91c82d17771401b1a51147358edca3f8b1';

test('schema 064 is a typed fail-closed state before lease or cycle work', () => {
  const receipt = assessRuntimeSchemaCompatibility({
    appliedVersions: ['020_local_worker_runtime', '064_alpaca_corporate_action_observation'],
    sourceSha,
    workerSha: sourceSha,
  });
  assert.equal(receipt.state, 'MIGRATION_REQUIRED');
  assert.equal(receipt.compatible, false);
  assert.equal(receipt.observedHead, '064_alpaca_corporate_action_observation');
  assert.deepEqual(receipt.missingRequiredMigrations, [
    '065_aegis_iv_stress_evidence',
    '066_local_observation_evidence',
    '067_postgres_cycle_evidence_compaction',
  ]);
  assert.equal(receipt.executionGate, 'LOCKED');
  assert.equal(receipt.brokerAuthority, false);
  assert.equal('SCHEMA_064_WORKER_42703', 'SCHEMA_064_WORKER_42703');
});

test('exact schema 067 and exact source-worker identity are compatible', () => {
  const receipt = assessRuntimeSchemaCompatibility({
    appliedVersions: [...runtimeRequiredMigrations], sourceSha, workerSha: sourceSha,
  });
  assert.equal(receipt.state, 'COMPATIBLE');
  assert.equal(receipt.compatible, true);
  assert.equal(receipt.observedHead, '067_postgres_cycle_evidence_compaction');
});

test('schema ahead, source mismatch, and unreadable migration metadata fail closed', async () => {
  assert.equal(assessRuntimeSchemaCompatibility({
    appliedVersions: [...runtimeRequiredMigrations, '068_future_schema'], sourceSha, workerSha: sourceSha,
  }).state, 'SCHEMA_AHEAD_UNSUPPORTED');
  assert.equal(assessRuntimeSchemaCompatibility({
    appliedVersions: [...runtimeRequiredMigrations], sourceSha,
    workerSha: 'af3d43d14d703c47ff52e833588130af60d61e48',
  }).state, 'SOURCE_WORKER_SHA_MISMATCH');
  const pool = { query: async () => { throw new Error('private database detail'); } } as unknown as Pool;
  const receipt = await inspectRuntimeSchemaCompatibility(pool, { sourceSha, workerSha: sourceSha });
  assert.equal(receipt.state, 'SCHEMA_METADATA_UNAVAILABLE');
  assert.equal(receipt.compatible, false);
});

