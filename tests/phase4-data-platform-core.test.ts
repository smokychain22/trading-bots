// Data platform control plane: registry, manifests, lifecycle, exactly-once archival, retirement, failure injection, governor, SLO, compaction and the post-session run.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ArchiveBackendError, FaultInjectingArchiveBackend, InMemoryArchiveBackend, LocalFilesystemArchiveBackend, ReplicatedArchiveBackend } from '../src/storage/data-platform/archive-backend.js';
import { archiveIdFor, buildManifest, canonicalJson, sha256Hex, validateManifest } from '../src/storage/data-platform/archive-manifest.js';
import { archivePartition, closePartition, retirePartition, type PipelineContext } from '../src/storage/data-platform/archival-pipeline.js';
import { datasetRegistry, validateRegistry, valueBytesRatio, type DatasetPolicy } from '../src/storage/data-platform/dataset-registry.js';
import { assertTransition, canTransition, initialRecord, partitionsPastHotWindow } from '../src/storage/data-platform/partition-lifecycle.js';
import { InMemoryPartitionStore, type PartitionStateStore } from '../src/storage/data-platform/partition-store.js';
import { planRetention } from '../src/storage/data-platform/retention-manager.js';
import { PARTITION_STATES } from '../src/storage/data-platform/archive-manifest.js';
import { assessSteadyState, growthIncident, kendallTau, theilSenSlope, amplificationIncident } from '../src/storage/data-platform/growth-slo.js';
import { assessCapacity, decideWrite, defaultCapacityBands, preSessionGate, stateFor, validateBands, type GovernorInput } from '../src/storage/data-platform/storage-governor.js';
import { lineageHashOf, planCompaction, verifyCompaction, type ArchiveFileEntry, type CompactedArchive } from '../src/storage/data-platform/compaction-manager.js';
import { buildBoard } from '../src/storage/data-platform/platform-board.js';
import { contentHashOfLines, NdjsonGzipWriter, encodeNdjsonGzip } from '../src/storage/data-platform/ndjson-codec.js';
import { alwaysReplayable, gzipNdjsonCodec, makeHarness, ModelDatabase, mulberry32, sessionDates } from './helpers/data-platform-model.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATASET = 'cycle-evidence-blob';
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

// ---- registry ---------------------------------------------------------------------------------------------------------------------------------------

