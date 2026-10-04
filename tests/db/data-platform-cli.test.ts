// The data platform automation entry point against a real disposable PostgreSQL (the scheduled-task shell around automation.ts). Skipped unless THETA_DATA_PLATFORM_DATABASE_URL is set.
// The dataset exercised here has no replay verifier of its own (decision-context); the cycle-blob replay path is covered against real cycle blobs in data-platform-pit.test.ts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { PostgresPartitionOps, ensureFuturePartitions } from '../../src/storage/data-platform/postgres-partitions.js';
import { catalogFor } from '../../src/storage/data-platform/platform-catalog.js';

const url = process.env.THETA_DATA_PLATFORM_DATABASE_URL;
const skip = url === undefined;
const MIB = 1024 ** 2;
const DATASET = 'decision-context';
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Output = Record<string, unknown> & { readonly status?: string; readonly receipt?: { archivedPartitions: string[]; retiredPartitions: string[] }; readonly incidents?: Array<{ kind: string; detail: string }>; readonly partitions?: Array<{ state: string }>; readonly board?: { subsystem: string }; readonly state?: string; readonly ledger?: unknown; readonly pressureState?: unknown };

test('REAL POSTGRES: tools/theta-data-platform.ts runs status, pre-session, post-session, weekly and slo end to end: archives, verifies, retires only under the two-authority rule, and records receipts and incidents', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const archiveDir = mkdtempSync(join(tmpdir(), 'theta-dp-cli-archive-'));
  const backupsDir = mkdtempSync(join(tmpdir(), 'theta-dp-cli-backups-'));
  const run = (modeName: string, extra: Record<string, string> = {}): Output => {
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'tools/theta-data-platform.ts', `--mode=${modeName}`], { cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, THETA_DATA_PLATFORM_DATABASE_URL: url, THETA_ARCHIVE_ROOT: archiveDir, THETA_BACKUPS_ROOT: backupsDir, THETA_DB_PLAN_BYTES: String(8 * 1024 * MIB), THETA_DATA_PLATFORM_DATASETS: DATASET,
        THETA_PARQUET_DISABLED: '1', THETA_SESSION_CALENDAR: 'DISABLED', ...extra } });
    return JSON.parse(output.trim().split('\n').at(-1) as string) as Output;
  };
  try {
    await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
    assert.equal(run('status').state, 'DATA_PLATFORM_SCHEMA_ABSENT', 'inert until the schema exists');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query(readFileSync(new URL('../../docs/proposals/069_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
    const ops = new PostgresPartitionOps(pool, catalogFor([DATASET]));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const dayBefore = (n: number): string => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const days = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(dayBefore);
    await ensureFuturePartitions(ops, DATASET, days);
    for (const [index, day] of days.entries()) await pool.query(`INSERT INTO dp.decision_context(decision_context_id, session_date, fusion_snapshot_id, content_hash, decided_at, context_json) VALUES ($1, $2::date, $3, $4, $2::date + time '15:00', '{"k":1}')`, [uuid(index * 2 + 1), day, uuid(index * 2 + 2), 'b'.repeat(64)]);

    const pre = run('pre-session');
    assert.equal(pre.state, 'PRE_SESSION'); assert.equal(pre.status, 'READY'); assert.equal((pre as { managementAllowed?: boolean }).managementAllowed, true);
    assert.equal((await pool.query('SELECT band FROM dp.storage_pressure_state')).rows[0].band, 'NORMAL');

    // default policy: the laptop disk alone is NOT enough, even with a verified DR backup on the same machine: everything archives, nothing retires, and the incident names the rule
    mkdirSync(join(backupsDir, 'latest'), { recursive: true });
    const stamp = new Date(Date.now() + 60_000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    const id = `${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())}_${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}${pad(stamp.getUTCSeconds())}-deadbeef`;
    writeFileSync(join(backupsDir, 'latest', 'current.json'), JSON.stringify({ backupId: id, verifiedAt: new Date(Date.now() + 120_000).toISOString() }));
    const first = run('post-session');
    assert.equal(first.state, 'POST_SESSION');
    assert.equal(first.receipt?.archivedPartitions.length, 14);
    assert.equal(first.receipt?.retiredPartitions.length, 0);
    assert.ok(first.incidents?.some((incident) => incident.kind === 'PARTITION_RETIREMENT_FAILURE' && /OFF_MACHINE_COPY_REQUIRED/.test(incident.detail)));
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.decision_context')).rows[0].n), 14, 'no row was removed');

    // the explicit development policy accepts the verified DR backup as the second authority: ten sessions stay hot, four retire
    const second = run('post-session', { THETA_ARCHIVE_OFF_MACHINE_POLICY: 'DEVELOPMENT_LOCAL_ONLY' });
    assert.equal(second.receipt?.retiredPartitions.length, 4, 'fourteen closed sessions, ten stay hot: four retire');
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.decision_context')).rows[0].n), 10);

    const status = run('status');
    assert.equal(status.state, 'STATUS');
    assert.equal(status.partitions?.filter((partition) => partition.state === 'DROPPED').length, 4);
    assert.equal(status.board?.subsystem, 'DATA_PLATFORM');
    assert.equal(run('weekly').incidents?.length, 0);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.storage_receipt')).rows[0].n), 1, 'one receipt per session, however many runs');
    assert.ok(Number((await pool.query('SELECT count(*)::int AS n FROM dp.platform_incident')).rows[0].n) >= 1, 'incidents are persisted');
    assert.equal(run('slo').state, 'SLO');
    assert.equal((run('dual-write-status') as { ledger: unknown }).ledger, null, 'the dual-write ledger is empty until a window is started');
  } finally { rmSync(archiveDir, { recursive: true, force: true }); rmSync(backupsDir, { recursive: true, force: true }); await pool.end(); }
});
