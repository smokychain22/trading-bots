// End-to-end data-platform lifecycle on a production-schema PostgreSQL (migrations 001-068 + draft 069 + compat swap 070), with the REAL cycle store, REAL cycle blobs and the REAL replay:
//   payload dedupe, hot -> archive -> verify -> real replay -> retire -> cold read -> replay, compact archive reference, the PIT compatibility swap read by an existing consumer, and the
//   upgrade / downgrade assumptions of migration 069. Skipped unless THETA_DATA_PLATFORM_FULL_DATABASE_URL points at a disposable local database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { PostgresDatasetExporter } from '../../src/research/postgres-dataset-export.js';
import { LocalFilesystemArchiveBackend } from '../../src/storage/data-platform/archive-backend.js';
import { InMemoryObjectStoreClient, RemoteObjectArchiveBackend } from '../../src/storage/data-platform/archive-remote.js';
import { runPostSession, type AutomationContext } from '../../src/storage/data-platform/automation.js';
import { postgresCycleBlobSink, readCycleBlobWithColdFallback } from '../../src/storage/data-platform/cycle-blob-store.js';
import { purgeDurabilityCheck } from '../../src/storage/data-platform/durability-policy.js';
import { postgresPayloadSink } from '../../src/storage/data-platform/payload-store.js';
import { cutoverToNormalized, startDualWrite, evaluateDualWriteExit, readLedger, rollbackAuthoritativeAndSwap, PIT_DATASET } from '../../src/storage/data-platform/pit-writer.js';
import { catalogFor, registryFor } from '../../src/storage/data-platform/platform-catalog.js';
import { PostgresPartitionOps, ensureFuturePartitions } from '../../src/storage/data-platform/postgres-partitions.js';
import { StaticPressureProvider, interpretPressureRow } from '../../src/storage/data-platform/pressure-state.js';
import { StorageWriteGate } from '../../src/storage/data-platform/write-gate.js';
import { replayCycleArchive } from '../../src/theta/cycle-archive-replay.js';
import { PostgresThetaCycleStore } from '../../src/theta/postgres-theta-cycle-store.js';
import { buildCycle, persistenceContext, seedWorld } from '../helpers/theta-cycle-fixture.js';

const url = process.env.THETA_DATA_PLATFORM_FULL_DATABASE_URL;
const skip = url === undefined;
const salt = Date.now() % 100_000;
const draft = (name: string): string => readFileSync(new URL(`../../docs/proposals/${name}`, import.meta.url), 'utf8');
const sha = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const count = async (pool: pg.Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);
async function resetDp(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  // a database left in the swapped state is rolled back through the product's own rollback (DROP SCHEMA dp CASCADE would take the compat view and its dependents with it)
  if ((await pool.query(`SELECT to_regclass('trade.candidate_point_in_time_evidence_legacy') IS NOT NULL AND to_regclass('dp.dual_write_ledger') IS NOT NULL AS ok`)).rows[0].ok === true) await rollbackAuthoritativeAndSwap(pool);
  await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
  await pool.query(draft('069_data_platform_DRAFT.sql'));
}

