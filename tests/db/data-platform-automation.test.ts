// The three scheduled tasks against a real disposable PostgreSQL (dp schema from draft 069): pre-session (READY / NEW_RISK_STORAGE_LOCK), post-session (archive, verify, Parquet, retire
// under the two-authority rule, one idempotent receipt), weekly integrity (corruption means an incident and no deletion), default-partition repair, restart safety, and the SLO task.
// Skipped unless THETA_DATA_PLATFORM_DATABASE_URL is set.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { LocalFilesystemArchiveBackend } from '../../src/storage/data-platform/archive-backend.js';
import { InMemoryObjectStoreClient, RemoteObjectArchiveBackend } from '../../src/storage/data-platform/archive-remote.js';
import { runPostSession, runPreSession, runWeeklyIntegrity, schemaPresent, type AutomationContext } from '../../src/storage/data-platform/automation.js';
import { purgeDurabilityCheck } from '../../src/storage/data-platform/durability-policy.js';
import { catalogFor, registryFor } from '../../src/storage/data-platform/platform-catalog.js';
import { ScriptedParquetRunner } from '../../src/storage/data-platform/parquet-runner.js';
import { addDays, type SessionCalendar } from '../../src/storage/data-platform/session-calendar.js';
import { runSlo } from '../../src/storage/data-platform/slo-task.js';

const url = process.env.THETA_DATA_PLATFORM_DATABASE_URL;
const skip = url === undefined;
const GIB = 1024 ** 3;
const NOW = new Date('2026-10-12T20:00:00Z'); // Monday 16:00 New York
const TODAY = '2026-10-12';
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const alwaysReplayable = { async verify(): Promise<boolean | 'NOT_APPLICABLE'> { return true; } };
const ids = ['cycle-evidence-blob', 'decision-context'];
const keyFor = (manifest: { dataset: string; partition: string; fileHash: string }): string => `data/${manifest.dataset}/${manifest.partition}/${manifest.fileHash}.archive`;
/** a provider calendar with a holiday: Mon 2026-10-12 is a session in this fixture, Thu 2026-10-15 is closed */
const calendar: SessionCalendar = { async sessionsBetween(start, end) { const out: string[] = []; for (let d = start; d <= end; d = addDays(d, 1)) { const day = new Date(`${d}T12:00:00Z`).getUTCDay(); if (day !== 0 && day !== 6 && d !== '2026-10-15') out.push(d); } return out; } };

