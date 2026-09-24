import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  archiveRetryAllowed,
  classifyArchiveFailure,
  writeArchiveHealth,
} from '../src/storage/local-research-archive-health.js';

function fixture(): { root: string; sqlite: string; health: string; parquet: string } {
  const root = join(tmpdir(), `theta-archive-health-${process.pid}-${crypto.randomUUID()}`);
  const sqlite = join(root, 'spool.sqlite');
  const health = join(root, 'health.json');
  const parquet = join(root, 'parquet');
  mkdirSync(parquet, { recursive: true });
  const database = new DatabaseSync(sqlite);
  database.exec(`CREATE TABLE research_batch(storage_state TEXT NOT NULL);
    INSERT INTO research_batch VALUES('PENDING_PARQUET'),('ARCHIVED_PARQUET');`);
  database.close();
  return { root, sqlite, health, parquet };
}

test('archive failure classification keeps quota, transient, and integrity failures distinct', () => {
  assert.equal(classifyArchiveFailure({ code: '53000' }), 'DATABASE_RESOURCE_QUOTA');
  assert.equal(classifyArchiveFailure({ code: '57P03' }), 'DATABASE_TRANSIENT');
  assert.equal(classifyArchiveFailure(new Error('LOCAL_ARCHIVE_SQLITE_VERIFICATION_FAILED')), 'ARCHIVE_INTEGRITY');
  assert.equal(classifyArchiveFailure(new Error('opaque')), 'UNKNOWN');
});

test('quota exhaustion persists a cooldown and preserves local archive inventory', () => {
  const paths = fixture();
  const observedAt = new Date('2026-09-25T00:00:00.000Z');
  const state = writeArchiveHealth({
    healthPath: paths.health,
    spoolPath: paths.sqlite,
    parquetRoot: paths.parquet,
    observedAt,
    archiveState: 'DEFERRED_TRANSFER_QUOTA',
    outcome: 'QUOTA_EXHAUSTED',
    failureFamily: 'DATABASE_RESOURCE_QUOTA',
    retryAfterHours: 12,
  });
  assert.equal(state.transferQuotaState, 'TRANSFER_QUOTA_EXHAUSTED');
  assert.equal(state.failureFamily, 'DATABASE_RESOURCE_QUOTA');
  assert.equal(state.spoolRows, 2);
  assert.equal(state.pendingCompactionRows, 1);
  assert.equal(state.nextRetryAt, '2026-09-25T12:00:00.000Z');
  assert.equal(archiveRetryAllowed(paths.health, new Date('2026-09-25T11:59:59.000Z')), false);
  assert.equal(archiveRetryAllowed(paths.health, new Date('2026-09-25T12:00:00.000Z')), true);
});

test('successful archive clears quota cooldown and fingerprints latest verified manifest', () => {
  const paths = fixture();
  const directory = join(paths.parquet, '2026-09-25T010000Z_test');
  mkdirSync(directory);
  writeFileSync(join(directory, 'evidence.parquet'), 'test-only');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    generatedAt: '2026-09-25T01:00:00.000Z', parquetFile: 'evidence.parquet', duckdbReadback: 'PASS',
  }));
  writeArchiveHealth({
    healthPath: paths.health, spoolPath: paths.sqlite, parquetRoot: paths.parquet,
    observedAt: new Date('2026-09-25T00:00:00.000Z'), archiveState: 'DEFERRED_TRANSFER_QUOTA',
    outcome: 'QUOTA_EXHAUSTED', failureFamily: 'DATABASE_RESOURCE_QUOTA',
  });
  const state = writeArchiveHealth({
    healthPath: paths.health, spoolPath: paths.sqlite, parquetRoot: paths.parquet,
    observedAt: new Date('2026-09-25T01:00:00.000Z'), archiveState: 'ARCHIVED_LOCAL_SQLITE',
    outcome: 'SUCCESS',
  });
  assert.equal(state.transferQuotaState, 'TRANSFER_QUOTA_OPEN');
  assert.equal(state.nextRetryAt, null);
  assert.equal(state.failureFamily, null);
  assert.equal(state.parquetFiles, 1);
  assert.match(state.lastManifestHash ?? '', /^[0-9a-f]{64}$/);
  assert.equal(state.duckdbVerification, 'PASS');
  assert.equal(JSON.parse(readFileSync(paths.health, 'utf8')).brokerAuthority, false);
});