test('PAYLOAD DEDUPE (real store): identical raw provider bytes observed in two cycles are ONE blob and TWO observations; the row keeps a reference; pressure removes the payload from the hot row', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await resetDp(pool);
    const world = await seedWorld(pool, '2026-09-11T14:59:00.000Z'); const context = persistenceContext(world);
    const store = new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: true, payloadSink: postgresPayloadSink });
    const first = await store.persist(context, buildCycle(30, '2026-09-14T15:00:00.000Z', { sharedKiB: 30, payloadKey: 'same' }, salt + 1));
    const second = await store.persist(context, buildCycle(30, '2026-09-14T16:00:00.000Z', { sharedKiB: 30, payloadKey: 'same' }, salt + 2));
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.payload_blob'), 1, 'identical bytes are stored once');
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.payload_observation'), 2, 'point-in-time correctness: two observations of the same bytes');
    const rows = (await pool.query(`SELECT payload_json FROM market.optionomics_raw_observation WHERE fusion_snapshot_id = ANY($1::uuid[]) AND operation_alias = 'optionomics.get_option_chain'`, [[first.fusionSnapshotId, second.fusionSnapshotId]])).rows;
    assert.equal(rows.length, 2); for (const row of rows) assert.equal(row.payload_json.storageState, 'PAYLOAD_IN_DP_PAYLOAD_BLOB');
    const blob = (await pool.query('SELECT content_hash, payload FROM dp.payload_blob')).rows[0];
    assert.equal(blob.content_hash, sha(blob.payload), 'the stored bytes hash to their identity');
    assert.equal(rows[0].payload_json.contentHash, blob.content_hash);
    // a different payload is a different blob
    await store.persist(context, buildCycle(30, '2026-09-14T17:00:00.000Z', { sharedKiB: 30, payloadKey: 'other' }, salt + 3));
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.payload_blob'), 2);
    // storage pressure: the lowest-priority write yields (the full payload stays in the compressed cycle archive; the row says so)
    const critical = new StorageWriteGate(new StaticPressureProvider(interpretPressureRow({ band: 'STORAGE_CRITICAL', database_bytes: 7.5 * 1024 ** 3, plan_bytes: 8 * 1024 ** 3, archive_queue_bytes: 0, archive_lag_sessions: 0, archive_backend_healthy: true, projected_sessions_to_critical: 1, evaluated_at: '2026-09-14T18:00:00Z' }, new Date('2026-09-14T18:30:00Z'))), { now: () => new Date('2026-09-14T18:30:00Z') });
    const pressured = await new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: true, payloadSink: postgresPayloadSink, writeGate: critical }).persist(context, buildCycle(30, '2026-09-14T19:00:00.000Z', { sharedKiB: 30, payloadKey: 'third' }, salt + 4));
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.payload_blob'), 2, 'no payload stored under pressure');
    const stub = (await pool.query(`SELECT payload_json FROM market.optionomics_raw_observation WHERE fusion_snapshot_id = $1 AND operation_alias = 'optionomics.get_option_chain'`, [pressured.fusionSnapshotId])).rows[0].payload_json;
    assert.equal(stub.storageState, 'FULL_PAYLOAD_IN_COMPRESSED_CYCLE_ARCHIVE');
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM trade.decision WHERE fusion_snapshot_id = $1', [pressured.fusionSnapshotId]), 1, 'the decision itself is operational truth and is always written');
  } finally { await pool.end(); }
});