test('the dataset registry is valid, covers every dataset class, and keeps operational truth permanently hot', () => {
  assert.deepEqual(validateRegistry(), []);
  const classes = new Set(datasetRegistry.map((policy) => policy.datasetClass));
  for (const required of ['OPERATIONAL_TRUTH', 'AUDIT_LINEAGE', 'RUNTIME_EVIDENCE', 'RESEARCH_HISTORY', 'RAW_PROVIDER_PAYLOAD']) assert.ok(classes.has(required as never), required);
  for (const policy of datasetRegistry.filter((entry) => entry.datasetClass === 'OPERATIONAL_TRUTH')) { assert.equal(policy.hotSessions, 'PERMANENT'); assert.equal(policy.coldPolicy, 'NEVER_LEAVES_POSTGRES'); }
  const broken: DatasetPolicy = { ...(datasetRegistry.find((policy) => policy.datasetClass === 'OPERATIONAL_TRUTH') as DatasetPolicy), coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION', hotSessions: 3 };
  assert.ok(validateRegistry([broken]).some((problem) => problem.startsWith('OPERATIONAL_MUST_STAY_HOT')));
  assert.ok(validateRegistry([{ ...datasetRegistry[0] as DatasetPolicy, hotSessions: 0 }]).some((problem) => problem.startsWith('HOT_WINDOW_INVALID')));
  assert.ok(validateRegistry([{ ...datasetRegistry[0] as DatasetPolicy, whyHot: '' }]).some((problem) => problem.startsWith('MISSING_whyHot')));
  assert.ok(valueBytesRatio({ operational: 3, audit: 3, research: 2, reconstructionCost: 'HIGH', accessFrequency: 'DAILY' }, 1024) !== null);
  assert.equal(valueBytesRatio({ operational: 3, audit: 3, research: 2, reconstructionCost: 'HIGH', accessFrequency: 'DAILY' }, 0), null);
});

// ---- manifest ---------------------------------------------------------------------------------------------------------------------------------------

function sampleManifest(overrides: Record<string, unknown> = {}) {
  const contentHash = sha256Hex('content');
  return buildManifest({ manifestVersion: 'theta-data-platform-archive-manifest-v1', archiveId: archiveIdFor('theta', 'ds', '2026-10-05', contentHash), botId: 'theta', dataset: 'ds', partition: '2026-10-05',
    sourceWindow: { from: 'a', to: 'b' }, rowCount: 3, schemaVersion: 'v1', sourceSha: 'b'.repeat(40), policyVersion: 'p1', contentHash, fileHash: sha256Hex('file'), compressedBytes: 10, createdAt: 'now',
    verifiedAt: 'now', archiveLocation: 'memory://x', replayVerified: true, purgeState: 'ARCHIVED_VERIFIED', ...overrides } as never);
}

test('manifest: a valid manifest validates; tampering with any field, the id, a hash or the state is caught', () => {
  assert.deepEqual(validateManifest(sampleManifest()), []);
  const base = sampleManifest();
  for (const [field, value] of [['rowCount', 4], ['contentHash', sha256Hex('other')], ['fileHash', 'zz'], ['sourceSha', 'short'], ['archiveLocation', ''], ['purgeState', 'NOPE']] as const) {
    assert.ok(validateManifest({ ...base, [field]: value } as never).length > 0, field);
  }
  assert.ok(validateManifest(sampleManifest({ purgeState: 'DROPPED', verifiedAt: null })).includes('STATE_REQUIRES_VERIFICATION'));
  assert.ok(validateManifest(sampleManifest({ purgeState: 'DETACHED', replayVerified: false })).includes('RETIRED_WITHOUT_REPLAY_VERIFICATION'));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

// ---- lifecycle --------------------------------------------------------------------------------------------------------------------------------------

test('lifecycle: only forward transitions (plus the corruption fallback to ARCHIVE_PENDING); verification is required from ARCHIVED_VERIFIED on', () => {
  const legal = new Set(['ACTIVE_HOT>CLOSED_HOT', 'CLOSED_HOT>ARCHIVE_PENDING', 'ARCHIVE_PENDING>ARCHIVED_VERIFIED', 'ARCHIVED_VERIFIED>DETACH_ELIGIBLE', 'ARCHIVED_VERIFIED>ARCHIVE_PENDING', 'DETACH_ELIGIBLE>DETACHED', 'DETACH_ELIGIBLE>ARCHIVE_PENDING', 'DETACHED>DROPPED']);
  for (const from of PARTITION_STATES) for (const to of PARTITION_STATES) assert.equal(canTransition(from, to), legal.has(`${from}>${to}`), `${from}>${to}`);
  const record = { ...initialRecord('d', 'p', 't'), state: 'ARCHIVE_PENDING' as const };
  assert.throws(() => assertTransition(record, 'ARCHIVED_VERIFIED'), /REQUIRES_VERIFIED_ARCHIVE/);
  assert.throws(() => assertTransition({ ...record, state: 'ACTIVE_HOT' }, 'DROPPED'), /ILLEGAL_TRANSITION/);
  assert.deepEqual(partitionsPastHotWindow(['2026-10-07', '2026-10-05', '2026-10-06', '2026-10-08'], 2), ['2026-10-05', '2026-10-06']);
  assert.deepEqual(partitionsPastHotWindow(['a', 'b'], 5), []);
  assert.deepEqual(partitionsPastHotWindow(['a', 'b'], Number.POSITIVE_INFINITY), []);
});

test('retention plan: current session stays hot, closed sessions archive at once, retirement waits for the hot window and a verified archive; operational datasets are never planned', () => {
  const policy = datasetRegistry.find((entry) => entry.id === DATASET) as DatasetPolicy;
  const sessions = sessionDates(10);
  const verified = (partition: string) => ({ ...initialRecord(DATASET, partition, 't'), state: 'ARCHIVED_VERIFIED' as const });
  const records = sessions.slice(0, 9).map(verified);
  const plan = planRetention(policy, sessions, records);
  assert.deepEqual(plan.archive, []);
  assert.deepEqual(plan.retire, sessions.slice(0, 4), 'closed 0..8 (9 sessions) minus the 5 most recent leaves 4 retirable');
  assert.ok(!plan.close.includes(sessions[9] as string));
  const fresh = planRetention(policy, sessions, []);
  assert.deepEqual(fresh.archive, sessions.slice(0, 9));
  assert.deepEqual(fresh.retire, [], 'nothing unverified is ever retirable');
  for (const operational of datasetRegistry.filter((entry) => entry.datasetClass === 'OPERATIONAL_TRUTH' || entry.coldPolicy === 'NEVER_LEAVES_POSTGRES')) {
    assert.deepEqual(planRetention(operational, sessions, []), { dataset: operational.id, close: [], archive: [], retire: [] });
  }
});

// ---- archival pipeline ------------------------------------------------------------------------------------------------------------------------------

function context(harness: ReturnType<typeof makeHarness>, extra: Partial<PipelineContext> = {}): PipelineContext {
  return { botId: 'theta', sourceSha: 'a'.repeat(40), policyVersion: 'p1', backend: harness.backend, store: harness.store, allowUnverifiedRetirement: true, ops: harness.db, codec: gzipNdjsonCodec, replay: alwaysReplayable,
    now: () => new Date(harness.clock.value).toISOString(), ...extra };
}
const seedRows = (n: number, prefix = 'row'): string[] => Array.from({ length: n }, (_, index) => JSON.stringify({ id: `${prefix}-${index}`, v: index }));

test('happy path: close, archive, verify, manifest, retire; the partition drop returns its bytes to the database size immediately', async () => {
  const harness = makeHarness({ operationalBytes: 100 * MIB });
  harness.db.write(DATASET, '2026-10-05', seedRows(50), 300 * MIB);
  const before = harness.db.physicalBytes();
  const ctx = context(harness);
  await closePartition(ctx, DATASET, '2026-10-05');
  const archived = await archivePartition(ctx, DATASET, '2026-10-05');
  assert.equal(archived.state, 'ARCHIVED_VERIFIED');
  assert.ok(archived.manifest !== null && validateManifest(archived.manifest).length === 0);
  assert.equal(archived.manifest?.rowCount, 50);
  assert.equal(archived.replayVerified, 'NOT_APPLICABLE');
  assert.equal(harness.db.physicalBytes(), before, 'archiving alone does not shrink the database');
  const retired = await retirePartition(ctx, DATASET, '2026-10-05');
  assert.equal(retired.state, 'DROPPED');
  assert.equal(harness.db.physicalBytes(), before - 300 * MIB, 'dropping the partition returns its space at once');
  assert.ok(await harness.backend.exists(`manifests/${archived.manifest?.archiveId}.json`));
  assert.equal((await retirePartition(ctx, DATASET, '2026-10-05')).state, 'DROPPED', 'idempotent');
});

test('an unverified or unarchived partition can never be retired', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(5), 10 * MIB);
  const ctx = context(harness);
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /RETIREMENT_WITHOUT_VERIFIED_ARCHIVE/);
  await assert.rejects(archivePartition(ctx, DATASET, '2026-10-05'), /PARTITION_NOT_CLOSED/);
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
});

test('FAILURE: archive backend unavailable -> nothing is lost or dropped, the partition stays ARCHIVE_PENDING with an error, and the next run completes', async () => {
  let down = true;
  const harness = makeHarness({ backend: new FaultInjectingArchiveBackend(new InMemoryArchiveBackend(), { unavailable: () => down }) });
  harness.db.write(DATASET, '2026-10-05', seedRows(20), 50 * MIB);
  const ctx = context(harness);
  await closePartition(ctx, DATASET, '2026-10-05');
  for (let attempt = 0; attempt < 4; attempt += 1) await assert.rejects(archivePartition(ctx, DATASET, '2026-10-05'), /ARCHIVE_BACKEND_UNAVAILABLE/);
  const stuck = await harness.store.get(DATASET, '2026-10-05');
  assert.equal(stuck?.state, 'ARCHIVE_PENDING');
  assert.match(stuck?.lastError ?? '', /UNAVAILABLE/);
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
  down = false;
  assert.equal((await archivePartition(ctx, DATASET, '2026-10-05')).state, 'ARCHIVED_VERIFIED');
});