async function insertBlobs(pool: pg.Pool, session: string, rows: number, base: number): Promise<void> {
  for (let index = 0; index < rows; index += 1) {
    await pool.query(`INSERT INTO dp.cycle_evidence_blob(fusion_snapshot_id, session_date, decided_at, archive_hash, uncompressed_bytes, compressed_bytes, blob)
      VALUES ($1, $2::date, $2::date + time '15:00', $3, 8192, 8192, (SELECT string_agg(gen_random_bytes(1024), ''::bytea) FROM generate_series(1, 8)))`, [uuid(base + index), session, 'a'.repeat(64)]);
  }
}
async function insertContext(pool: pg.Pool, session: string, base: number): Promise<void> {
  await pool.query(`INSERT INTO dp.decision_context(decision_context_id, session_date, fusion_snapshot_id, content_hash, decided_at, context_json) VALUES ($1, $2::date, $3, $4, $2::date + time '15:00', '{"k":1}')`, [uuid(base), session, uuid(base + 1), 'b'.repeat(64)]);
}
async function reset(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
  await pool.query(readFileSync(new URL('../../docs/proposals/DP1_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
}
const count = async (pool: pg.Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);

interface Rig { readonly pool: pg.Pool; readonly archiveDir: string; readonly parquetDir: string; readonly parquet: ScriptedParquetRunner; readonly remote: InMemoryObjectStoreClient; context(overrides?: Partial<AutomationContext>): AutomationContext; cleanup(): Promise<void> }
async function rig(): Promise<Rig> {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await reset(pool);
  const archiveDir = mkdtempSync(join(tmpdir(), 'theta-dp-auto-archive-')); const parquetDir = mkdtempSync(join(tmpdir(), 'theta-dp-auto-parquet-'));
  const parquet = new ScriptedParquetRunner({ convert: { ok: true, detail: { rowCount: 1 } } });
  const remote = new InMemoryObjectStoreClient('test-remote');
  const primary = new LocalFilesystemArchiveBackend(archiveDir);
  const second = new RemoteObjectArchiveBackend(remote, { sleep: async () => undefined, baseDelayMs: 1 });
  return { pool, archiveDir, parquetDir, parquet, remote,
    context: (overrides = {}) => ({ pool, backend: primary, datasets: catalogFor(ids), registry: registryFor(ids), planBytes: 8 * GIB, sourceSha: 'c'.repeat(40), policyVersion: 'it-auto', calendar, parquet, parquetRoot: parquetDir,
      durabilityCheck: purgeDurabilityCheck({ primary, keyFor, secondary: second, secondaryKeyFor: keyFor }), now: () => NOW, replayFor: () => alwaysReplayable, ...overrides }),
    cleanup: async () => { rmSync(archiveDir, { recursive: true, force: true }); rmSync(parquetDir, { recursive: true, force: true }); await pool.end(); } };
}

test('PRE-SESSION: schema detection, READY, partitions through the provider-calendar horizon created idempotently, pressure state published, management always allowed', { skip }, async () => {
  const r = await rig();
  try {
    assert.equal(await schemaPresent(r.pool), true);
    const first = await runPreSession(r.context());
    assert.equal(first.status, 'READY'); assert.equal(first.managementAllowed, true); assert.equal(first.newRiskGate, 'OPEN', first.reasons.join('|'));
    assert.equal(first.partitionPlan.source, 'PROVIDER_CALENDAR');
    assert.ok(first.partitionPlan.created > 0 && first.partitionPlan.missing.length === 0);
    // every calendar date through the 7th supported session exists, INCLUDING the weekend and the 2026-10-15 holiday inside the horizon
    for (const date of ['2026-10-12', '2026-10-15', '2026-10-17', '2026-10-18']) assert.equal(await count(r.pool, `SELECT count(*)::int AS n FROM pg_class WHERE relname = $1`, [`cycle_evidence_blob_p${date.replaceAll('-', '')}`]), 1, date);
    assert.equal(first.pressureStateWritten, true);
    assert.equal((await r.pool.query('SELECT band FROM dp.storage_pressure_state')).rows[0].band, 'NORMAL');
    const second = await runPreSession(r.context());
    assert.equal(second.partitionPlan.created, 0, 'idempotent: nothing to create the second time');
    assert.equal(first.checks.every((check) => check.ok), true, JSON.stringify(first.checks.filter((check) => !check.ok)));
    // the provider calendar is down: a calendar-day superset, never a guessed holiday list
    const down = await runPreSession(r.context({ calendar: { async sessionsBetween() { throw new Error('provider down'); } } }));
    assert.equal(down.partitionPlan.source, 'CALENDAR_UNAVAILABLE_SUPERSET'); assert.equal(down.status, 'READY');
  } finally { await r.cleanup(); }
});

test('PRE-SESSION: an unhealthy archive under pressure, an unknown allocation and a missing reserve lock NEW risk while management stays allowed', { skip }, async () => {
  const r = await rig();
  try {
    const unknownPlan = await runPreSession(r.context({ planBytes: 0 }));
    assert.equal(unknownPlan.status, 'NEW_RISK_STORAGE_LOCK'); assert.ok(unknownPlan.reasons.includes('PROVIDER_ALLOCATION_UNKNOWN')); assert.equal(unknownPlan.managementAllowed, true);
    // a database that is nearly the whole allocation: critical band, locked
    const tiny = await runPreSession(r.context({ planBytes: 1 * GIB, requiredReserveBytes: 5 * GIB }));
    assert.equal(tiny.status, 'NEW_RISK_STORAGE_LOCK'); assert.ok(tiny.reasons.some((reason) => /TRANSACTIONAL_RESERVE_BELOW_REQUIRED/.test(reason)));
    assert.equal((await r.pool.query('SELECT 1 FROM dp.storage_pressure_state')).rowCount, 1);
    // an archive that can not write: unhealthy, incident recorded
    const brokenBackend = { ...r.context().backend, put: async () => { throw new Error('ARCHIVE_BACKEND_UNAVAILABLE'); } } as unknown as AutomationContext['backend'];
    const broken = await runPreSession(r.context({ backend: Object.assign(Object.create(r.context().backend), { put: brokenBackend.put }) }));
    assert.equal(broken.archiveHealth.healthy, false);
    assert.ok(((await r.pool.query(`SELECT 1 FROM dp.platform_incident WHERE kind = 'ARCHIVE_BACKEND_UNHEALTHY'`)).rowCount ?? 0) >= 1);
  } finally { await r.cleanup(); }
});

test('PRE-SESSION: an expired dual-write window raises DUAL_WRITE_WINDOW_EXPIRED (the writer already fell back to the legacy path); an active bounded window is reported', { skip }, async () => {
  const r = await rig();
  try {
    await r.pool.query(`INSERT INTO dp.dual_write_ledger(dataset, mode, dual_write_started_at, dual_write_deadline, parity_decisions, parity_rows) VALUES ('candidate-point-in-time-evidence', 'DUAL_WRITE_VALIDATE', $1::timestamptz, $2::timestamptz, 5, 20)`, ['2026-09-20T00:00:00Z', '2026-10-04T00:00:00Z']);
    const expired = await runPreSession(r.context());
    assert.ok(expired.checks.some((entry) => entry.name === 'DUAL_WRITE_WINDOW_BOUNDED' && !entry.ok));
    assert.ok(((await r.pool.query(`SELECT 1 FROM dp.platform_incident WHERE kind = 'DUAL_WRITE_WINDOW_EXPIRED'`)).rowCount ?? 0) >= 1);
    assert.equal(expired.status, 'READY', 'an expired window is a decision for a human, not a storage lock: the writer is already on the safe legacy path');
    await r.pool.query(`UPDATE dp.dual_write_ledger SET dual_write_deadline = $1::timestamptz`, ['2026-10-20T00:00:00Z']);
    assert.ok((await runPreSession(r.context())).checks.some((entry) => entry.name === 'DUAL_WRITE_WINDOW_BOUNDED' && entry.ok));
  } finally { await r.cleanup(); }
});

test('DEFAULT PARTITION: a missing scheduled partition, a late writer and the session boundary are repaired without losing a row; rows for an already retired partition stay under a CRITICAL incident', { skip }, async () => {
  const r = await rig();
  try {
    // no partition exists for these dates: the writes land in the DEFAULT partition instead of failing
    await insertBlobs(r.pool, '2026-10-08', 3, 100); await insertBlobs(r.pool, '2026-10-09', 2, 200); await insertContext(r.pool, '2026-10-09', 300);
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob_default'), 5);
    const result = await runPreSession(r.context());
    assert.equal(result.defaultPartitions.repaired, 6, 'five blobs and one context moved');
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob_default'), 0);
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob'), 5, 'no row lost');
    assert.equal(await count(r.pool, `SELECT count(*)::int AS n FROM dp.cycle_evidence_blob_p20261008`), 3);
    assert.ok(((await r.pool.query(`SELECT 1 FROM dp.platform_incident WHERE kind = 'DEFAULT_PARTITION_ROWS'`)).rowCount ?? 0) >= 1);
    // the session boundary: the NY date decides the partition, not UTC (a 23:30 New York decision is the NEXT day in UTC)
    await r.pool.query(`INSERT INTO dp.cycle_evidence_blob(fusion_snapshot_id, session_date, decided_at, archive_hash, uncompressed_bytes, compressed_bytes, blob) VALUES ($1, '2026-10-14', '2026-10-15T03:30:00Z', $2, 1, 1, '\\x00')`, [uuid(900), 'a'.repeat(64)]);
    assert.equal(await count(r.pool, `SELECT count(*)::int AS n FROM dp.cycle_evidence_blob_p20261014`), 1);
    // an immutable table refuses UPDATE and DELETE outside the maintenance repair
    await assert.rejects(r.pool.query('DELETE FROM dp.cycle_evidence_blob WHERE fusion_snapshot_id = $1', [uuid(900)]), /DP_APPEND_ONLY/);
    await assert.rejects(r.pool.query(`UPDATE dp.cycle_evidence_blob SET archive_hash = $2 WHERE fusion_snapshot_id = $1`, [uuid(900), 'c'.repeat(64)]), /DP_APPEND_ONLY/);
    // a late writer after the partition was archived and dropped: rows are NOT merged back (that would fork the archive), they stay and alarm
    await r.pool.query(`INSERT INTO dp.partition_state(dataset, partition_key, state, step, record_json, updated_at) VALUES ('cycle-evidence-blob', '2026-10-01', 'DROPPED', 'DROPPED', '{}'::jsonb, now())`);
    await insertBlobs(r.pool, '2026-10-01', 2, 400);
    const late = await runPreSession(r.context());
    assert.equal(late.defaultPartitions.lateIntoRetired, 2);
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob_default'), 2);
    assert.ok(((await r.pool.query(`SELECT 1 FROM dp.platform_incident WHERE kind = 'LATE_WRITE_INTO_RETIRED_PARTITION' AND severity = 'CRITICAL'`)).rowCount ?? 0) >= 1);
    assert.notEqual(late.newRiskGate, 'OPEN', 'late writes into retired partitions restrict new risk until a human looks');
  } finally { await r.cleanup(); }
});

test('POST-SESSION: archives and verifies, retires ONLY under the two-authority rule, converts to Parquet, writes one receipt, and a repeated run is idempotent', { skip }, async () => {
  const r = await rig();
  try {
    await runPreSession(r.context());
    const days = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => addDays(TODAY, -n));
    for (const [index, day] of days.entries()) { await r.pool.query(`SELECT 1`); await ensure(r.pool, 'cycle_evidence_blob', day); await insertBlobs(r.pool, day, 3, 1000 + index * 10); await ensure(r.pool, 'decision_context', day); await insertContext(r.pool, day, 5000 + index * 10); }

    // no second authority: everything archives and verifies, NOTHING retires, and the incident names why
    const noSecond = await runPostSession(r.context({ durabilityCheck: purgeDurabilityCheck({ primary: r.context().backend, keyFor }) }));
    assert.equal(noSecond.state, 'POST_SESSION');
    assert.ok(noSecond.receipt.archivedPartitions.length >= 9); assert.equal(noSecond.receipt.retiredPartitions.length, 0);
    assert.ok(noSecond.incidents.some((entry) => entry.kind === 'PARTITION_RETIREMENT_FAILURE' && /SECOND_AUTHORITY_MISSING|OFF_MACHINE_COPY_REQUIRED/.test(entry.detail)), JSON.stringify(noSecond.incidents.map((entry) => entry.detail)));
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob'), 27, 'no row was removed');
    assert.ok(noSecond.parquet.some((entry) => entry.dataset === 'decision-context' && entry.state === 'CONVERTED_VERIFIED'), 'Parquet is converted and verified for tabular datasets: ' + JSON.stringify({ archived: noSecond.receipt.archivedPartitions, parquet: noSecond.parquet, calls: r.parquet.calls }));
    assert.ok(noSecond.parquet.some((entry) => entry.dataset === 'cycle-evidence-blob' && entry.state === 'EXEMPT'));

    // the remote second copy appears: the next run (restart safe: it resumes from the recorded state) retires what is past its window
    const second = new RemoteObjectArchiveBackend(r.remote, { sleep: async () => undefined });
    const records = (await r.pool.query(`SELECT record_json FROM dp.partition_state WHERE dataset = 'cycle-evidence-blob'`)).rows.map((row) => row.record_json as { uploaded: { key: string } | null; partition: string });
    const primaryBackend = r.context().backend;
    for (const record of records) { if (record.uploaded === null) continue; const bytes = await primaryBackend.get(record.uploaded.key); if (bytes !== null) await second.put(record.uploaded.key, bytes); }
    const retired = await runPostSession(r.context());
    assert.equal(retired.receipt.retiredPartitions.filter((entry) => entry.startsWith('cycle-evidence-blob/')).length, 4, 'nine closed sessions, five stay hot: four retire');
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob'), 15);
    // one receipt per session, replaced not duplicated
    await runPostSession(r.context());
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.storage_receipt'), 1);
    assert.ok(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.partition_state') >= 18, 'a lifecycle record exists for every archived partition (one per dataset and partition: the primary key forbids duplicates)');
    const slo = await runSlo(r.context());
    assert.equal(slo.state, 'SLO'); assert.equal(slo.POST_ARCHIVE_SERIES_SESSIONS, 1); assert.equal(slo.UNBOUNDED_POSTGRES_GROWTH, false);
  } finally { await r.cleanup(); }
});

test('POST-SESSION YIELDS: when operations need the database the task stops between partitions, loses nothing and resumes on the next run', { skip }, async () => {
  const r = await rig();
  try {
    await runPreSession(r.context());
    const days = [9, 8, 7].map((n) => addDays(TODAY, -n));
    for (const [index, day] of days.entries()) { await ensure(r.pool, 'cycle_evidence_blob', day); await insertBlobs(r.pool, day, 2, 2000 + index * 10); }
    const yielded = await runPostSession(r.context({ yieldToOperations: () => true }));
    assert.equal(yielded.yielded, true); assert.equal(yielded.receipt.archivedPartitions.length, 0);
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.cycle_evidence_blob'), 6, 'nothing touched while operations had priority');
    const resumed = await runPostSession(r.context());
    assert.equal(resumed.yielded, false); assert.ok(resumed.receipt.archivedPartitions.length >= 3);
  } finally { await r.cleanup(); }
});

test('WEEKLY INTEGRITY: verifies archives and Parquet; corruption raises an incident, sends the partition back to re-archive, and NOTHING is deleted', { skip }, async () => {
  const r = await rig();
  try {
    await runPreSession(r.context());
    const days = [3, 2, 1].map((n) => addDays(TODAY, -n));
    for (const [index, day] of days.entries()) { await ensure(r.pool, 'decision_context', day); await insertContext(r.pool, day, 7000 + index * 10); }
    await runPostSession(r.context());
    // Parquet manifests the scripted runner "produced"
    for (const day of days) { const dir = join(r.parquetDir, 'decision-context', day, 'decision-context'); (await import('node:fs')).mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'parquet-manifest.json'), '{}'); }
    const healthy = await runWeeklyIntegrity(r.context({ parquet: new ScriptedParquetRunner({ verify: { ok: true, detail: { rows: 1 } }, openCheck: { ok: true, detail: {} } }) }), 10);
    assert.deepEqual(healthy.incidents.filter((entry) => entry.kind === 'ARCHIVE_CORRUPTION'), []); assert.ok(healthy.parquetVerified >= 1); assert.equal(healthy.deletionPerformed, false);
    // corrupt one archive object on disk
    const file = (function find(dir: string): string | null { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) { const inner = find(full); if (inner !== null) return inner; } else if (full.includes('decision-context') && full.endsWith('.archive')) return full; } return null; })(r.archiveDir);
    assert.ok(file !== null); const damaged = readFileSync(file as string); damaged[Math.floor(damaged.length / 2)] = (damaged[Math.floor(damaged.length / 2)] ?? 0) ^ 0xff; writeFileSync(file as string, damaged);
    const rows = await count(r.pool, 'SELECT count(*)::int AS n FROM dp.decision_context');
    const sick = await runWeeklyIntegrity(r.context({ parquet: new ScriptedParquetRunner({ verify: { ok: false, detail: { problems: ['HASH_MISMATCH'] } } }) }), 10);
    assert.ok(sick.incidents.some((entry) => entry.kind === 'ARCHIVE_CORRUPTION'));
    assert.ok(sick.incidents.some((entry) => entry.kind === 'PARQUET_VERIFICATION_FAILURE'));
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.decision_context'), rows, 'corruption never deletes a hot row');
    assert.ok(((await r.pool.query(`SELECT 1 FROM dp.platform_incident WHERE kind = 'ARCHIVE_CORRUPTION'`)).rowCount ?? 0) >= 1);
  } finally { await r.cleanup(); }
});

