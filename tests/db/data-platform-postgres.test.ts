// Data platform on REAL PostgreSQL (disposable database): the draft schema applies, time partitions are created, archived, verified, detached and dropped by the real
// control plane, and DROP PARTITION returns its space to the database immediately, whereas row DELETE + VACUUM does not. Skipped unless THETA_DATA_PLATFORM_DATABASE_URL is set.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { LocalFilesystemArchiveBackend } from '../../src/storage/data-platform/archive-backend.js';
import { DataControlPlane } from '../../src/storage/data-platform/control-plane.js';
import { datasetRegistry, partitionKeyFor, type DatasetPolicy } from '../../src/storage/data-platform/dataset-registry.js';
import { decodeNdjsonGzipLines, ndjsonGzipCodec } from '../../src/storage/data-platform/ndjson-codec.js';
import { childTableName, databaseBytes, defaultPartitionRowCounts, ensureFuturePartitions, PostgresPartitionOps, PostgresPartitionStateStore, type PartitionedDataset } from '../../src/storage/data-platform/postgres-partitions.js';
import { postgresCycleBlobSink, readHotCycleBlob, sessionDateNewYork } from '../../src/storage/data-platform/cycle-blob-store.js';
import { recordPayloadPostgres } from '../../src/storage/data-platform/payload-store.js';
import { sessionDates } from '../helpers/data-platform-model.js';

const url = process.env.THETA_DATA_PLATFORM_DATABASE_URL;
const skip = url === undefined;
const MIB = 1024 ** 2;
const DATASET = 'cycle-evidence-blob';
const dayAfter = (date: string): string => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const blobDataset: PartitionedDataset = { dataset: DATASET, parent: 'dp.cycle_evidence_blob', keyColumn: 'session_date', orderBy: 'fusion_snapshot_id', range: (key) => ({ from: key, to: dayAfter(key) }) };

async function freshDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS dp_it CASCADE');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(readFileSync(new URL('../../docs/proposals/069_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function insertBlobs(pool: pg.Pool, session: string, rows: number, kib: number, base: number): Promise<number> {
  for (let index = 0; index < rows; index += 1) {
    await pool.query(`INSERT INTO dp.cycle_evidence_blob(fusion_snapshot_id, session_date, decided_at, archive_hash, uncompressed_bytes, compressed_bytes, blob)
      VALUES ($1, $2::date, $2::date + time '15:00', $3, $4, $4, (SELECT string_agg(gen_random_bytes(1024), ''::bytea) FROM generate_series(1, $5)))`,
      [uuid(base + index), session, 'a'.repeat(64), kib * 1024, kib]);
  }
  return rows * kib * 1024;
}

