// Storage pressure is wired into bulk research writers and the new-risk entry gate, and it is structurally impossible for it to reach operational truth.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresShadowEvidenceRuntimeStore } from '../src/research/shadow-evidence-runtime.js';
import { admitNewRiskPlan, cycleStoreDataPlatformOptions, dataPlatformRuntime, gatedCycleBlobSink } from '../src/storage/data-platform/runtime-wiring.js';
import { StaticPressureProvider, interpretPressureRow, unknownPressure } from '../src/storage/data-platform/pressure-state.js';
import { StorageWriteGate, gateAllows } from '../src/storage/data-platform/write-gate.js';
import { writeArchiveHealth } from '../src/storage/local-research-archive-health.js';

const GIB = 1024 ** 3;
const now = new Date('2026-10-05T14:00:00Z');
const row = (band: string, used: number) => ({ band, database_bytes: Math.round(used * 8 * GIB), plan_bytes: 8 * GIB, archive_queue_bytes: 0, archive_lag_sessions: 0, archive_backend_healthy: true, projected_sessions_to_critical: 40, evaluated_at: now.toISOString() });
const provider = (band: string, used: number) => new StaticPressureProvider(interpretPressureRow(row(band, used), now));
const fakePool = (rows: unknown[] = []) => { const calls: string[] = []; return { calls, pool: { query: async (sql: string) => { calls.push(sql); return { rows, rowCount: 0 }; } } as unknown as Pool }; };

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => { const path = join(directory, name); return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|mjs)$/.test(name) ? [path] : []; });
}