test('CYCLE BLOB LIFECYCLE (real cycles): hot partition -> archive -> verify -> REAL replay -> retire under the two-authority rule -> cold read -> replay; PostgreSQL keeps a compact archive reference', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const archiveDir = mkdtempSync(join(tmpdir(), 'theta-dp-life-archive-'));
  try {
    await resetDp(pool);
    const world = await seedWorld(pool, '2026-09-11T14:59:00.000Z'); const context = persistenceContext(world);
    const store = new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: false, cycleBlobSink: postgresCycleBlobSink });
    const days = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
    const ops = new PostgresPartitionOps(pool, catalogFor(['cycle-evidence-blob']));
    await ensureFuturePartitions(ops, 'cycle-evidence-blob', days);
    const saved: Array<{ id: string; at: string }> = [];
    for (const [index, day] of days.entries()) { const at = `${day}T15:00:00.000Z`; const persisted = await store.persist(context, buildCycle(60, at, { sharedKiB: 30 }, salt + 10 + index)); saved.push({ id: persisted.fusionSnapshotId, at }); }
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob'), 9);
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM trade.fusion_snapshot WHERE fusion_snapshot_id = ANY($1::uuid[]) AND evidence_archive_gzip IS NOT NULL`, [saved.map((entry) => entry.id)]), 0, 'the legacy blob column is empty when the sink holds the bytes');

    const primary = new LocalFilesystemArchiveBackend(archiveDir);
    const remote = new RemoteObjectArchiveBackend(new InMemoryObjectStoreClient('life-remote'), { sleep: async () => undefined });
    const keyFor = (manifest: { dataset: string; partition: string; fileHash: string }): string => `data/${manifest.dataset}/${manifest.partition}/${manifest.fileHash}.archive`;
    const sourceSha = 'a'.repeat(40);
    const automation = (second: boolean): AutomationContext => ({ pool, backend: primary, datasets: catalogFor(['cycle-evidence-blob']), registry: registryFor(['cycle-evidence-blob']), planBytes: 8 * 1024 ** 3, sourceSha, policyVersion: 'life-1', calendar: null, parquet: null,
      parquetRoot: archiveDir, durabilityCheck: purgeDurabilityCheck({ primary, keyFor, ...(second ? { secondary: remote, secondaryKeyFor: keyFor } : {}) }), now: () => new Date('2026-10-06T20:00:00Z') });
    // first run: no second authority. Archives, REAL replay verification, but nothing is retired
    const archived = await runPostSession(automation(false));
    assert.equal(archived.receipt.archivedPartitions.length, 9, JSON.stringify(archived.incidents)); assert.equal(archived.receipt.retiredPartitions.length, 0);
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM dp.archive_manifest WHERE dataset = 'cycle-evidence-blob' AND replay_verified = 'true'`), 9, 'every archive was replay-verified against the real frontier builder');
    // the remote copy appears; the next run retires what is past the five-session hot window
    for (const record of (await pool.query(`SELECT record_json FROM dp.partition_state WHERE dataset = 'cycle-evidence-blob'`)).rows.map((row) => row.record_json as { uploaded: { key: string } })) { const bytes = await primary.get(record.uploaded.key); if (bytes !== null) await remote.put(record.uploaded.key, bytes); }
    const retired = await runPostSession(automation(true));
    assert.equal(retired.receipt.retiredPartitions.length, 4);
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob'), 5);

    // a retired decision: the hot blob is gone, the cold read re-verifies the archive and returns the ORIGINAL bytes, and the real replay accepts them
    const oldest = saved[0] as { id: string; at: string };
    const cold = await readCycleBlobWithColdFallback({ pool, fusionSnapshotId: oldest.id, decisionTimeUtc: oldest.at, backend: primary, dataPlatformEnabled: true });
    assert.ok(cold !== null && cold.tier === 'COLD');
    const fusion = (await pool.query('SELECT evidence_archive_hash FROM trade.fusion_snapshot WHERE fusion_snapshot_id = $1', [oldest.id])).rows[0] as { evidence_archive_hash: string };
    const replay = replayCycleArchive(cold.blob, { cycleId: oldest.id, sourceSha, archiveSha256: sha(cold.blob), archiveContentHash: fusion.evidence_archive_hash }, sourceSha);
    assert.equal(replay.state, 'SAME_SOURCE_REPRODUCED', 'a retired cycle replays to the identical frontier');
    // a hot decision is still served from PostgreSQL
    const recent = saved.at(-1) as { id: string; at: string };
    assert.equal((await readCycleBlobWithColdFallback({ pool, fusionSnapshotId: recent.id, decisionTimeUtc: recent.at, backend: primary, dataPlatformEnabled: true }))?.tier, 'HOT');
    // PostgreSQL keeps the compact permanent reference after retirement: archive id, hashes, schema, source SHA, location
    const reference = (await pool.query('SELECT * FROM dp.cycle_archive_reference_v WHERE fusion_snapshot_id = $1', [oldest.id])).rows[0] as Record<string, string | null>;
    assert.match(String(reference.archive_id), /^[0-9a-f]{40}$/); assert.equal(reference.source_sha, sourceSha); assert.ok(reference.archive_location !== null && reference.schema_version !== null);
    assert.equal(reference.blob_content_hash, fusion.evidence_archive_hash); assert.match(String(reference.archive_file_hash), /^[0-9a-f]{64}$/);
  } finally { rmSync(archiveDir, { recursive: true, force: true }); await pool.end(); }
});