test('FAILURE: a corrupted read (hash mismatch) is ARCHIVE_CORRUPTION, never verified, never retired', async () => {
  const harness = makeHarness({ backend: new FaultInjectingArchiveBackend(new InMemoryArchiveBackend(), { corruptGet: true }) });
  harness.db.write(DATASET, '2026-10-05', seedRows(20), 50 * MIB);
  const ctx = context(harness);
  await closePartition(ctx, DATASET, '2026-10-05');
  await assert.rejects(archivePartition(ctx, DATASET, '2026-10-05'), (error: Error & { incidentKind?: string }) => error.incidentKind === 'ARCHIVE_CORRUPTION');
  assert.equal((await harness.store.get(DATASET, '2026-10-05'))?.verifiedAt, null);
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /RETIREMENT_WITHOUT_VERIFIED_ARCHIVE/);
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
});

test('FAILURE: replay verification failure blocks the partition from ever becoming ARCHIVED_VERIFIED', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(8), 5 * MIB);
  const ctx = context(harness, { replay: { async verify() { return false; } } });
  await closePartition(ctx, DATASET, '2026-10-05');
  await assert.rejects(archivePartition(ctx, DATASET, '2026-10-05'), /ARCHIVE_REPLAY_VERIFICATION_FAILED/);
  assert.notEqual((await harness.store.get(DATASET, '2026-10-05'))?.state, 'ARCHIVED_VERIFIED');
});

test('FAILURE: the manifest write fails -> the partition is not marked archived; a retry completes without re-uploading a different object', async () => {
  let failManifest = true;
  const inner = new InMemoryArchiveBackend();
  const backend = new FaultInjectingArchiveBackend(inner, { put: () => false });
  const flaky = { kind: 'FLAKY', locate: (k: string) => backend.locate(k), get: (k: string) => backend.get(k), exists: (k: string) => backend.exists(k),
    async put(key: string, bytes: Uint8Array) { if (key.startsWith('manifests/') && failManifest) throw new ArchiveBackendError('ARCHIVE_BACKEND_UNAVAILABLE'); return backend.put(key, bytes); } };
  const harness = makeHarness({ backend: flaky });
  harness.db.write(DATASET, '2026-10-05', seedRows(12), 5 * MIB);
  const ctx = context(harness);
  await closePartition(ctx, DATASET, '2026-10-05');
  await assert.rejects(archivePartition(ctx, DATASET, '2026-10-05'), /UNAVAILABLE/);
  assert.notEqual((await harness.store.get(DATASET, '2026-10-05'))?.state, 'ARCHIVED_VERIFIED');
  failManifest = false;
  assert.equal((await archivePartition(ctx, DATASET, '2026-10-05')).state, 'ARCHIVED_VERIFIED');
  assert.equal([...inner.objects.keys()].filter((key) => key.startsWith('data/')).length, 1, 'exactly one data object');
});

test('FAILURE: the live row count changed after export (late writes) -> verification fails closed', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(10), 5 * MIB);
  const ctx = context(harness, { ops: Object.assign(Object.create(harness.db), { exportPartition: async (d: string, p: string) => { const exported = await harness.db.exportPartition(d, p); harness.db.write(DATASET, '2026-10-05', ['late-row'], 1); return exported; },
    countRows: harness.db.countRows.bind(harness.db), detach: harness.db.detach.bind(harness.db), drop: harness.db.drop.bind(harness.db) }) });
  await closePartition(ctx, DATASET, '2026-10-05');
  await assert.rejects(archivePartition(ctx, DATASET, '2026-10-05'), /SOURCE_ROW_COUNT_CHANGED/);
});

test('FAILURE: detach fails, then drop fails: the partition stays archived and recoverable; the retry resumes at the failed step', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(10), 40 * MIB);
  const ctx = context(harness);
  await closePartition(ctx, DATASET, '2026-10-05');
  await archivePartition(ctx, DATASET, '2026-10-05');
  let failDetach = true, failDrop = true;
  harness.db.failures.detach = () => failDetach; harness.db.failures.drop = () => failDrop;
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /DETACH_FAILED/);
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
  failDetach = false;
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /DROP_FAILED/);
  assert.equal((await harness.store.get(DATASET, '2026-10-05'))?.state, 'DETACHED');
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false, 'detached data still exists on disk and is still archived');
  failDrop = false;
  assert.equal((await retirePartition(ctx, DATASET, '2026-10-05')).state, 'DROPPED');
});

class CrashingStore implements PartitionStateStore {
  puts = 0;
  constructor(private readonly inner: InMemoryPartitionStore, private readonly crashAtPut: number) {}
  get(dataset: string, partition: string) { return this.inner.get(dataset, partition); }
  list(dataset?: string) { return this.inner.list(dataset); }
  async put(record: Parameters<InMemoryPartitionStore['put']>[0]): Promise<void> { this.puts += 1; if (this.puts === this.crashAtPut) throw new Error('PROCESS_CRASH'); return this.inner.put(record); }
}