async function ensure(pool: pg.Pool, table: string, day: string): Promise<void> {
  const next = addDays(day, 1);
  await pool.query(`CREATE TABLE IF NOT EXISTS dp.${table}_p${day.replaceAll('-', '')} PARTITION OF dp.${table} FOR VALUES FROM ('${day}') TO ('${next}')`);
}

test('SLO: a post-archive series that is within the steady-state tolerance but still rising reports sessions until the pressure and critical bands and raises the capacity-horizon warning', { skip }, async () => {
  const r = await rig();
  try {
    // 40 sessions growing 5 MiB per session from 3 GiB on an 8 GiB plan: "STEADY" by the tolerance, but the allocation is only ~180 sessions away
    for (let index = 0; index < 40; index += 1) {
      const day = addDays('2026-08-01', index);
      await r.pool.query(`INSERT INTO dp.storage_receipt(session_date, receipt_json) VALUES ($1::date, $2::jsonb)`, [day, JSON.stringify({ receiptVersion: 'theta-storage-receipt-v1', sessionDate: day, preSessionBytes: 3 * GIB + index * 5 * 1024 ** 2, sessionPeakBytes: 3 * GIB + index * 5 * 1024 ** 2 + 100 * 1024 ** 2,
        postSessionPreArchiveBytes: 0, postArchiveBytes: 3 * GIB + index * 5 * 1024 ** 2, steadyStateDeltaBytes: 0, archivedPartitions: [], retiredPartitions: [], incidents: [], capacityState: 'NORMAL' })]);
    }
    const slo = await runSlo(r.context());
    assert.equal(slo.STEADY_STATE, 'STEADY');
    assert.ok(slo.SESSIONS_TO_STORAGE_CRITICAL !== null && slo.SESSIONS_TO_STORAGE_CRITICAL < slo.CAPACITY_HORIZON_SESSIONS_WARNING, `critical in ${slo.SESSIONS_TO_STORAGE_CRITICAL} sessions`);
    assert.ok(slo.SESSIONS_TO_STORAGE_PRESSURE !== null && slo.SESSIONS_TO_STORAGE_PRESSURE < slo.SESSIONS_TO_STORAGE_CRITICAL);
    assert.ok(slo.incidents.some((entry) => entry.kind === 'DATABASE_CAPACITY_FORECAST_BREACH'));
  } finally { await r.cleanup(); }
});

