// Phase 4 storage decision: archive-before-purge library, population definitions and the v2 budget model.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ArchiveChunkWriter, buildManifest, evaluatePurgeEligibility, isOperationalRelation, isOutsideDatabaseArchiveRoot, readArchiveRows, verifyArchiveOnDisk, type ArchiveManifest, type PurgeEligibilityEvidence,
} from '../tools/storage/storage-archive-lib.js';
import { archivePopulations } from '../tools/storage/storage-populations.js';
import {
  assessStorageBudgetV2, OPERATIONAL_WRITE_CLASSES, RESEARCH_WRITE_CLASSES, thetaStorageBudgetV2, writePolicyFor, type StorageActionState,
} from '../tools/storage/storage-budget-v2.js';

const SHA = 'a'.repeat(40);
const GIB = 1024 ** 3;

function archiveRows(count: number, maxChunkBytes: number): { directory: string; manifest: ArchiveManifest } {
  const directory = mkdtempSync(join(tmpdir(), 'theta-archive-'));
  const writer = new ArchiveChunkWriter(directory, 'pop', maxChunkBytes);
  for (let index = 0; index < count; index += 1) {
    const key = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    writer.add({ key, time: `2026-09-2${index % 5}T10:00:00Z`, json: JSON.stringify({ id: key, payload: { n: index, text: 'x'.repeat(50) } }) });
  }
  writer.flush();
  return { directory, manifest: buildManifest({ populationId: 'pop', table: 'trade.x', cutoff: '2026-09-26T04:00:00Z', createdAt: '2026-10-03T00:00:00Z', source: { databaseIdentityHash: 'h'.repeat(64), releaseSha: SHA }, chunks: writer.chunks, completed: true }) };
}