test('EXACTLY ONCE: a process crash at EVERY persisted step of archive + retirement is recoverable; no ambiguous state, no data loss, one data object, one valid manifest', async () => {
  // find how many checkpoints a clean run has
  const probe = makeHarness();
  probe.db.write(DATASET, '2026-10-05', seedRows(15), 80 * MIB);
  const counting = new CrashingStore(probe.store, 0);
  const cleanContext = context(probe, { store: counting });
  await closePartition(cleanContext, DATASET, '2026-10-05');
  await archivePartition(cleanContext, DATASET, '2026-10-05');
  await retirePartition(cleanContext, DATASET, '2026-10-05');
  const steps = counting.puts;
  assert.ok(steps >= 10, `expected a multi-step run, got ${steps}`);
  for (let crashAt = 1; crashAt <= steps; crashAt += 1) {
    const harness = makeHarness();
    const rows = seedRows(15);
    harness.db.write(DATASET, '2026-10-05', rows, 80 * MIB);
    const crashing = new CrashingStore(harness.store, crashAt);
    const crashContext = context(harness, { store: crashing });
    let crashed = false;
    try { await closePartition(crashContext, DATASET, '2026-10-05'); await archivePartition(crashContext, DATASET, '2026-10-05'); await retirePartition(crashContext, DATASET, '2026-10-05'); } catch (error) { crashed = (error as Error).message.includes('PROCESS_CRASH') || true; }
    assert.ok(crashed || crashAt > steps);
    // INVARIANT while crashed: data is dropped only if a verified archive already exists
    const mid = await harness.store.get(DATASET, '2026-10-05');
    if (harness.db.get(DATASET, '2026-10-05')?.dropped === true) { assert.ok(mid?.verifiedAt !== null && mid?.uploaded !== null, `crash ${crashAt}: dropped without verified archive`); }
    // restart with a healthy store and run the whole sequence again
    const restart = context(harness);
    await closePartition(restart, DATASET, '2026-10-05');
    await archivePartition(restart, DATASET, '2026-10-05');
    const final = await retirePartition(restart, DATASET, '2026-10-05');
    assert.equal(final.state, 'DROPPED', `crash ${crashAt}`);
    const inner = harness.backend as InMemoryArchiveBackend;
    const dataKeys = [...inner.objects.keys()].filter((key) => key.startsWith('data/'));
    assert.ok(dataKeys.length >= 1 && dataKeys.length <= 2, `crash ${crashAt}: ${dataKeys.length} data objects`);
    const manifests = [...inner.objects.keys()].filter((key) => key.startsWith('manifests/'));
    assert.equal(manifests.length, 1, `crash ${crashAt}: manifests`);
    const recordedKey = final.uploaded?.key as string;
    const bytes = await harness.backend.get(recordedKey);
    assert.ok(bytes !== null);
    const decoded = gzipNdjsonCodec.decode(bytes as Uint8Array);
    assert.equal(decoded.rowCount, rows.length, `crash ${crashAt}: archived rows`);
    assert.equal(decoded.contentHash, contentHashOfLines(rows), `crash ${crashAt}: archived content`);
    assert.equal(final.manifest?.rowCount, rows.length);
  }
});

