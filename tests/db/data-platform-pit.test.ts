// The REAL cycle store writing point-in-time evidence through every rollout mode on a production-schema PostgreSQL (migrations 001-068 + draft 069), proving the rebuilt rows equal the legacy rows.
// Skipped unless THETA_DATA_PLATFORM_FULL_DATABASE_URL points at a disposable local database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { PostgresThetaCycleStore } from '../../src/theta/postgres-theta-cycle-store.js';
import { PIT_DATASET, checkParity, cutoverToNormalized, effectivePitMode, evaluateDualWriteExit, readLedger, rollbackToLegacy, startDualWrite, type PitWriterConfig, type PitWriterEvent } from '../../src/storage/data-platform/pit-writer.js';
import { StaticPressureProvider, interpretPressureRow, unknownPressure } from '../../src/storage/data-platform/pressure-state.js';
import { buildCycle, persistenceContext, seedWorld } from '../helpers/theta-cycle-fixture.js';

const url = process.env.THETA_DATA_PLATFORM_FULL_DATABASE_URL;
const skip = url === undefined;
const small = { minimumDecisions: 1, minimumRows: 1 };

async function applyDraft(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
  await pool.query(readFileSync(new URL('../../docs/proposals/DP1_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
}
const count = async (pool: pg.Pool, sql: string, values: unknown[] = []): Promise<number> => Number((await pool.query(sql, values)).rows[0].n);

test('REAL STORE: OFF, SHADOW, DUAL_WRITE_VALIDATE and AUTHORITATIVE write point-in-time evidence; the rebuilt rows equal the legacy rows; the ledger bounds the protocol', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await applyDraft(pool);
    const world = await seedWorld(pool, '2026-09-11T14:59:00.000Z');
    const context = persistenceContext(world);
    const events: PitWriterEvent[] = [];
    const store = (config: PitWriterConfig | undefined) => new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: true, ...(config === undefined ? {} : { pitWriter: { ...config, onEvent: (event: PitWriterEvent) => events.push(event) } }) });
    const decisionAt = (minute: number): string => `2026-09-11T15:${String(minute).padStart(2, '0')}:00.000Z`;

    // OFF: legacy only
    const off = await store({ mode: 'OFF' }).persist(context, buildCycle(40, decisionAt(1)));
    const legacyOff = await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [off.fusionSnapshotId]);
    assert.ok(legacyOff > 5, `the store must write many point-in-time rows (got ${legacyOff})`);
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.pit_candidate'), 0);

    // SHADOW: legacy written, normalized measured in memory, still no dp rows
    events.length = 0;
    await store({ mode: 'SHADOW' }).persist(context, buildCycle(40, decisionAt(2)));
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.pit_candidate'), 0);
    const shadow = events.find((event) => event.kind === 'SHADOW_MEASURED');
    assert.ok(shadow !== undefined && shadow.kind === 'SHADOW_MEASURED' && shadow.roundTripExact, 'the shadow rebuild must be exact');
    assert.ok(shadow.normalizedBytes < shadow.originalBytes / 3, 'the shared context is stored once');

    // DUAL_WRITE_VALIDATE without a ledger degrades to the legacy writer (never to a half state)
    events.length = 0;
    await store({ mode: 'DUAL_WRITE_VALIDATE' }).persist(context, buildCycle(40, decisionAt(3)));
    assert.ok(events.some((event) => event.kind === 'MODE_DEGRADED' && event.reason === 'LEDGER_ABSENT'));
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.pit_candidate'), 0);

    // an authoritative request before cutover can not skip the legacy writer
    await startDualWrite(pool, 14, new Date('2026-09-11T15:00:00Z'));
    events.length = 0;
    const early = await store({ mode: 'AUTHORITATIVE', now: () => new Date('2026-09-12T00:00:00Z') }).persist(context, buildCycle(40, decisionAt(4)));
    assert.ok(events.some((event) => event.kind === 'MODE_DEGRADED' && event.reason === 'CUTOVER_NOT_RECORDED'));
    assert.ok(await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [early.fusionSnapshotId]) > 0, 'legacy rows exist');

    // DUAL_WRITE_VALIDATE with a ledger: both homes written in one transaction and compared by the database
    const dual = await store({ mode: 'DUAL_WRITE_VALIDATE', now: () => new Date('2026-09-12T00:00:00Z') }).persist(context, buildCycle(300, decisionAt(5)));
    const legacyRows = await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [dual.fusionSnapshotId]);
    const normalizedRows = await count(pool, 'SELECT count(*)::int AS n FROM dp.pit_candidate WHERE fusion_snapshot_id = $1', [dual.fusionSnapshotId]);
    assert.equal(normalizedRows, legacyRows);
    const ids = (await pool.query('SELECT candidate_id FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [dual.fusionSnapshotId])).rows.map((row) => row.candidate_id as string);
    const parity = await checkParity(pool, ids);
    assert.deepEqual([parity.legacyRows, parity.rebuiltRows, parity.differingRows, parity.mismatches], [legacyRows, legacyRows, 0, 0]);
    const ledger = await readLedger(pool);
    assert.ok(ledger !== null && ledger.parityDecisions >= 1 && ledger.parityRows >= legacyRows && ledger.mismatchCount === 0);
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.decision_context WHERE fusion_snapshot_id = $1', [dual.fusionSnapshotId]), 1, 'ONE shared context per decision');
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM dp.rejection_histogram'), 2, 'one histogram per dual-written decision (the unrecorded-cutover request fell back to dual write)');

    // an exact exit evaluation refuses while the sweep is empty of mismatches but criteria are not met, and accepts when they are
    const refused = await evaluateDualWriteExit(pool, { minimumDecisions: 10_000, minimumRows: 10_000 });
    assert.equal(refused.ok, false); assert.ok(refused.failures.some((failure) => failure.startsWith('PARITY_DECISIONS_BELOW_MINIMUM')));
    const cut = await cutoverToNormalized(pool, small);
    assert.equal(cut.cutover, true, JSON.stringify(cut.evaluation.failures));
    assert.deepEqual([cut.evaluation.sweep.differingRows, cut.evaluation.sweep.idMismatch, cut.evaluation.sweep.duplicateRows], [0, 0, 0]);
    const afterCut = await readLedger(pool);
    assert.ok(afterCut !== null && afterCut.mode === 'AUTHORITATIVE' && afterCut.cutoverAt !== null && afterCut.legacyWriterDisabled);

    // AUTHORITATIVE: the large legacy writer is disabled, the view serves the rows
    const before = await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence');
    const auth = await store({ mode: 'AUTHORITATIVE', now: () => new Date('2026-09-12T00:00:00Z') }).persist(context, buildCycle(300, decisionAt(6)));
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence'), before, 'the legacy table receives nothing');
    const viaView = await count(pool, 'SELECT count(*)::int AS n FROM dp.candidate_point_in_time_evidence_v WHERE fusion_snapshot_id = $1', [auth.fusionSnapshotId]);
    assert.equal(viaView, legacyRows);
    const sample = (await pool.query('SELECT volatility_json, market_json FROM dp.candidate_point_in_time_evidence_v WHERE fusion_snapshot_id = $1 LIMIT 1', [auth.fusionSnapshotId])).rows[0];
    assert.equal(sample.volatility_json.ivSource, 'ALPACA'); assert.equal(sample.market_json.underlyingQuoteSource, 'ALPACA_IEX');

    // a mismatch recorded in the ledger blocks AUTHORITATIVE even if cutover was recorded earlier (the CHECK constraint refuses the impossible row)
    await assert.rejects(pool.query(`UPDATE dp.dual_write_ledger SET mismatch_count = 3 WHERE dataset = $1`, [PIT_DATASET]), /violates check constraint/);
    await rollbackToLegacy(pool);
    assert.equal(effectivePitMode('AUTHORITATIVE', await readLedger(pool), new Date('2026-09-12T00:00:00Z')).mode, 'OFF');
  } finally { await pool.end(); }
});