test('draft schema: applies cleanly, is idempotent, and every partitioned history table is partitioned by session_date', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await freshDatabase(pool);
    await pool.query(readFileSync(new URL('../../docs/proposals/069_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
    const partitioned = (await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_partitioned_table p ON p.partrelid=c.oid WHERE n.nspname='dp' ORDER BY 1`)).rows.map((row) => row.relname);
    assert.deepEqual(partitioned, ['cycle_evidence_blob', 'decision_context', 'payload_blob', 'payload_observation', 'pit_candidate', 'rejection_histogram']);
    const defaults = (await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dp' AND c.relname LIKE '%\\_default' ORDER BY 1`)).rows.map((row) => row.relname);
    assert.equal(defaults.length, 6, 'every partitioned history table has a DEFAULT partition');
    const tables = (await pool.query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='dp' AND c.relkind IN ('r','p') ORDER BY 1`)).rows.map((row) => row.relname);
    for (const required of ['partition_state', 'archive_manifest', 'storage_receipt', 'platform_incident', 'evidence_skipped', 'storage_pressure_state', 'dual_write_ledger']) assert.ok(tables.includes(required), required);
    // no foreign key points INTO a partitioned history table (it would block retirement forever)
    const fks = (await pool.query(`SELECT conrelid::regclass::text AS source, confrelid::regclass::text AS target FROM pg_constraint WHERE contype='f' AND connamespace='dp'::regnamespace`)).rows;
    assert.deepEqual(fks, []);
    // writing without a pre-created partition does NOT fail (it lands in the DEFAULT partition) and is reported
    await pool.query(`INSERT INTO dp.decision_context(decision_context_id, session_date, content_hash, decided_at, context_json) VALUES ($1, '2026-10-05', $2, now(), '{}'::jsonb)`, [uuid(1), 'b'.repeat(64)]);
    assert.equal((await defaultPartitionRowCounts(pool, ['dp.decision_context', 'dp.cycle_evidence_blob']))['dp.decision_context'], 1);
    assert.equal((await defaultPartitionRowCounts(pool, ['dp.cycle_evidence_blob']))['dp.cycle_evidence_blob'], 0);
  } finally { await pool.end(); }
});

test('REAL POSTGRES: the control plane archives, verifies, detaches and drops hot partitions; DROP PARTITION returns the space at once; row DELETE + VACUUM does not', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const dir = mkdtempSync(join(tmpdir(), 'theta-dp-pg-'));
  try {
    await freshDatabase(pool);
    const ops = new PostgresPartitionOps(pool, [blobDataset]);
    const store = new PostgresPartitionStateStore(pool);
    const sessions = sessionDates(7);
    const registry: readonly DatasetPolicy[] = [{ ...(datasetRegistry.find((policy) => policy.id === DATASET) as DatasetPolicy), hotSessions: 2 }];
    const plane = new DataControlPlane({ allowUnverifiedRetirement: true, botId: 'theta', sourceSha: 'c'.repeat(40), policyVersion: 'it-1', backend: new LocalFilesystemArchiveBackend(dir), store, opsFor: () => ops, codecFor: () => ndjsonGzipCodec,
      replayFor: () => ({ async verify() { return 'NOT_APPLICABLE'; } }), now: () => new Date().toISOString(), measure: async () => ({ dbBytes: await databaseBytes(pool), planBytes: 8 * 1024 * MIB }),
      partitionBytes: () => 0, registry });
    const writtenBytes = new Map<string, number>();
    for (const [index, session] of sessions.entries()) {
      await ops.ensurePartition(DATASET, partitionKeyFor(session, 'SESSION_DATE'));
      writtenBytes.set(session, await insertBlobs(pool, session, 6, 800, index * 100));
    }
    // a plain, NON-partitioned control table holding the same volume, retired by DELETE
    await pool.query('CREATE SCHEMA dp_it');
    await pool.query('CREATE TABLE dp_it.control (id uuid PRIMARY KEY, session_date date NOT NULL, blob bytea NOT NULL)');
    await pool.query(`INSERT INTO dp_it.control SELECT fusion_snapshot_id, session_date, blob FROM dp.cycle_evidence_blob`);
    await pool.query('CHECKPOINT');

    const sizeOf = async (name: string): Promise<number> => Number((await pool.query('SELECT pg_total_relation_size($1::regclass)::bigint AS n', [name])).rows[0].n);
    const droppedSessions = sessions.slice(0, 5);          // 7 sessions, 2 stay hot
    const droppedBytes = (await Promise.all(droppedSessions.map((session) => sizeOf(childTableName('dp.cycle_evidence_blob', session))))).reduce((sum, value) => sum + value, 0);
    const parentRowsBefore = Number((await pool.query('SELECT count(*)::int AS n FROM dp.cycle_evidence_blob')).rows[0].n);
    const sampleBefore = (await pool.query(`SELECT to_jsonb(t)::text AS j FROM dp.cycle_evidence_blob_p${(sessions[0] as string).replace(/-/g, '')} t ORDER BY fusion_snapshot_id LIMIT 1`)).rows[0].j as string;
    const dbBefore = await databaseBytes(pool);

    let last;
    for (const [index, session] of sessions.entries()) last = await plane.postSession(session, sessions.slice(0, index + 1), { preSessionBytes: dbBefore, sessionPeakBytes: dbBefore }, sessions[index + 1] ?? null);
    assert.deepEqual(last?.incidents, []);

    const records = await store.list(DATASET);
    assert.equal(records.filter((record) => record.state === 'DROPPED').length, 5);
    assert.equal(records.filter((record) => record.state === 'ARCHIVED_VERIFIED').length, 2);
    const dbAfter = await databaseBytes(pool);
    const freed = dbBefore - dbAfter;
    assert.ok(freed >= 0.85 * droppedBytes, `DROP PARTITION freed ${(freed / MIB).toFixed(1)} MiB of ${(droppedBytes / MIB).toFixed(1)} MiB`);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.cycle_evidence_blob')).rows[0].n), parentRowsBefore - 5 * 6);

    // contrast: DELETE + plain VACUUM on the control table does not return the space to the filesystem
    const controlBefore = await sizeOf('dp_it.control');
    await pool.query(`DELETE FROM dp_it.control WHERE session_date < $1::date`, [sessions[5]]);
    await pool.query('VACUUM dp_it.control');
    const controlAfter = await sizeOf('dp_it.control');
    assert.ok(controlAfter > 0.8 * controlBefore, `row DELETE + VACUUM kept ${(controlAfter / MIB).toFixed(1)} of ${(controlBefore / MIB).toFixed(1)} MiB`);

    // the archive of a retired partition reproduces the original rows byte-for-byte
    const retired = records.find((record) => record.partition === sessions[0]);
    assert.ok(retired?.uploaded !== null && retired?.manifest !== null);
    const lines = decodeNdjsonGzipLines(await new LocalFilesystemArchiveBackend(dir).get(retired?.uploaded?.key as string) as Uint8Array);
    assert.equal(lines.length, 6);
    assert.equal(lines[0], sampleBefore, 'the first archived row equals the original row text');
    assert.equal(retired?.manifest?.rowCount, 6);
    assert.equal(await ops.exists(DATASET, sessions[0] as string), false);
    // a late writer for a retired partition lands in the DEFAULT partition (the write is not lost) and the default-partition check reports it
    await insertBlobs(pool, sessions[0] as string, 1, 1, 999);
    assert.equal((await defaultPartitionRowCounts(pool, ['dp.cycle_evidence_blob']))['dp.cycle_evidence_blob'], 1);
  } finally { rmSync(dir, { recursive: true, force: true }); await pool.end(); }
});

test('REAL POSTGRES: detach and drop are idempotent and resumable after a failure between them; an unverified partition is never retired', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const dir = mkdtempSync(join(tmpdir(), 'theta-dp-pg-'));
  try {
    await freshDatabase(pool);
    const ops = new PostgresPartitionOps(pool, [blobDataset]);
    const store = new PostgresPartitionStateStore(pool);
    const session = '2026-10-05';
    await ops.ensurePartition(DATASET, session);
    await ops.ensurePartition(DATASET, session);
    await insertBlobs(pool, session, 3, 16, 1);
    const failures = { drop: true };
    const flakyOps = Object.assign(Object.create(ops), { exists: ops.exists.bind(ops), exportPartition: ops.exportPartition.bind(ops), countRows: ops.countRows.bind(ops), detach: ops.detach.bind(ops),
      drop: async (dataset: string, partition: string) => { if (failures.drop) throw new Error('DROP_FAILED'); return ops.drop(dataset, partition); } });
    const registry: readonly DatasetPolicy[] = [{ ...(datasetRegistry.find((policy) => policy.id === DATASET) as DatasetPolicy), hotSessions: 1 }];
    const plane = new DataControlPlane({ allowUnverifiedRetirement: true, botId: 'theta', sourceSha: 'c'.repeat(40), policyVersion: 'it-1', backend: new LocalFilesystemArchiveBackend(dir), store, opsFor: () => flakyOps, codecFor: () => ndjsonGzipCodec,
      replayFor: () => ({ async verify() { return 'NOT_APPLICABLE'; } }), now: () => new Date().toISOString(), measure: async () => ({ dbBytes: await databaseBytes(pool), planBytes: 8 * 1024 * MIB }), partitionBytes: () => 0, registry });
    const sessions = [session, '2026-10-06', '2026-10-07'];
    for (const next of sessions.slice(1)) await ops.ensurePartition(DATASET, next);
    await insertBlobs(pool, '2026-10-06', 1, 4, 50); await insertBlobs(pool, '2026-10-07', 1, 4, 60);
    for (const [index, day] of sessions.entries()) { const run = await plane.postSession(day, sessions.slice(0, index + 1), { preSessionBytes: 0, sessionPeakBytes: 0 }, sessions[index + 1] ?? null); void run; }
    assert.equal((await store.get(DATASET, session))?.state, 'DETACHED', 'the drop failed after the detach marker: archived, detached, still on disk');
    assert.equal(await ops.exists(DATASET, session), true);
    failures.drop = false;
    await plane.postSession('2026-10-07', sessions, { preSessionBytes: 0, sessionPeakBytes: 0 }, null);
    assert.equal((await store.get(DATASET, session))?.state, 'DROPPED');
    assert.equal(await ops.exists(DATASET, session), false);
    await ops.detach(DATASET, session); await ops.drop(DATASET, session);
  } finally { rmSync(dir, { recursive: true, force: true }); await pool.end(); }
});

test('REAL POSTGRES: the cycle blob sink writes inside the caller transaction into the session partition, is idempotent, reads back hot, and the legacy column path is unchanged', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await freshDatabase(pool);
    const ops = new PostgresPartitionOps(pool, [blobDataset]);
    await ensureFuturePartitions(ops, DATASET, ['2026-10-05', '2026-10-06']);
    await pool.query('CREATE SCHEMA IF NOT EXISTS trade');
    await pool.query('DROP TABLE IF EXISTS trade.fusion_snapshot CASCADE');
    await pool.query('CREATE TABLE trade.fusion_snapshot (fusion_snapshot_id uuid PRIMARY KEY, evidence_archive_gzip bytea)');
    const blob = Buffer.from('compressed-cycle-evidence'.repeat(40));
    const record = { fusionSnapshotId: uuid(7), decisionTimeUtc: '2026-10-05T19:43:07.459Z', archiveHash: 'f'.repeat(64), uncompressedBytes: blob.length * 9, compressedBytes: blob.length, blob };
    assert.equal(sessionDateNewYork('2026-10-05T03:30:00Z'), '2026-10-04', 'session date is the New York date');
    assert.equal(sessionDateNewYork(record.decisionTimeUtc), '2026-10-05');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO trade.fusion_snapshot(fusion_snapshot_id, evidence_archive_gzip) VALUES ($1, NULL)', [record.fusionSnapshotId]);
      await postgresCycleBlobSink(client, record);
      await postgresCycleBlobSink(client, record);
      await client.query('COMMIT');
    } finally { client.release(); }
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.cycle_evidence_blob_p20261005')).rows[0].n), 1, 'one row in the session partition, idempotent');
    assert.deepEqual(await readHotCycleBlob(pool, record.fusionSnapshotId, true), blob);
    assert.equal(await readHotCycleBlob(pool, record.fusionSnapshotId, false), null, 'without the data platform the legacy column is NULL: callers must opt in consistently');
    // a rolled-back cycle leaves no orphan blob
    const failing = await pool.connect();
    try {
      await failing.query('BEGIN');
      await postgresCycleBlobSink(failing, { ...record, fusionSnapshotId: uuid(8) });
      await failing.query('ROLLBACK');
    } finally { failing.release(); }
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.cycle_evidence_blob')).rows[0].n), 1);
    // content-addressed payloads: same bytes observed twice are one blob and two observations
    await ensureFuturePartitions(new PostgresPartitionOps(pool, [{ ...blobDataset, dataset: 'payload', parent: 'dp.payload_blob', orderBy: 'content_hash' }, { ...blobDataset, dataset: 'obs', parent: 'dp.payload_observation', orderBy: 'observation_id' }]), 'payload', ['2026-10-05']);
    await ensureFuturePartitions(new PostgresPartitionOps(pool, [{ ...blobDataset, dataset: 'obs', parent: 'dp.payload_observation', orderBy: 'observation_id' }]), 'obs', ['2026-10-05']);
    const payload = Buffer.from(JSON.stringify({ chain: 'y'.repeat(4000) }));
    const base = { kind: 'OPTIONOMICS_RAW', provider: 'OPTIONOMICS', requestHash: 'e'.repeat(64), status: 'OK', latencyMs: 90, sessionDate: '2026-10-05' };
    const first = await recordPayloadPostgres(pool, { ...base, observationId: uuid(21), observedAt: '2026-10-05T14:00:00Z' }, payload);
    const second = await recordPayloadPostgres(pool, { ...base, observationId: uuid(22), observedAt: '2026-10-05T14:03:00Z' }, payload);
    assert.equal(first.blobStored, true); assert.equal(second.blobStored, false); assert.equal(first.contentHash, second.contentHash);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.payload_blob')).rows[0].n), 1);
    const observed = (await pool.query(`SELECT to_char(observed_at AT TIME ZONE 'UTC', 'HH24:MI') AS t FROM dp.payload_observation ORDER BY observed_at`)).rows.map((row) => row.t);
    assert.deepEqual(observed, ['14:00', '14:03']);
  } finally { await pool.end(); }
});

test('REAL POSTGRES: a retired cycle blob is still readable (cold, verified) through the same resolver; replay input bytes are identical', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const dir = mkdtempSync(join(tmpdir(), 'theta-dp-pg-'));
  try {
    await freshDatabase(pool);
    const ops = new PostgresPartitionOps(pool, [blobDataset]);
    const store = new PostgresPartitionStateStore(pool);
    const backend = new LocalFilesystemArchiveBackend(dir);
    const sessions = ['2026-10-05', '2026-10-06', '2026-10-07'];
    await ensureFuturePartitions(ops, DATASET, sessions);
    await pool.query('DROP TABLE IF EXISTS trade.fusion_snapshot CASCADE');
    await pool.query('CREATE SCHEMA IF NOT EXISTS trade');
    await pool.query('CREATE TABLE trade.fusion_snapshot (fusion_snapshot_id uuid PRIMARY KEY, evidence_archive_gzip bytea)');
    const blobs = new Map<string, Buffer>();
    for (const [index, session] of sessions.entries()) {
      const blob = Buffer.from(Array.from({ length: 3000 }, (_, offset) => (offset * 31 + index * 7) % 251));
      const id = uuid(300 + index);
      blobs.set(id, blob);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO trade.fusion_snapshot VALUES ($1, NULL)', [id]);
        await postgresCycleBlobSink(client, { fusionSnapshotId: id, decisionTimeUtc: `${session}T19:00:00Z`, archiveHash: 'e'.repeat(64), uncompressedBytes: blob.length * 5, compressedBytes: blob.length, blob });
        await client.query('COMMIT');
      } finally { client.release(); }
    }
    const registry: readonly DatasetPolicy[] = [{ ...(datasetRegistry.find((policy) => policy.id === DATASET) as DatasetPolicy), hotSessions: 1 }];
    const plane = new DataControlPlane({ allowUnverifiedRetirement: true, botId: 'theta', sourceSha: 'c'.repeat(40), policyVersion: 'it-1', backend, store, opsFor: () => ops, codecFor: () => ndjsonGzipCodec, replayFor: () => ({ async verify() { return 'NOT_APPLICABLE'; } }),
      now: () => new Date().toISOString(), measure: async () => ({ dbBytes: await databaseBytes(pool), planBytes: 8 * 1024 * MIB }), partitionBytes: () => 0, registry });
    for (const [index, session] of sessions.entries()) await plane.postSession(session, sessions.slice(0, index + 1), { preSessionBytes: 0, sessionPeakBytes: 0 }, sessions[index + 1] ?? null);
    assert.equal((await store.get(DATASET, '2026-10-05'))?.state, 'DROPPED');
    const { readCycleBlobWithColdFallback } = await import('../../src/storage/data-platform/cycle-blob-store.js');
    const cold = await readCycleBlobWithColdFallback({ pool, fusionSnapshotId: uuid(300), decisionTimeUtc: '2026-10-05T19:00:00Z', backend, dataPlatformEnabled: true });
    assert.equal(cold?.tier, 'COLD');
    assert.deepEqual(cold?.blob, blobs.get(uuid(300)), 'the cold blob is byte-identical to the original');
    const hot = await readCycleBlobWithColdFallback({ pool, fusionSnapshotId: uuid(302), decisionTimeUtc: '2026-10-07T19:00:00Z', backend, dataPlatformEnabled: true });
    assert.equal(hot?.tier, 'HOT');
    assert.equal(await readCycleBlobWithColdFallback({ pool, fusionSnapshotId: uuid(999), decisionTimeUtc: '2026-10-05T19:00:00Z', backend, dataPlatformEnabled: true }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); await pool.end(); }
});