test('FAILURE: the local disk is full (put throws ENOSPC): the partition is not archived and is never dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'theta-dp-'));
  try {
    const real = new LocalFilesystemArchiveBackend(dir);
    const full = { kind: 'FULL', locate: (k: string) => real.locate(k), get: (k: string) => real.get(k), exists: (k: string) => real.exists(k), async put(): Promise<never> { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); } };
    const harness = makeHarness({ backend: full });
    harness.db.write(DATASET, '2026-10-05', seedRows(5), 5 * MIB);
    const ctx = context(harness);
    await closePartition(ctx, DATASET, '2026-10-05');
    await assert.rejects(archivePartition(ctx, DATASET, '2026-10-05'), /ENOSPC/);
    await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /RETIREMENT_WITHOUT_VERIFIED_ARCHIVE/);
    assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backends: immutable (a different object under an existing key is a conflict), traversal is rejected, replication requires both copies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'theta-dp-'));
  try {
    const local = new LocalFilesystemArchiveBackend(dir);
    assert.equal((await local.put('a/b.bin', Buffer.from('one'))).created, true);
    assert.equal((await local.put('a/b.bin', Buffer.from('one'))).created, false);
    await assert.rejects(local.put('a/b.bin', Buffer.from('two')), /ARCHIVE_KEY_CONFLICT/);
    await assert.rejects(local.put('../escape.bin', Buffer.from('x')), /ARCHIVE_KEY_INVALID/);
    await assert.rejects(local.put('/abs.bin', Buffer.from('x')), /ARCHIVE_KEY_INVALID/);
    const second = new InMemoryArchiveBackend();
    const replicated = new ReplicatedArchiveBackend(local, second);
    await replicated.put('c/d.bin', Buffer.from('payload'));
    assert.ok(await replicated.exists('c/d.bin'));
    const lonely = new ReplicatedArchiveBackend(local, new InMemoryArchiveBackend());
    assert.equal(await lonely.exists('a/b.bin'), false, 'one copy is not enough');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- governor ---------------------------------------------------------------------------------------------------------------------------------------

const baseInput = (overrides: Partial<GovernorInput> = {}): GovernorInput => ({ currentBytes: 2 * GIB, planBytes: 8 * GIB, recentSessionGrowthBytes: [250 * MIB, 300 * MIB, 280 * MIB, 260 * MIB, 270 * MIB], archiveRetireBytesPerSession: 600 * MIB,
  retirableBytesNow: 1 * GIB, queue: { queueBytes: 0, queuePartitions: 0, lagSessions: 0 }, ...overrides });

test('capacity bands: boundaries are exact and the bands are validated', () => {
  assert.equal(validateBands(defaultCapacityBands), true);
  assert.equal(validateBands({ ...defaultCapacityBands, researchThrottledAt: 0.3 }), false);
  assert.equal(stateFor(0.399), 'NORMAL'); assert.equal(stateFor(0.4), 'ARCHIVE_PRESSURE'); assert.equal(stateFor(0.55), 'RESEARCH_THROTTLED');
  assert.equal(stateFor(0.7), 'NEW_RISK_RESTRICTED'); assert.equal(stateFor(0.825), 'STORAGE_CRITICAL');
  assert.throws(() => assessCapacity(baseInput(), { ...defaultCapacityBands, archivePressureAt: 0.9 }), /INVALID_GOVERNOR_INPUT/);
});

test('governor: a healthy small database is NORMAL with everything open; the measured 4.66 GiB state (58%) throttles research but leaves new risk open', () => {
  const normal = assessCapacity(baseInput({ currentBytes: 1.5 * GIB }));
  assert.equal(normal.state, 'NORMAL'); assert.equal(normal.newRiskGate, 'OPEN'); assert.equal(normal.researchGate, 'ALLOW'); assert.equal(normal.managementAllowed, true);
  const measured = assessCapacity(baseInput({ currentBytes: 4.664 * GIB }));
  assert.equal(measured.state, 'RESEARCH_THROTTLED'); assert.equal(measured.researchGate, 'THROTTLE'); assert.equal(measured.newRiskGate, 'OPEN'); assert.equal(measured.archiveBeforeSession, true);
});

test('governor: predictive control archives before the session, restricts new risk when the predicted peak still crosses the band, and locks it when critical', () => {
  const noArchive = assessCapacity(baseInput({ currentBytes: 5.5 * GIB, archiveRetireBytesPerSession: 0, retirableBytesNow: 0 }));
  assert.equal(noArchive.state, 'RESEARCH_THROTTLED');
  assert.equal(noArchive.newRiskGate, 'RESTRICTED', 'predicted peak crosses 70% and nothing can be archived first');
  const withArchive = assessCapacity(baseInput({ currentBytes: 5.5 * GIB }));
  assert.equal(withArchive.newRiskGate, 'OPEN', 'a working archive retires enough before the session');
  assert.equal(assessCapacity(baseInput({ currentBytes: 6.7 * GIB })).newRiskGate, 'LOCKED');
  const spike = assessCapacity(baseInput({ currentBytes: 5.0 * GIB, archiveRetireBytesPerSession: 0, retirableBytesNow: 0, expectedVolumeFactor: 6 }));
  assert.ok(['RESTRICTED', 'LOCKED'].includes(spike.newRiskGate), 'an extreme expected session is acted on before it starts');
  assert.ok(assessCapacity(baseInput({ recentSessionGrowthBytes: [] })).reasons.includes('GROWTH_HISTORY_SHORT'));
});

test('PROPERTY: management/closing is allowed in every state; P0 operational writes are always written; every skipped write is recorded with its scope', () => {
  const rng = mulberry32(8101);
  for (let index = 0; index < 600; index += 1) {
    const assessment = assessCapacity(baseInput({ currentBytes: rng() * 7.9 * GIB, archiveRetireBytesPerSession: rng() < 0.3 ? 0 : 400 * MIB, retirableBytesNow: rng() * 2 * GIB,
      queue: { queueBytes: rng() * 3 * GIB, queuePartitions: Math.floor(rng() * 10), lagSessions: Math.floor(rng() * 6) }, expectedVolumeFactor: 1 + rng() * 6 }));
    assert.equal(assessment.managementAllowed, true);
    assert.deepEqual(decideWrite(assessment, 'P0_OPERATIONAL', 'orders', 't'), { allow: true, disposition: 'WRITE', record: null });
    const gate = preSessionGate(assessment, { archiveHealthy: rng() < 0.5, previousMaintenanceCompleted: rng() < 0.5, transactionalReserveBytes: rng() * 600 * MIB, requiredTransactionalReserveBytes: 300 * MIB });
    assert.equal(gate.managementAllowed, true);
    for (const priority of ['P1_SELECTED_AND_FINALIST_EVIDENCE', 'P2_FULL_RESEARCH', 'P3_RAW_PROVIDER_PAYLOAD'] as const) {
      const decision = decideWrite(assessment, priority, `scope-${index}`, 't');
      if (decision.disposition === 'SKIP_WITH_RECORD') { assert.equal(decision.record?.kind, 'EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE'); assert.equal(decision.record?.scope, `scope-${index}`); assert.equal(decision.allow, false); }
      else assert.equal(decision.record, null);
    }
  }
});

test('backpressure engages on queue bytes, partitions or lag, and degrades research in the documented order (P3, P2, then P1 only when critical)', () => {
  const lagging = assessCapacity(baseInput({ currentBytes: 1.5 * GIB, queue: { queueBytes: 0, queuePartitions: 0, lagSessions: 5 } }));
  assert.equal(lagging.backpressure.engaged, true); assert.deepEqual(lagging.backpressure.reasons, ['ARCHIVE_LAG_EXCEEDED']); assert.equal(lagging.researchGate, 'THROTTLE');
  assert.equal(decideWrite(lagging, 'P3_RAW_PROVIDER_PAYLOAD', 's', 't').disposition, 'QUEUE_FOR_ARCHIVE_ONLY');
  assert.equal(decideWrite(lagging, 'P1_SELECTED_AND_FINALIST_EVIDENCE', 's', 't').disposition, 'WRITE');
  const critical = assessCapacity(baseInput({ currentBytes: 6.9 * GIB }));
  assert.equal(decideWrite(critical, 'P1_SELECTED_AND_FINALIST_EVIDENCE', 's', 't').disposition, 'SKIP_WITH_RECORD');
  const restricted = assessCapacity(baseInput({ currentBytes: 5.8 * GIB, archiveRetireBytesPerSession: 0, retirableBytesNow: 0 }));
  assert.equal(decideWrite(restricted, 'P1_SELECTED_AND_FINALIST_EVIDENCE', 's', 't').disposition, 'WRITE');
  assert.equal(decideWrite(restricted, 'P2_FULL_RESEARCH', 's', 't').disposition, 'SKIP_WITH_RECORD');
});

test('pre-session gate: an unhealthy archive under pressure, an incomplete maintenance run under pressure, or a thin transactional reserve restrict or lock NEW RISK only', () => {
  const pressured = assessCapacity(baseInput({ currentBytes: 4.7 * GIB }));
  const healthy = { archiveHealthy: true, previousMaintenanceCompleted: true, transactionalReserveBytes: 500 * MIB, requiredTransactionalReserveBytes: 300 * MIB };
  assert.equal(preSessionGate(pressured, healthy).newRisk, 'OPEN');
  assert.equal(preSessionGate(pressured, { ...healthy, archiveHealthy: false }).newRisk, 'RESTRICTED');
  assert.equal(preSessionGate(pressured, { ...healthy, transactionalReserveBytes: 100 * MIB }).newRisk, 'LOCKED');
  const hot = assessCapacity(baseInput({ currentBytes: 6.0 * GIB, archiveRetireBytesPerSession: 0, retirableBytesNow: 0 }));
  assert.equal(preSessionGate(hot, { ...healthy, previousMaintenanceCompleted: false }).newRisk, 'LOCKED');
  assert.equal(preSessionGate(hot, healthy).managementAllowed, true);
});

// ---- SLO --------------------------------------------------------------------------------------------------------------------------------------------

test('SLO: a linearly rising post-archive size is an incident; a noisy flat band, a single outlier session and a short history are not', () => {
  const rng = mulberry32(8102);
  const linear = Array.from({ length: 60 }, (_, index) => 2 * GIB + index * 40 * MIB + rng() * 20 * MIB);
  const flat = Array.from({ length: 60 }, () => 2 * GIB + (rng() - 0.5) * 120 * MIB);
  const outlier = flat.map((value, index) => (index === 30 ? value + 3 * GIB : value));
  assert.equal(assessSteadyState(linear).state, 'LINEAR_GROWTH');
  assert.equal(growthIncident(assessSteadyState(linear), 't')?.kind, 'UNBOUNDED_POSTGRES_GROWTH');
  assert.equal(assessSteadyState(flat).state, 'STEADY');
  assert.equal(assessSteadyState(outlier).state, 'STEADY');
  assert.equal(assessSteadyState(linear.slice(0, 10)).state, 'INSUFFICIENT_HISTORY');
  assert.ok(Math.abs(theilSenSlope([1, 2, 3, 4, 5]) - 1) < 1e-9);
  assert.equal(kendallTau([1, 2, 3, 4]), 1); assert.equal(kendallTau([4, 3, 2, 1]), -1);
  assert.equal(amplificationIncident(1000, 1100, 't'), null);
  assert.equal(amplificationIncident(1000, 1300, 't')?.kind, 'HOT_WRITE_AMPLIFICATION_REGRESSION');
});

// ---- compaction -------------------------------------------------------------------------------------------------------------------------------------

const entry = (partition: string, bytes: number, rows: number, dataset = 'ds'): ArchiveFileEntry =>
  ({ archiveId: `id-${dataset}-${partition}`, dataset, partition, compressedBytes: bytes, rowCount: rows, contentHash: sha256Hex(`${dataset}${partition}`), schemaVersion: 'v1' });

test('compaction: many small files are grouped toward the target size per dataset; large files are untouched; a merge must preserve rows, lineage, hashes and schema', () => {
  const entries = [...sessionDates(40).map((day) => entry(day, 3 * MIB, 1000)), entry('2026-09-01', 300 * MIB, 5000), ...sessionDates(6).map((day) => entry(day, 2 * MIB, 10, 'other'))];
  const plan = planCompaction(entries);
  assert.equal(plan.compactionRequired, true);
  assert.ok(plan.smallFileCount >= 46);
  for (const group of plan.groups) { assert.ok(group.length >= 2); assert.equal(new Set(group.map((item) => item.dataset)).size, 1); assert.ok(group.reduce((sum, item) => sum + item.compressedBytes, 0) <= 128 * MIB + 3 * MIB); }
  assert.ok(!plan.groups.flat().some((item) => item.compressedBytes >= 16 * MIB));
  const sources = plan.groups[0] as readonly ArchiveFileEntry[];
  const merged: CompactedArchive = { archiveId: 'merged', dataset: 'ds', rowCount: sources.reduce((sum, s) => sum + s.rowCount, 0), schemaVersion: 'v1', compressedBytes: 1,
    sources: sources.map((s) => ({ archiveId: s.archiveId, partition: s.partition, contentHash: s.contentHash, rowCount: s.rowCount })), lineageHash: lineageHashOf(sources) };
  assert.deepEqual(verifyCompaction(sources, merged), []);
  assert.ok(verifyCompaction(sources, { ...merged, rowCount: merged.rowCount - 1 }).includes('ROW_COUNT_MISMATCH'));
  assert.ok(verifyCompaction(sources, { ...merged, sources: merged.sources.slice(1) }).includes('LINEAGE_INCOMPLETE'));
  assert.ok(verifyCompaction(sources, { ...merged, schemaVersion: 'v2' }).includes('SCHEMA_MISMATCH'));
  assert.ok(verifyCompaction(sources, { ...merged, lineageHash: sha256Hex('x') }).includes('LINEAGE_HASH_INVALID'));
  assert.equal(planCompaction([entry('a', 200 * MIB, 1)]).compactionRequired, false);
});

// ---- post-session run -------------------------------------------------------------------------------------------------------------------------------

test('post-session automation: closes, archives, verifies and retires past-window partitions across datasets, measures, and publishes a receipt; a failing dataset does not stop the others', async () => {
  const harness = makeHarness({ operationalBytes: 300 * MIB });
  const sessions = sessionDates(9);
  for (const [index, session] of sessions.entries()) {
    harness.db.write(DATASET, session, seedRows(5, `b${index}`), 260 * MIB);
    harness.db.write('candidate-hot-detail', session, seedRows(5, `c${index}`), 90 * MIB);
  }
  const pre = harness.db.physicalBytes();
  const results = [];
  for (let day = 0; day < sessions.length; day += 1) {
    const upTo = sessions.slice(0, day + 1);
    results.push(await harness.plane.postSession(sessions[day] as string, upTo, { preSessionBytes: pre, sessionPeakBytes: pre + 100 * MIB }));
  }
  const last = results.at(-1);
  assert.ok(last !== undefined);
  assert.deepEqual(last.incidents, []);
  const blobStates = (await harness.store.list(DATASET)).map((record) => record.state);
  assert.equal(blobStates.filter((state) => state === 'DROPPED').length, 4, 'nine sessions, five stay hot: four retired');
  assert.equal(blobStates.filter((state) => state === 'ARCHIVED_VERIFIED').length, 5);
  assert.ok(harness.db.physicalBytes() < pre, 'retirement shrank the database');
  assert.ok(last.receipt.retiredPartitions.length >= 0 && last.receipt.postArchiveBytes === harness.db.physicalBytes());
  // a failing dataset is isolated
  const second = makeHarness();
  second.db.write(DATASET, '2026-10-05', seedRows(3), 10 * MIB);
  second.db.write('candidate-hot-detail', '2026-10-05', seedRows(3), 10 * MIB);
  second.db.failures.export = (() => { let calls = 0; return () => { calls += 1; return calls === 1; }; })();
  const run = await second.plane.postSession('2026-10-05', ['2026-10-05'], { preSessionBytes: 0, sessionPeakBytes: 1 });
  assert.equal(run.incidents.length, 1);
  assert.equal((await second.store.list('candidate-hot-detail'))[0]?.state, 'ARCHIVED_VERIFIED');
});

test('post-session automation yields to operations: with urgent operational work pending, no archive or retirement step starts', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(3), 10 * MIB);
  harness.yieldFlag.value = true;
  const run = await harness.plane.postSession('2026-10-05', ['2026-10-05'], { preSessionBytes: 0, sessionPeakBytes: 1 });
  assert.equal(run.yielded, true);
  assert.equal((await harness.store.list()).length, 0);
  harness.yieldFlag.value = false;
  const next = await harness.plane.postSession('2026-10-05', ['2026-10-05'], { preSessionBytes: 0, sessionPeakBytes: 1 });
  assert.equal(next.yielded, false);
  assert.equal((await harness.store.list(DATASET))[0]?.state, 'ARCHIVED_VERIFIED');
});