test('RESTART SAFETY: an archive backend that fails mid-run leaves a recoverable state; the next run completes it with no duplicate objects, manifests or receipts', { skip }, async () => {
  const r = await rig();
  try {
    await runPreSession(r.context());
    const days = [6, 5, 4, 3].map((n) => addDays(TODAY, -n));
    for (const [index, day] of days.entries()) { await ensure(r.pool, 'decision_context', day); await insertContext(r.pool, day, 9000 + index * 10); }
    const real = r.context().backend;
    let puts = 0;
    const flaky = Object.create(real) as AutomationContext['backend'];
    Object.assign(flaky, { put: async (key: string, bytes: Uint8Array) => { puts += 1; if (puts === 3) throw new Error('ARCHIVE_BACKEND_UNAVAILABLE'); return real.put(key, bytes); } });
    const first = await runPostSession(r.context({ backend: flaky }));
    assert.ok(first.incidents.some((entry) => entry.kind === 'ARCHIVE_BACKLOG' || /ARCHIVE_BACKEND_UNAVAILABLE/.test(entry.detail)), JSON.stringify(first.incidents.map((entry) => entry.detail)));
    assert.ok(first.receipt.archivedPartitions.length < days.length, 'the failure interrupted the run');
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.decision_context'), 4, 'nothing was removed by the failed run');
    const second = await runPostSession(r.context());
    assert.equal(await count(r.pool, `SELECT count(DISTINCT partition_key)::int AS n FROM dp.archive_manifest WHERE dataset = 'decision-context'`), 4, 'every partition is archived exactly once');
    assert.equal(await count(r.pool, `SELECT count(*)::int AS n FROM dp.archive_manifest WHERE dataset = 'decision-context'`), 4, 'no duplicate manifest');
    assert.equal(await count(r.pool, 'SELECT count(*)::int AS n FROM dp.storage_receipt'), 1, 'one receipt per session across the failed run and the recovery');
    assert.ok(second.receipt.archivedPartitions.length >= 1);
    const objects = (await r.context().backend.list('data/decision-context/')).length;
    assert.equal(objects, 4, 'one immutable object per partition, no orphans from the interrupted attempt');
  } finally { await r.cleanup(); }
});