test('REAL STORE: the pressure gate drops only bulk research rows, never selected evidence, and an unknown pressure state is conservative', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await applyDraft(pool);
    const world = await seedWorld(pool, '2026-09-11T14:59:00.000Z');
    const context = persistenceContext(world);
    const events: PitWriterEvent[] = [];
    const decisionsBefore = await count(pool, 'SELECT count(*)::int AS n FROM trade.decision');
    const now = new Date('2026-09-12T00:00:00Z');
    const row = (band: string, used: number) => ({ band, database_bytes: Math.round(used * 8 * 1024 ** 3), plan_bytes: 8 * 1024 ** 3, archive_queue_bytes: 0, archive_lag_sessions: 0, archive_backend_healthy: true, projected_sessions_to_critical: 40, evaluated_at: now.toISOString() });
    const run = async (pressure: StaticPressureProvider, minute: number) => {
      events.length = 0;
      const store = new PostgresThetaCycleStore(pool, { persistRelationalCandidateEvidence: true, pitWriter: { mode: 'OFF', pressure, now: () => now, onEvent: (event) => events.push(event) } });
      const persisted = await store.persist(context, buildCycle(60, `2026-09-11T16:${String(minute).padStart(2, '0')}:00.000Z`));
      return count(pool, 'SELECT count(*)::int AS n FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [persisted.fusionSnapshotId]);
    };
    const normal = await run(new StaticPressureProvider(interpretPressureRow(row('NORMAL', 0.2), now)), 1);
    assert.ok(normal > 10);
    assert.equal(events.filter((event) => event.kind === 'EVIDENCE_QUEUED_FOR_ARCHIVE_ONLY').length, 0);
    const critical = await run(new StaticPressureProvider(interpretPressureRow(row('STORAGE_CRITICAL', 0.9), now)), 2);
    assert.ok(critical < normal, 'bulk research rows are queued for the archive only');
    assert.ok(events.some((event) => event.kind === 'EVIDENCE_QUEUED_FOR_ARCHIVE_ONLY' && event.scope === 'pit-candidate-research'));
    const unknown = await run(new StaticPressureProvider(unknownPressure('MISSING', null)), 3);
    assert.ok(unknown < normal, 'unknown pressure never assumes unlimited capacity');
    // the decision itself (operational truth) is always persisted
    assert.equal(await count(pool, 'SELECT count(*)::int AS n FROM trade.decision') - decisionsBefore, 3);
  } finally { await pool.end(); }
});