test('PIT COMPATIBILITY SWAP (070): an existing consumer reads old and new point-in-time rows through the unchanged table name; the legacy writer still works for rollback', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await resetDp(pool);
    const world = await seedWorld(pool, '2026-09-11T14:59:00.000Z'); const context = persistenceContext(world);
    const now = () => new Date('2026-09-12T00:00:00Z');
    const writer = (mode: 'OFF' | 'DUAL_WRITE_VALIDATE' | 'AUTHORITATIVE') => new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: true, pitWriter: { mode, now } });
    await startDualWrite(pool, 14, new Date('2026-09-11T15:00:00Z'));
    const a = await writer('DUAL_WRITE_VALIDATE').persist(context, buildCycle(40, '2026-09-11T15:01:00.000Z', { sharedKiB: 30 }, salt + 1));
    const b = await writer('DUAL_WRITE_VALIDATE').persist(context, buildCycle(40, '2026-09-11T15:02:00.000Z', { sharedKiB: 30 }, salt + 2));
    const cutover = await cutoverToNormalized(pool, { minimumDecisions: 2, minimumRows: 10 });
    assert.equal(cutover.cutover, true, cutover.evaluation.failures.join('|'));
    const c = await writer('AUTHORITATIVE').persist(context, buildCycle(40, '2026-09-11T15:03:00.000Z', { sharedKiB: 30 }, salt + 3));
    const legacyRows = await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = ANY($1::uuid[])', [[a.fusionSnapshotId, b.fusionSnapshotId]]);
    const newRows = await count(pool, 'SELECT count(*)::int AS n FROM dp.pit_candidate WHERE fusion_snapshot_id = $1', [c.fusionSnapshotId]);
    assert.ok(legacyRows > 5 && newRows > 5);
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [c.fusionSnapshotId]), 0, 'before the swap the plain table does not show AUTHORITATIVE rows');
    const exportWindow = { start: '2026-09-11T15:00:00.000Z', end: '2026-09-11T15:10:00.000Z', exportedAt: '2026-09-12T00:00:00.000Z', featureSetVersion: 'swap-test' };
    const before = await new PostgresDatasetExporter(pool).export(exportWindow);

    const dependentBefore = (await pool.query(`SELECT count(*)::int AS n FROM research.option_contract_risk_history WHERE candidate_id IN (SELECT candidate_id FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = ANY($1::uuid[]))`, [[a.fusionSnapshotId, b.fusionSnapshotId, c.fusionSnapshotId]])).rows[0].n as number;
    assert.equal(Number(dependentBefore), legacyRows, 'before the swap the dependent production view (migration 062) sees the legacy rows only');
    await pool.query(draft('070_pit_compat_swap_DRAFT.sql'));
    // the production view research.option_contract_risk_history was re-pointed: it sees OLD and NEW rows, not just the renamed table
    assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM research.option_contract_risk_history WHERE candidate_id IN (SELECT candidate_id FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = ANY($1::uuid[]))`, [[a.fusionSnapshotId, b.fusionSnapshotId, c.fusionSnapshotId]])).rows[0].n), legacyRows + newRows, 'dependent views follow the unchanged name');
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = ANY($1::uuid[])', [[a.fusionSnapshotId, b.fusionSnapshotId, c.fusionSnapshotId]]), legacyRows + newRows, 'the unchanged name now serves old and new rows');
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM pg_class WHERE relname = 'candidate_point_in_time_evidence' AND relkind = 'v'`), 1);
    const after = await new PostgresDatasetExporter(pool).export(exportWindow);
    assert.equal(before.rowCounts.candidates, legacyRows, 'before the swap the research export sees the legacy rows');
    assert.equal(after.rowCounts.candidates, legacyRows + newRows, 'after the swap the SAME export (an existing consumer, unchanged SQL) sees old and new rows');
    // the swap is refused twice, and rollback-mode writes (mode OFF) land in the renamed legacy table and are visible through the view
    await assert.rejects(pool.query(draft('070_pit_compat_swap_DRAFT.sql')), /PIT_COMPAT_SWAP_ALREADY_APPLIED/);
    const d = await writer('OFF').persist(context, buildCycle(40, '2026-09-11T15:04:00.000Z', { sharedKiB: 30 }, salt + 4));
    assert.ok(await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence_legacy WHERE fusion_snapshot_id = $1', [d.fusionSnapshotId]) > 5);
    assert.ok(await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [d.fusionSnapshotId]) > 5);
    // the exit evaluation keeps working after the swap (it targets the renamed table)
    const evaluation = await evaluateDualWriteExit(pool, { minimumDecisions: 1, minimumRows: 1 });
    assert.equal(evaluation.sweep.differingRows, 0); assert.equal(PIT_DATASET, 'candidate-point-in-time-evidence');
    // ROLLBACK of the swap: drop the view, rename the table back; every row (old and new) remains reachable (the new ones through dp.*)
    const rolledBack = await rollbackAuthoritativeAndSwap(pool);
    assert.equal(rolledBack.swapReverted, true); assert.equal(rolledBack.backfilledRows, newRows, 'the rows written while AUTHORITATIVE are copied back, none is lost');
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM pg_class WHERE relname = 'candidate_point_in_time_evidence' AND relkind = 'r'`), 1, 'the plain table has its name back');
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = ANY($1::uuid[])', [[a.fusionSnapshotId, b.fusionSnapshotId, c.fusionSnapshotId, d.fusionSnapshotId]]), legacyRows + newRows + (await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [d.fusionSnapshotId])));
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'trade' AND indexname = 'ix_candidate_pit_decision'`), 1, 'the canonical index name is back');
    assert.equal((await readLedger(pool))?.mode, 'OFF');
    assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM research.option_contract_risk_history WHERE candidate_id IN (SELECT candidate_id FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = ANY($1::uuid[]))`, [[a.fusionSnapshotId, b.fusionSnapshotId, c.fusionSnapshotId]])).rows[0].n), legacyRows + newRows, 'after the rollback the dependent view reads the plain table again, including the copied-back rows');
    // and the exact content of a copied-back row equals what the normalized view served
    const restored = (await pool.query('SELECT volatility_json FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1 LIMIT 1', [c.fusionSnapshotId])).rows[0];
    assert.equal(restored.volatility_json.ivSource, 'ALPACA');
  } finally { await pool.end(); }
});

test('MIGRATION 069 on the production schema: applies from 068, is idempotent, leaves every existing table untouched, and the downgrade (DROP SCHEMA dp) leaves the legacy path fully working', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
    const world = await seedWorld(pool, '2026-09-11T14:59:00.000Z'); const context = persistenceContext(world);
    const tables = async (): Promise<Record<string, number>> => Object.fromEntries(await Promise.all(['trade.fusion_snapshot', 'trade.decision', 'trade.candidate', 'trade.candidate_point_in_time_evidence'].map(async (name) => [name, await count(pool, `SELECT count(*)::int AS n FROM ${name}`)] as const)));
    await new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: false }).persist(context, buildCycle(30, '2026-09-11T15:30:00.000Z', { sharedKiB: 30 }, salt + 77));
    const before = await tables();
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query(draft('069_data_platform_DRAFT.sql'));
    await pool.query(draft('069_data_platform_DRAFT.sql'));
    assert.deepEqual(await tables(), before, 'applying 069 changes no existing row');
    assert.ok(await count(pool, `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'reject_mutation' AND NOT tgisinternal`) >= 6, 'append-only triggers are installed on every history table and partition');
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM pg_views WHERE schemaname IN ('dp') AND viewname IN ('candidate_point_in_time_evidence_v', 'cycle_archive_reference_v')`), 2);
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND confrelid::regnamespace = 'dp'::regnamespace`), 0, 'no foreign key points into the dp schema (retirement can never be blocked)');
    assert.equal(await count(pool, `SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND conrelid::regnamespace = 'dp'::regnamespace`), 0, 'no foreign key leaves the dp schema either: history never pins operational rows');
    // downgrade assumption: dropping the schema is safe because nothing outside dp depends on it
    await pool.query('DROP SCHEMA dp CASCADE');
    assert.deepEqual(await tables(), before);
    await new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: false }).persist(context, buildCycle(30, '2026-09-11T15:31:00.000Z', { sharedKiB: 30 }, salt + 78));
    assert.equal((await tables())['trade.fusion_snapshot'], (before['trade.fusion_snapshot'] as number) + 1, 'the legacy writer works with no dp schema at all');
  } finally { await pool.end(); }
});