test('STRUCTURAL: operational writers can not import the storage pressure modules; only the research writers listed here do', () => {
  const importers = sourceFiles('src').filter((file) => /data-platform\/(write-gate|pressure-state|runtime-wiring)/.test(readFileSync(file, 'utf8')) && !relative('src', file).replaceAll('\\', '/').startsWith('storage/data-platform/'))
    .map((file) => relative('src', file).replaceAll('\\', '/')).sort();
  assert.deepEqual(importers, ['research/production-shadow-runtime.ts', 'research/shadow-evidence-runtime.ts', 'theta/postgres-theta-cycle-store.ts'],
    'a new importer must be reviewed: it would put an operational write behind a storage gate');
  for (const operational of ['src/execution', 'src/worker', 'src/providers', 'src/customer', 'src/market', 'src/operations', 'src/ops']) {
    for (const file of sourceFiles(operational)) assert.doesNotMatch(readFileSync(file, 'utf8'), /data-platform\//, `${file} is operational and must not know the data platform`);
  }
});

test('the runtime is inert by default and each flag turns on exactly its own behavior', async () => {
  const { pool } = fakePool();
  const off = dataPlatformRuntime(pool, {}, () => now);
  assert.deepEqual([off.governorEnabled, off.writeGate, off.cycleBlobSink, off.pitWriter, off.provider, off.payloadSink], [false, undefined, undefined, undefined, null, undefined]);
  assert.deepEqual(cycleStoreDataPlatformOptions(off), {});
  assert.deepEqual(await off.newRiskGate(), { gate: 'OPEN', reason: 'STORAGE_GOVERNOR_DISABLED' });
  const blobOnly = dataPlatformRuntime(pool, { THETA_DATA_PLATFORM_BLOB_STORE: '1' }, () => now);
  assert.ok(blobOnly.cycleBlobSink !== undefined && blobOnly.writeGate === undefined);
  assert.ok(dataPlatformRuntime(pool, { THETA_PAYLOAD_DEDUP: '1' }, () => now).payloadSink !== undefined);
  const shadow = dataPlatformRuntime(pool, { THETA_PIT_STORAGE_MODE: 'SHADOW' }, () => now);
  assert.equal(shadow.pitWriter?.mode, 'SHADOW');
  const bogus = dataPlatformRuntime(pool, { THETA_PIT_STORAGE_MODE: 'AUTHORITY' }, () => now);
  assert.equal(bogus.pitWriter, undefined, 'an unrecognized mode stays OFF');
  const governed = dataPlatformRuntime(pool, { THETA_STORAGE_GOVERNOR: '1' }, () => now);
  assert.ok(governed.writeGate !== undefined && governed.pitWriter?.pressure !== undefined);
  // an enabled governor with no pressure table or row is UNKNOWN: new risk restricted, never open
  const missing = await dataPlatformRuntime(fakePool([]).pool, { THETA_STORAGE_GOVERNOR: '1' }, () => now).newRiskGate();
  assert.equal(missing.gate, 'RESTRICTED'); assert.match(missing.reason, /STORAGE_PRESSURE_UNKNOWN/);
  const throwing = { query: async () => { throw new Error('connection refused'); } } as unknown as Pool;
  assert.equal((await dataPlatformRuntime(throwing, { THETA_STORAGE_GOVERNOR: '1' }, () => now).newRiskGate()).gate, 'RESTRICTED');
  const healthy = await dataPlatformRuntime(fakePool([row('NORMAL', 0.2)]).pool, { THETA_STORAGE_GOVERNOR: '1' }, () => now).newRiskGate();
  assert.equal(healthy.gate, 'OPEN');
});

test('new-risk plan admission: OPEN admits, RESTRICTED admits exactly one plan per scan, LOCKED admits none; management is not a parameter at all', () => {
  assert.deepEqual(admitNewRiskPlan('OPEN', 5), { admitted: true, blocker: null });
  assert.equal(admitNewRiskPlan('RESTRICTED', 0).admitted, true);
  assert.equal(admitNewRiskPlan('RESTRICTED', 1).admitted, false);
  assert.equal(admitNewRiskPlan('LOCKED', 0).admitted, false);
  assert.equal(admitNewRiskPlan('LOCKED', 0).blocker, 'STORAGE_NEW_RISK_LOCKED');
});

test('the cycle blob sink and the observation-job writer yield to pressure, record the skip, and never throw into the caller', async () => {
  let inner = 0;
  const recorded: string[] = [];
  const gate = (band: string, used: number) => new StorageWriteGate(provider(band, used), { now: () => now, recorder: async (record) => { recorded.push(`${record.scope}:${record.state}`); } });
  const sink = (g: StorageWriteGate | undefined) => gatedCycleBlobSink(g, async () => { inner += 1; });
  await sink(gate('NORMAL', 0.2))({} as never, {} as never);
  assert.equal(inner, 1);
  await sink(gate('RESEARCH_THROTTLED', 0.6))({} as never, {} as never);
  assert.equal(inner, 2, 'selected/finalist-class evidence (P1) still writes while research is throttled');
  await sink(gate('STORAGE_CRITICAL', 0.9))({} as never, {} as never);
  assert.equal(inner, 2); assert.deepEqual(recorded, ['cycle-evidence-blob:STORAGE_CRITICAL']);
  await sink(undefined)({} as never, {} as never);
  assert.equal(inner, 3, 'no gate configured: unchanged behavior');

  const jobRows = [{ observationJobId: 'a', candidateId: 'b', contractSymbol: 'c', horizonCode: 'h', horizonVersion: 'v', targetAt: '2026-10-06T00:00:00Z' }] as never;
  const normal = fakePool();
  assert.equal(await new PostgresShadowEvidenceRuntimeStore(normal.pool, gate('NORMAL', 0.2)).scheduleObservations(jobRows), 0);
  assert.equal(normal.calls.length, 1, 'allowed: the insert runs');
  const critical = fakePool();
  assert.equal(await new PostgresShadowEvidenceRuntimeStore(critical.pool, gate('STORAGE_CRITICAL', 0.9)).scheduleObservations(jobRows), 0);
  assert.equal(critical.calls.length, 0, 'denied: nothing is written');
  const unknown = fakePool();
  await new PostgresShadowEvidenceRuntimeStore(unknown.pool, new StorageWriteGate(new StaticPressureProvider(unknownPressure('STALE', 1)), { now: () => now })).scheduleObservations(jobRows);
  assert.equal(unknown.calls.length, 0, 'unknown pressure never assumes unlimited capacity for historical marks');
});

test('every P0 scope is allowed by the write gate in every state, including an unknown one', async () => {
  for (const state of [provider('STORAGE_CRITICAL', 0.95), new StaticPressureProvider(unknownPressure('MALFORMED', null))]) {
    const gate = new StorageWriteGate(state, { now: () => now });
    for (const scope of ['orders', 'fills', 'broker-reconciliation', 'execution-state', 'positions', 'inventory', 'risk', 'management', 'safety-events', 'action-plan-lineage']) {
      assert.equal(await gateAllows(gate, scope, 'P3_RAW_PROVIDER_PAYLOAD'), true, scope);
    }
    assert.equal(gate.skipped.size, 0);
  }
});

test('the Windows local research archive pauses new subjects when the PostgreSQL research gate is not ALLOW', () => {
  const dir = join(process.env.TEMP ?? '.', `theta-health-${Date.now()}`);
  const base = { healthPath: join(dir, 'h.json'), spoolPath: join(dir, 'missing.sqlite'), parquetRoot: join(dir, 'pq'), observedAt: now, archiveState: 'OK', outcome: 'UNCHANGED' as const };
  assert.equal(writeArchiveHealth({ ...base }).newSubjectScheduling, 'ALLOW');
  assert.equal(writeArchiveHealth({ ...base, postgresResearchGate: 'ALLOW' }).newSubjectScheduling, 'ALLOW');
  assert.equal(writeArchiveHealth({ ...base, postgresResearchGate: 'THROTTLE' }).newSubjectScheduling, 'PAUSE_STORAGE_PRESSURE');
  assert.equal(writeArchiveHealth({ ...base, postgresResearchGate: 'SKIP_LOW_PRIORITY' }).newSubjectScheduling, 'PAUSE_STORAGE_PRESSURE');
});

test('the Windows local research archiver passes the PostgreSQL pressure gate into every health write (inert unless THETA_STORAGE_GOVERNOR=1)', () => {
  const source = readFileSync('tools/archive-canonical-strategy-frontiers.ts', 'utf8');
  assert.match(source, /process\.env\.THETA_STORAGE_GOVERNOR !== '1'\) return undefined/);
  assert.equal((source.match(/writeArchiveHealth\(\{/g) ?? []).length, (source.match(/\.\.\.gateOptions/g) ?? []).length, 'every writeArchiveHealth call carries the gate');
});