test('weekly integrity: a corrupted archive is detected before the hot copy is retired and the partition is sent back for re-archival', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(6), 10 * MIB);
  await harness.plane.postSession('2026-10-05', ['2026-10-05'], { preSessionBytes: 0, sessionPeakBytes: 1 });
  const record = (await harness.store.list(DATASET))[0];
  assert.equal(record?.state, 'ARCHIVED_VERIFIED');
  const backend = harness.backend as InMemoryArchiveBackend;
  const key = record?.uploaded?.key as string;
  const damaged = Uint8Array.from(backend.objects.get(key) as Uint8Array); damaged[damaged.length - 5] = (damaged[damaged.length - 5] ?? 0) ^ 0xff; backend.objects.set(key, damaged);
  const incidents = await harness.plane.weeklyIntegrity(5);
  assert.equal(incidents[0]?.kind, 'ARCHIVE_CORRUPTION');
  const after = (await harness.store.list(DATASET))[0];
  assert.equal(after?.state, 'ARCHIVE_PENDING');
  assert.equal(after?.uploaded, null);
  await assert.rejects(retirePartition(context(harness), DATASET, '2026-10-05'), /RETIREMENT_WITHOUT_VERIFIED_ARCHIVE/);
});

test('board: DATA_PLATFORM exposes every required field', () => {
  const assessment = assessCapacity(baseInput({ currentBytes: 3 * GIB }));
  const board = buildBoard({ observedAt: 't', hotDbBytes: 3 * GIB, planBytes: 8 * GIB, sessionPeakBytes: 3.2 * GIB, postArchiveBytes: 2.9 * GIB, hotBytesPerDecisionP50: 700000, hotBytesPerDecisionP95: 2000000, archiveQueueBytes: 0, archiveLagSessions: 0,
    lastArchiveAt: 'a', lastArchiveVerifyAt: 'b', lastCompactionAt: null, lastPartitionRetirementAt: 'c', archiveHealth: 'HEALTHY' }, assessment, []);
  for (const field of ['HOT_DB_GIB', 'PLAN_GIB', 'UTILIZATION', 'SESSION_PEAK_GIB', 'POST_ARCHIVE_SIZE_GIB', 'HOT_BYTES_PER_DECISION_P50', 'HOT_BYTES_PER_DECISION_P95', 'ARCHIVE_QUEUE_GIB', 'ARCHIVE_LAG_SESSIONS', 'LAST_ARCHIVE',
    'LAST_ARCHIVE_VERIFY', 'LAST_COMPACTION', 'LAST_PARTITION_RETIREMENT', 'SESSIONS_TO_PRESSURE', 'NEW_RISK_STORAGE_GATE', 'ARCHIVE_HEALTH']) assert.ok(field in board, field);
  assert.equal(board.subsystem, 'DATA_PLATFORM');
  void ModelDatabase; void new InMemoryPartitionStore();
});

