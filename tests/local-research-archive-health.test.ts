import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  archiveRetryAllowed,
  classifyArchiveFailure,
  classifyLocalSpoolWatermark,
  localResearchSpoolBudgetBytes,
  measureLocalResearchStorageBytes,
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

test('local research spool watermarks pause new subjects before local storage is exhausted', () => {
  assert.equal(classifyLocalSpoolWatermark(0), 'NORMAL');
  assert.equal(classifyLocalSpoolWatermark(Math.floor(localResearchSpoolBudgetBytes * 0.75)), 'ELEVATED');
  assert.equal(classifyLocalSpoolWatermark(Math.ceil(localResearchSpoolBudgetBytes * 0.9)), 'HIGH');
  assert.equal(classifyLocalSpoolWatermark(localResearchSpoolBudgetBytes), 'CRITICAL');
  assert.throws(() => classifyLocalSpoolWatermark(-1), /LOCAL_RESEARCH_SPOOL_BYTES_INVALID/);
  const root = join(tmpdir(), `theta-storage-bytes-${process.pid}-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  const first = join(root, 'first.sqlite');
  const second = join(root, 'second.sqlite');
  writeFileSync(first, 'abcd');
  writeFileSync(`${first}-wal`, 'ef');
  writeFileSync(second, 'ghi');
  truncateSync(second, 3);
  assert.equal(measureLocalResearchStorageBytes([first, second]), 9);
  assert.equal(measureLocalResearchStorageBytes([root]), 9);
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
  assert.ok(state.spoolBytes > 0);
  assert.equal(state.schedulerBytes, 0);
  assert.equal(state.parquetBytes, 0);
  assert.equal(state.activeSpoolBytes, state.spoolBytes);
  assert.equal(state.totalLocalResearchBytes, state.spoolBytes + state.parquetBytes);
  assert.equal(state.spoolWatermark, 'NORMAL');
  assert.equal(state.newSubjectScheduling, 'ALLOW');
  assert.equal(state.nextRetryAt, '2026-09-25T12:00:00.000Z');
  assert.equal(archiveRetryAllowed(paths.health, new Date('2026-09-25T11:59:59.000Z')), false);
  assert.equal(archiveRetryAllowed(paths.health, new Date('2026-09-25T12:00:00.000Z')), true);
});

test('successful archive clears quota cooldown and fingerprints latest verified manifest', () => {
  const paths = fixture();
  const directory = join(paths.parquet, 'THETA', '2026-09-25T010000Z_test');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'evidence.parquet'), 'test-only');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    generatedAt: '2026-09-25T01:00:00.000Z', parquetFile: 'evidence.parquet', duckdbReadback: 'PASS',
  }));
  const partial = join(paths.parquet, 'THETA', '.partial-interrupted');
  mkdirSync(partial);
  writeFileSync(join(partial, 'evidence.parquet'), 'incomplete-test-only');
  writeFileSync(join(partial, 'manifest.json'), JSON.stringify({
    generatedAt: '2026-09-25T02:00:00.000Z', parquetFile: 'evidence.parquet', duckdbReadback: 'PASS',
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
  assert.ok(state.parquetBytes > 0);
  assert.equal(state.activeSpoolBytes, state.spoolBytes);
  assert.equal(state.totalLocalResearchBytes, state.spoolBytes + state.parquetBytes);
  assert.match(state.lastManifestHash ?? '', /^[0-9a-f]{64}$/);
  assert.equal(state.duckdbVerification, 'PASS');
  assert.equal(JSON.parse(readFileSync(paths.health, 'utf8')).brokerAuthority, false);
});

test('verified Parquet inventory does not consume the active SQLite spool budget', () => {
  const paths = fixture();
  const directory = join(paths.parquet, 'THETA', 'large-verified-archive');
  mkdirSync(directory, { recursive: true });
  const parquetFile = join(directory, 'evidence.parquet');
  writeFileSync(parquetFile, 'verified-test-archive');
  truncateSync(parquetFile, localResearchSpoolBudgetBytes + 1);
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    generatedAt: '2026-09-25T01:00:00.000Z', parquetFile: 'evidence.parquet', duckdbReadback: 'PASS',
  }));
  const state = writeArchiveHealth({
    healthPath: paths.health, spoolPath: paths.sqlite, parquetRoot: paths.parquet,
    observedAt: new Date('2026-09-25T01:00:00.000Z'), archiveState: 'ARCHIVED_LOCAL_SQLITE',
    outcome: 'SUCCESS',
  });
  assert.ok(state.totalLocalResearchBytes > localResearchSpoolBudgetBytes);
  assert.equal(state.activeSpoolBytes, state.spoolBytes);
  assert.ok(state.activeSpoolBytes < localResearchSpoolBudgetBytes * 0.75);
  assert.equal(state.spoolWatermark, 'NORMAL');
  assert.equal(state.newSubjectScheduling, 'ALLOW');
});

test('legacy archive without explicit readback is not falsely reported corrupt', () => {
  const paths = fixture();
  const directory = join(paths.parquet, 'legacy');
  mkdirSync(directory);
  writeFileSync(join(directory, 'evidence.parquet'), 'test-only');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    formatVersion: 'theta-parquet-archive-v1', generatedAt: '2026-09-25T01:00:00.000Z',
    parquetFile: 'evidence.parquet', manifestSha256: 'test-only',
  }));
  const unverified = writeArchiveHealth({
    healthPath: paths.health, spoolPath: paths.sqlite, parquetRoot: paths.parquet,
    observedAt: new Date('2026-09-25T01:00:00.000Z'), archiveState: 'HEALTH_REFRESHED', outcome: 'UNCHANGED',
  });
  assert.equal(unverified.duckdbVerification, 'NOT_AVAILABLE');
  const verified = writeArchiveHealth({
    healthPath: paths.health, spoolPath: paths.sqlite, parquetRoot: paths.parquet,
    observedAt: new Date('2026-09-25T01:01:00.000Z'), archiveState: 'HEALTH_REFRESHED', outcome: 'UNCHANGED',
    duckdbVerificationOverride: 'PASS',
  });
  assert.equal(verified.duckdbVerification, 'PASS');
});