test('archive round trip: chunks verify from disk, rows are returned in order and byte-identical', () => {
  const { directory, manifest } = archiveRows(250, 4_000);
  try {
    assert.ok(manifest.chunks.length > 3, 'small chunk bound produces several chunks');
    assert.equal(manifest.rows, 250);
    const verification = verifyArchiveOnDisk(directory, manifest);
    assert.deepEqual(verification, { ok: true, rows: 250, problems: [] });
    const rows = [...readArchiveRows(directory, manifest)];
    assert.equal(rows.length, 250);
    assert.equal(JSON.parse(rows[17] as string).payload.n, 17);
    for (let index = 1; index < manifest.chunks.length; index += 1) assert.ok((manifest.chunks[index - 1]?.lastKey ?? '') < (manifest.chunks[index]?.firstKey ?? ''), 'chunk key ranges are ordered and disjoint');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('tamper detection: a flipped byte, a missing chunk, a changed count and a forged population digest are all caught', () => {
  const { directory, manifest } = archiveRows(120, 3_000);
  try {
    const first = manifest.chunks[0];
    assert.ok(first);
    const path = join(directory, first.file);
    const original = readFileSync(path);
    const flipped = Buffer.from(original);
    flipped[Math.floor(flipped.length / 2)] = (flipped[Math.floor(flipped.length / 2)] ?? 0) ^ 0xff;
    writeFileSync(path, flipped);
    assert.ok(verifyArchiveOnDisk(directory, manifest).problems.some((problem) => problem.startsWith('FILE_DIGEST')));
    writeFileSync(path, original);
    assert.equal(verifyArchiveOnDisk(directory, manifest).ok, true);
    rmSync(path);
    assert.ok(verifyArchiveOnDisk(directory, manifest).problems.some((problem) => problem.startsWith('CHUNK_MISSING')));
    writeFileSync(path, original);
    assert.ok(verifyArchiveOnDisk(directory, { ...manifest, rows: manifest.rows + 1 }).problems.some((problem) => problem.startsWith('TOTAL_ROWS')));
    assert.ok(verifyArchiveOnDisk(directory, { ...manifest, populationDigest: '0'.repeat(64) }).problems.includes('POPULATION_DIGEST_MISMATCH'));
    const forgedChunk = { ...first, rows: first.rows + 1 };
    assert.ok(!verifyArchiveOnDisk(directory, { ...manifest, chunks: [forgedChunk, ...manifest.chunks.slice(1)] }).ok);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a row containing a newline is refused (it would corrupt the NDJSON framing); resuming from existing chunks continues the numbering', () => {
  const directory = mkdtempSync(join(tmpdir(), 'theta-archive-'));
  try {
    const writer = new ArchiveChunkWriter(directory, 'pop', 1_000);
    assert.throws(() => writer.add({ key: 'k', time: 't', json: '{"a":\n1}' }), /NEWLINE/);
    for (let index = 0; index < 40; index += 1) writer.add({ key: `k${String(index).padStart(3, '0')}`, time: '2026-09-20T00:00:00Z', json: JSON.stringify({ index, pad: 'y'.repeat(60) }) });
    writer.flush();
    const before = writer.chunks.length;
    const resumed = new ArchiveChunkWriter(directory, 'pop', 1_000, writer.chunks);
    resumed.add({ key: 'k999', time: '2026-09-21T00:00:00Z', json: '{"index":999}' });
    const next = resumed.flush();
    assert.equal(resumed.chunks.length, before + 1);
    assert.match(next?.file ?? '', new RegExp(`pop-${String(before + 1).padStart(5, '0')}\\.ndjson\\.gz`));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function evidenceFor(manifest: ArchiveManifest, directory: string, overrides: Partial<PurgeEligibilityEvidence> = {}): PurgeEligibilityEvidence {
  return { population: { id: 'pop', schema: 'trade', table: 'candidate_point_in_time_evidence' }, manifest, diskVerification: verifyArchiveOnDisk(directory, manifest), productionRowCount: manifest.rows,
    sampleRestore: { sampled: 50, matched: 50 }, replayVerified: 'NOT_APPLICABLE', aggregateEqual: true, archiveLocationOutsideDatabase: true, hotWindowRespected: true, ...overrides };
}

test('purge eligibility needs EVERY proof; each missing proof yields its own blocker', () => {
  const { directory, manifest } = archiveRows(30, 2_000);
  try {
    assert.deepEqual(evaluatePurgeEligibility(evidenceFor(manifest, directory)), { eligible: true, blockers: [] });
    const cases: Array<[Partial<PurgeEligibilityEvidence>, string]> = [
      [{ manifest: null }, 'NO_ARCHIVE_MANIFEST'],
      [{ manifest: { ...manifest, completed: false } }, 'ARCHIVE_NOT_COMPLETE'],
      [{ productionRowCount: manifest.rows + 1 }, 'ROW_COUNT_PROOF_MISSING_OR_DIFFERENT'],
      [{ productionRowCount: null }, 'ROW_COUNT_PROOF_MISSING_OR_DIFFERENT'],
      [{ diskVerification: null }, 'ARCHIVE_NOT_VERIFIED_ON_DISK'],
      [{ diskVerification: { ok: false, rows: 0, problems: ['x'] } }, 'ARCHIVE_NOT_VERIFIED_ON_DISK'],
      [{ sampleRestore: null }, 'RESTORE_SAMPLE_NOT_PROVEN'],
      [{ sampleRestore: { sampled: 0, matched: 0 } }, 'RESTORE_SAMPLE_NOT_PROVEN'],
      [{ sampleRestore: { sampled: 50, matched: 49 } }, 'RESTORE_SAMPLE_NOT_PROVEN'],
      [{ replayVerified: false }, 'REPLAY_NOT_VERIFIED'],
      [{ aggregateEqual: false }, 'RESEARCH_AGGREGATE_NOT_EQUAL'],
      [{ archiveLocationOutsideDatabase: false }, 'ARCHIVE_LOCATION_NOT_OUTSIDE_DATABASE'],
      [{ hotWindowRespected: false }, 'HOT_WINDOW_NOT_RESPECTED'],
      [{ manifest: { ...manifest, source: { ...manifest.source, releaseSha: 'short' } } }, 'NO_SOURCE_RELEASE_IDENTITY'],
    ];
    for (const [override, blocker] of cases) {
      const result = evaluatePurgeEligibility(evidenceFor(manifest, directory, override));
      assert.equal(result.eligible, false, blocker);
      assert.ok(result.blockers.includes(blocker), `${blocker} in ${result.blockers.join(',')}`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('operational truth is never purge-eligible even with a perfect archive', () => {
  const { directory, manifest } = archiveRows(10, 2_000);
  try {
    const operational = ['trade.order_intent', 'trade.broker_order', 'trade.fill', 'trade.execution_attempt', 'trade.master_paper_action_plan', 'trade.master_paper_action_plan_event', 'trade.stock_lot',
      'trade.broker_reconciliation_snapshot', 'trade.broker_activity_fact', 'trade.wheel_chain', 'ops.runtime_worker_cycle', 'ops.scheduler_checkpoint', 'risk.aegis_iv_stress_assessment', 'core.schema_migration', 'copy.alpaca_oauth_token'];
    for (const name of operational) {
      const [schema, table] = name.split('.') as [string, string];
      assert.equal(isOperationalRelation(schema, table), true, name);
      const result = evaluatePurgeEligibility(evidenceFor(manifest, directory, { population: { id: 'x', schema, table } }));
      assert.equal(result.eligible, false);
      assert.ok(result.blockers.includes('OPERATIONAL_TRUTH_NEVER_PURGEABLE'), name);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('archive location must be inside the external archive root, never an arbitrary path', () => {
  assert.equal(isOutsideDatabaseArchiveRoot('C:\\ProjectBackups\\trading-bots\\storage-archives\\x\\pop', 'C:\\ProjectBackups\\trading-bots\\storage-archives'), true);
  assert.equal(isOutsideDatabaseArchiveRoot('C:\\ProjectBackups\\trading-bots\\storage-archives-evil\\pop', 'C:\\ProjectBackups\\trading-bots\\storage-archives'), false);
  assert.equal(isOutsideDatabaseArchiveRoot('C:\\Windows\\Temp\\pop', 'C:\\ProjectBackups\\trading-bots\\storage-archives'), false);
});

test('the candidate populations are all Tier C/D, none is operational, each is bounded by the cutoff parameter, and FK-referenced tables never DELETE rows', () => {
  assert.equal(new Set(archivePopulations.map((population) => population.id)).size, archivePopulations.length);
  for (const population of archivePopulations) {
    assert.equal(isOperationalRelation(population.schema, population.table), false, population.id);
    assert.match(population.tier, /^TIER_[CD]_/);
    assert.ok(population.where.includes('$1'), `${population.id} must be bounded by the cutoff`);
    assert.match(population.keyColumn, /_id$/);
    assert.ok(population.pageRows >= 1 && population.pageRows <= 2000);
  }
  const replaceOnly = ['legacy-fusion-snapshot-payload', 'legacy-optionomics-feature-snapshot', 'legacy-option-chain-decision-evidence', 'legacy-optionomics-raw-observation'];
  for (const id of replaceOnly) assert.equal(archivePopulations.find((population) => population.id === id)?.purgeAction, 'REPLACE_PAYLOAD_WITH_ARCHIVE_POINTER', id);
});

test('the archive tooling contains NO destructive SQL: no DELETE/UPDATE/INSERT/DROP/TRUNCATE/ALTER/VACUUM statement can be issued by it', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  for (const file of ['tools/theta-storage-archive.ts', 'tools/theta-storage-forensics.ts', 'tools/theta-storage-amplification.ts', 'tools/storage/storage-archive-lib.ts', 'tools/storage/storage-populations.ts']) {
    const code = strip(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    assert.doesNotMatch(code, /\b(DELETE\s+FROM|UPDATE\s+[\w."]+\s+SET|INSERT\s+INTO|DROP\s+(TABLE|INDEX|SCHEMA|DATABASE|TRIGGER)|TRUNCATE|ALTER\s+(TABLE|DATABASE)|VACUUM|CREATE\s+(TABLE|INDEX|EXTENSION))\b/i, file);
  }
  const cli = strip(readFileSync(new URL('../tools/theta-storage-archive.ts', import.meta.url), 'utf8'));
  assert.ok(cli.includes("'BEGIN READ ONLY'"), 'every database read runs in a READ ONLY transaction');
  assert.ok(!/pool\.query\(/.test(cli), 'no un-transacted pool query');
});

// ---- budget v2 ----------------------------------------------------------------------------------------------------------------------------------

test('measured 2026-10-03 state: 4.66 GiB, about 250 MiB per session, over the hard budget and about 13 sessions from the 8 GiB plan limit => RESEARCH_DIVERT, operational writes untouched', () => {
  const assessment = assessStorageBudgetV2({ currentBytes: 4.664 * GIB, growthBytesPerSession: 250 * 1024 ** 2, archivableBytes: 2.6 * GIB,
    growthMibByClass: { operationalTruth: 5, research: 245, archivableHistory: 0 } });
  assert.equal(assessment.actionState, 'RESEARCH_DIVERT');
  assert.equal(assessment.sessionsToHard, 0);
  assert.ok(assessment.sessionsToProviderLimit !== null && assessment.sessionsToProviderLimit > 12 && assessment.sessionsToProviderLimit < 15);
  assert.equal(assessment.growthKind, 'RESEARCH');
  assert.ok(Math.abs(assessment.nonArchivableBytes - (4.664 - 2.6) * GIB) < 1024);
  for (const writeClass of OPERATIONAL_WRITE_CLASSES) assert.equal(assessment.writePolicy[writeClass], 'ALLOW', writeClass);
  assert.equal(assessment.writePolicy.CYCLE_ARCHIVE_BLOBS, 'DIVERT_TO_LOCAL_ARCHIVE');
  assert.equal(assessment.writePolicy.CURRENT_RUNTIME_EVIDENCE, 'ALLOW');
});

test('PROPERTY: operational write classes are ALLOW in every state, for every size and growth on a dense grid', () => {
  const states = new Set<StorageActionState>();
  for (let size = 0.5; size <= 7.9; size += 0.1) {
    for (const growthMib of [null, -5, 0, 1, 50, 250, 800, 4000]) {
      const assessment = assessStorageBudgetV2({ currentBytes: size * GIB, growthBytesPerSession: growthMib === null ? null : growthMib * 1024 ** 2, archivableBytes: 0 });
      states.add(assessment.actionState);
      for (const writeClass of OPERATIONAL_WRITE_CLASSES) assert.equal(assessment.writePolicy[writeClass], 'ALLOW', `${size} ${growthMib} ${writeClass}`);
    }
  }
  assert.deepEqual([...states].sort(), ['ARCHIVE_RECOMMENDED', 'NORMAL', 'PROVIDER_EMERGENCY', 'RESEARCH_DIVERT', 'WATCH']);
  for (const state of states) for (const writeClass of OPERATIONAL_WRITE_CLASSES) assert.equal(writePolicyFor(state)[writeClass], 'ALLOW');
  assert.equal(writePolicyFor('PROVIDER_EMERGENCY').RAW_PROVIDER_PAYLOADS, 'PAUSE');
  assert.equal(writePolicyFor('NORMAL').RESEARCH_HISTORY, 'ALLOW');
  assert.deepEqual([...RESEARCH_WRITE_CLASSES].filter((name) => (OPERATIONAL_WRITE_CLASSES as readonly string[]).includes(name)), []);
});

test('PROPERTY: more growth or more size can never make the action state less severe; projections are exact and unknown growth stays unknown (never zero)', () => {
  const order: StorageActionState[] = ['NORMAL', 'WATCH', 'ARCHIVE_RECOMMENDED', 'RESEARCH_DIVERT', 'PROVIDER_EMERGENCY'];
  const rank = (state: StorageActionState): number => order.indexOf(state);
  for (let size = 1; size <= 7.5; size += 0.25) {
    let previous = -1;
    for (const growthMib of [1, 10, 50, 100, 250, 500, 1000, 2000]) {
      const current = rank(assessStorageBudgetV2({ currentBytes: size * GIB, growthBytesPerSession: growthMib * 1024 ** 2, archivableBytes: 0 }).actionState);
      assert.ok(current >= previous, `growth monotone at ${size} GiB`);
      previous = current;
    }
  }
  for (const growthMib of [10, 250, 1000]) {
    let previous = -1;
    for (let size = 1; size <= 7.5; size += 0.25) {
      const current = rank(assessStorageBudgetV2({ currentBytes: size * GIB, growthBytesPerSession: growthMib * 1024 ** 2, archivableBytes: 0 }).actionState);
      assert.ok(current >= previous, `size monotone at ${growthMib} MiB`);
      previous = current;
    }
  }
  const exact = assessStorageBudgetV2({ currentBytes: 2 * GIB, growthBytesPerSession: 100 * 1024 ** 2, archivableBytes: 0 });
  assert.equal(exact.sessionsToHard, (4 * GIB - 2 * GIB) / (100 * 1024 ** 2));
  const unknown = assessStorageBudgetV2({ currentBytes: 2 * GIB, growthBytesPerSession: null, archivableBytes: 0 });
  assert.equal(unknown.sessionsToSoft, null);
  assert.equal(unknown.growthKind, 'UNKNOWN');
  assert.equal(assessStorageBudgetV2({ currentBytes: 2 * GIB, growthBytesPerSession: 0, archivableBytes: 0 }).growthKind, 'NONE');
  assert.equal(assessStorageBudgetV2({ currentBytes: 2 * GIB, growthBytesPerSession: 10, archivableBytes: 0, duplicationRatio: 12 }).growthKind, 'PATHOLOGICAL_DUPLICATION');
});

test('invalid budget inputs and an inconsistent policy are rejected', () => {
  assert.throws(() => assessStorageBudgetV2({ currentBytes: -1, growthBytesPerSession: 1, archivableBytes: 0 }), /INVALID_STORAGE_BUDGET_INPUT/);
  assert.throws(() => assessStorageBudgetV2({ currentBytes: Number.NaN, growthBytesPerSession: 1, archivableBytes: 0 }), /INVALID_STORAGE_BUDGET_INPUT/);
  assert.throws(() => assessStorageBudgetV2({ currentBytes: GIB, growthBytesPerSession: 1, archivableBytes: 2 * GIB }), /INVALID_STORAGE_BUDGET_INPUT/);
  assert.throws(() => assessStorageBudgetV2({ currentBytes: GIB, growthBytesPerSession: 1, archivableBytes: 0 }, { ...thetaStorageBudgetV2, internalHardBytes: GIB }), /INVALID_STORAGE_BUDGET_POLICY/);
});