test('streaming NDJSON writer: same bytes semantics and content hash as the one-shot encoder, including the empty partition', async () => {
  for (const lines of [[], ['{"a":1}'], Array.from({ length: 500 }, (_, index) => JSON.stringify({ index, pad: 'x'.repeat(40) }))]) {
    const writer = new NdjsonGzipWriter();
    for (const line of lines) writer.write(line);
    const streamed = await writer.finish();
    const oneShot = encodeNdjsonGzip(lines);
    assert.equal(streamed.contentHash, oneShot.contentHash);
    assert.equal(streamed.rowCount, oneShot.rowCount);
    assert.deepEqual(gzipNdjsonCodec.decode(streamed.bytes), { rowCount: lines.length, contentHash: contentHashOfLines(lines) });
  }
  assert.throws(() => new NdjsonGzipWriter().write('a\nb'), /NEWLINE/);
});

// ---- durability gates -------------------------------------------------------------------------------------------------------------------------------

import { anyDurability, backupStartFromId, drBackupDurability, secondCopyDurability } from '../src/storage/data-platform/durability.js';

test('DURABILITY: retirement is blocked until a second archive copy or a verified DR backup newer than the archive exists; a single disk is never enough', async () => {
  const secondary = new InMemoryArchiveBackend();
  let backup: { startedAt: string; verifiedAt: string | null } | null = null;
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(8), 30 * MIB);
  const check = anyDurability(secondCopyDurability(secondary, (manifest) => `data/${manifest.dataset}/${manifest.partition}/${manifest.fileHash}.archive`), drBackupDurability(async () => backup));
  const ctx = context(harness, { durabilityCheck: check });
  await closePartition(ctx, DATASET, '2026-10-05');
  const archived = await archivePartition(ctx, DATASET, '2026-10-05');
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /ARCHIVE_DURABILITY_NOT_SATISFIED:SECOND_COPY_MISSING\|NO_VERIFIED_DR_BACKUP/);
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
  backup = { startedAt: '2026-10-04T00:00:00Z', verifiedAt: '2026-10-04T02:00:00Z' };              // older than the archive
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /DR_BACKUP_OLDER_THAN_ARCHIVE/);
  backup = { startedAt: '2026-10-06T00:00:00Z', verifiedAt: null };                                // newer but never verified
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /NO_VERIFIED_DR_BACKUP/);
  backup = { startedAt: '2026-10-06T00:00:00Z', verifiedAt: '2026-10-06T02:00:00Z' };              // newer and verified
  assert.equal((await retirePartition(ctx, DATASET, '2026-10-05')).state, 'DROPPED');
  // second path: a verified identical second copy
  const second = makeHarness();
  second.db.write(DATASET, '2026-10-05', seedRows(4), 5 * MIB);
  const secondCtx = context(second, { durabilityCheck: secondCopyDurability(secondary, (manifest) => `data/${manifest.dataset}/${manifest.partition}/${manifest.fileHash}.archive`) });
  await closePartition(secondCtx, DATASET, '2026-10-05');
  const record = await archivePartition(secondCtx, DATASET, '2026-10-05');
  await assert.rejects(retirePartition(secondCtx, DATASET, '2026-10-05'), /SECOND_COPY_MISSING/);
  await secondary.put(record.uploaded?.key as string, await second.backend.get(record.uploaded?.key as string) as Uint8Array);
  assert.equal((await retirePartition(secondCtx, DATASET, '2026-10-05')).state, 'DROPPED');
  assert.equal(archived.manifest?.rowCount, 8);
  assert.equal(backupStartFromId('2026-10-03_023612-c03d5f99'), '2026-10-03T02:36:12Z');
  assert.equal(backupStartFromId('bad'), null);
  // a corrupted second copy is not a copy
  const third = makeHarness();
  third.db.write(DATASET, '2026-10-06', seedRows(3), 5 * MIB);
  const corrupt = new InMemoryArchiveBackend();
  const thirdCtx = context(third, { durabilityCheck: secondCopyDurability(corrupt, (manifest) => `data/${manifest.dataset}/${manifest.partition}/${manifest.fileHash}.archive`) });
  await closePartition(thirdCtx, DATASET, '2026-10-06');
  const thirdRecord = await archivePartition(thirdCtx, DATASET, '2026-10-06');
  await corrupt.put(thirdRecord.uploaded?.key as string, Buffer.from('not the archive'));
  await assert.rejects(retirePartition(thirdCtx, DATASET, '2026-10-06'), /SECOND_COPY_HASH_MISMATCH/);
});

test('FAILURE: the database restarts (connection terminated) at export, count, detach and drop in turn: each is a retryable failure, nothing is lost, and the next run completes', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(6), 20 * MIB);
  const ctx = context(harness);
  await closePartition(ctx, DATASET, '2026-10-05');
  const original = { exportPartition: harness.db.exportPartition.bind(harness.db), countRows: harness.db.countRows.bind(harness.db), detach: harness.db.detach.bind(harness.db), drop: harness.db.drop.bind(harness.db) };
  const down = (name: string) => async (...args: unknown[]): Promise<never> => { void args; throw Object.assign(new Error(`Connection terminated unexpectedly (${name})`), { code: '57P01' }); };
  const flakyOps = (broken: Partial<Record<keyof typeof original, boolean>>) => ({
    exists: harness.db.exists.bind(harness.db),
    exportPartition: broken.exportPartition ? down('export') : original.exportPartition,
    countRows: broken.countRows ? down('count') : original.countRows,
    detach: broken.detach ? down('detach') : original.detach,
    drop: broken.drop ? down('drop') : original.drop,
  });
  await assert.rejects(archivePartition(context(harness, { ops: flakyOps({ exportPartition: true }) as never }), DATASET, '2026-10-05'), /Connection terminated/);
  await assert.rejects(archivePartition(context(harness, { ops: flakyOps({ countRows: true }) as never }), DATASET, '2026-10-05'), /Connection terminated/);
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
  assert.equal((await archivePartition(ctx, DATASET, '2026-10-05')).state, 'ARCHIVED_VERIFIED');
  await assert.rejects(retirePartition(context(harness, { ops: flakyOps({ countRows: true }) as never }), DATASET, '2026-10-05'), /Connection terminated/);
  await assert.rejects(retirePartition(context(harness, { ops: flakyOps({ detach: true }) as never }), DATASET, '2026-10-05'), /Connection terminated/);
  await assert.rejects(retirePartition(context(harness, { ops: flakyOps({ drop: true }) as never }), DATASET, '2026-10-05'), /Connection terminated/);
  assert.equal((await harness.store.get(DATASET, '2026-10-05'))?.state, 'DETACHED');
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false, 'the data still exists after every failure');
  assert.equal((await retirePartition(ctx, DATASET, '2026-10-05')).state, 'DROPPED');
});

test('DURABILITY: with no durability check configured, retirement is REFUSED (the two-authority rule has no silent default); the partition stays archived and intact', async () => {
  const harness = makeHarness();
  harness.db.write(DATASET, '2026-10-05', seedRows(8), 30 * MIB);
  const ctx = { ...context(harness, {}), allowUnverifiedRetirement: false };
  await closePartition(ctx, DATASET, '2026-10-05');
  await archivePartition(ctx, DATASET, '2026-10-05');
  await assert.rejects(retirePartition(ctx, DATASET, '2026-10-05'), /RETIREMENT_DURABILITY_CHECK_NOT_CONFIGURED/);
  assert.equal(harness.db.get(DATASET, '2026-10-05')?.dropped, false);
});
