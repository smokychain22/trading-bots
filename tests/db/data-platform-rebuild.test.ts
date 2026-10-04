// The governed rebuild/swap that physically reclaims space from an archived legacy slice, proven on a disposable PostgreSQL with a table shaped like trade.candidate_point_in_time_evidence
// (primary key, check constraint, outbound foreign key, immutability trigger, index). Skipped unless THETA_DATA_PLATFORM_DATABASE_URL is set. NEVER pointed at Production by this test.
import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { RebuildRefused, dropRetiredTable, executeRebuild, planRebuild } from '../../src/storage/data-platform/legacy-rebuild.js';

const url = process.env.THETA_DATA_PLATFORM_DATABASE_URL;
const skip = url === undefined;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const spec = { schema: 'legacy_probe', table: 'evidence', retainPredicate: `decision_time >= '2026-09-26T04:00:00Z'`, expectedRetainedRows: 400 };

async function build(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query('DROP SCHEMA IF EXISTS legacy_probe CASCADE'); await pool.query('CREATE SCHEMA legacy_probe');
  await pool.query(`CREATE TABLE legacy_probe.parents (parent_id uuid PRIMARY KEY)`);
  await pool.query(`CREATE TABLE legacy_probe.evidence (candidate_id uuid PRIMARY KEY, parent_id uuid NOT NULL REFERENCES legacy_probe.parents(parent_id), decision_time timestamptz NOT NULL,
    hard_status text NOT NULL CHECK (hard_status IN ('FEASIBLE','HARD_VETO')), payload_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query('CREATE INDEX ix_evidence_time ON legacy_probe.evidence (decision_time, candidate_id)');
  await pool.query(`CREATE FUNCTION legacy_probe.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_EVIDENCE'; END $$`);
  await pool.query('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_probe.evidence FOR EACH ROW EXECUTE FUNCTION legacy_probe.reject_mutation()');
  await pool.query(`INSERT INTO legacy_probe.parents VALUES ($1)`, [uuid(1)]);
  // 4,000 archived-age rows with ~6 KiB of incompressible payload each, 400 retained rows
  await pool.query(`INSERT INTO legacy_probe.evidence(candidate_id, parent_id, decision_time, hard_status, payload_json)
    SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, $1, CASE WHEN g <= 4000 THEN timestamptz '2026-09-20 15:00+00' + g * interval '1 second' ELSE timestamptz '2026-09-30 15:00+00' + g * interval '1 second' END,
      CASE WHEN g % 2 = 0 THEN 'FEASIBLE' ELSE 'HARD_VETO' END, jsonb_build_object('n', g, 'blob', encode(gen_random_bytes(1024), 'hex') || encode(gen_random_bytes(1024), 'hex') || encode(gen_random_bytes(1024), 'hex'))
    FROM generate_series(1, 4400) g`, [uuid(1)]);
}
const size = async (pool: pg.Pool, relation: string): Promise<number> => Number((await pool.query('SELECT COALESCE(pg_total_relation_size(to_regclass($1)), 0)::bigint AS n', [relation])).rows[0].n);

test('REBUILD/SWAP: the retained rows survive byte-identically, constraints, index, foreign key and the immutability trigger are preserved, and dropping the retired table returns the space at once', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await build(pool);
    const before = await size(pool, 'legacy_probe.evidence');
    assert.ok(before > 20 * 1024 ** 2, `fixture is large enough to measure (${before})`);
    const retainedDigest = (await pool.query(`SELECT md5(string_agg(candidate_id::text || payload_json::text, ',' ORDER BY candidate_id)) AS d FROM legacy_probe.evidence WHERE decision_time >= '2026-09-26T04:00:00Z'`)).rows[0].d as string;

    const plan = await planRebuild(pool, spec);
    assert.deepEqual(plan.refused, []); assert.equal(plan.retainedRows, 400); assert.equal(plan.totalRows, 4400);
    assert.ok(plan.steps.some((step) => /LOCK TABLE legacy_probe\.evidence IN ACCESS EXCLUSIVE MODE/.test(step)) && plan.steps.at(-1)?.includes('DROP TABLE'), 'the plan shows the exact SQL, ending in the separately approved drop');
    assert.equal(plan.triggers.length, 1); assert.equal(plan.foreignKeys.length, 1);

    // an expected-count mismatch aborts and rolls back: the original table is untouched
    await assert.rejects(executeRebuild(pool, { ...spec, expectedRetainedRows: 399 }), /REBUILD_ROW_COUNT_MISMATCH/);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM legacy_probe.evidence')).rows[0].n), 4400);
    assert.equal(await size(pool, 'legacy_probe.evidence_rebuild_new'), 0, 'no half-built table survives a failed rebuild');

    const swapped = await executeRebuild(pool, spec);
    assert.equal(swapped.retained, 400);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM legacy_probe.evidence')).rows[0].n), 400);
    assert.equal((await pool.query(`SELECT md5(string_agg(candidate_id::text || payload_json::text, ',' ORDER BY candidate_id)) AS d FROM legacy_probe.evidence`)).rows[0].d, retainedDigest, 'retained rows are identical');
    // everything the table promised is still true
    await assert.rejects(pool.query(`DELETE FROM legacy_probe.evidence WHERE candidate_id = $1`, [uuid(4401 - 1)]), /IMMUTABLE_EVIDENCE/);
    await assert.rejects(pool.query(`INSERT INTO legacy_probe.evidence(candidate_id, parent_id, decision_time, hard_status, payload_json) VALUES ($1, $2, now(), 'FEASIBLE', '{}')`, [uuid(9001), uuid(2)]), /foreign key/i);
    await assert.rejects(pool.query(`INSERT INTO legacy_probe.evidence(candidate_id, parent_id, decision_time, hard_status, payload_json) VALUES ($1, $2, now(), 'BOGUS', '{}')`, [uuid(9002), uuid(1)]), /check constraint/i);
    assert.equal(Number((await pool.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'legacy_probe' AND tablename = 'evidence' AND indexname IN ('ix_evidence_time', 'evidence_pkey')`)).rows[0].n), 2, 'the canonical index and primary key names are on the new table');
    assert.ok(await size(pool, 'legacy_probe.evidence_retired_old') >= before * 0.9, 'the old table still exists (renamed): the swap is reversible until the drop');

    // the irreversible step needs the approval token and the verification proof
    await assert.rejects(dropRetiredTable(pool, spec, { token: 'short', expectedToken: 'a-sufficiently-long-token', archiveVerifiedAt: '2026-10-03T00:00:00Z' }), /PURGE_APPROVAL_TOKEN_REQUIRED/);
    await assert.rejects(dropRetiredTable(pool, spec, { token: 'a-sufficiently-long-token', expectedToken: 'a-sufficiently-long-token', archiveVerifiedAt: null }), /ARCHIVE_VERIFICATION_PROOF_REQUIRED/);
    const dbBefore = Number((await pool.query('SELECT pg_database_size(current_database())::bigint AS n')).rows[0].n);
    const dropped = await dropRetiredTable(pool, spec, { token: 'a-sufficiently-long-token', expectedToken: 'a-sufficiently-long-token', archiveVerifiedAt: '2026-10-03T00:00:00Z' });
    const dbAfter = Number((await pool.query('SELECT pg_database_size(current_database())::bigint AS n')).rows[0].n);
    assert.ok(dropped.reclaimedBytes >= before * 0.9);
    assert.ok(dbBefore - dbAfter >= before * 0.8, `database shrank immediately (${dbBefore - dbAfter} bytes), unlike DELETE + VACUUM`);
    assert.ok(await size(pool, 'legacy_probe.evidence') < before * 0.2, 'the live table holds only the retained rows');
  } finally { await pool.query('DROP SCHEMA IF EXISTS legacy_probe CASCADE').catch(() => undefined); await pool.end(); }
});

test('REBUILD/SWAP is REFUSED for a table with inbound foreign keys or a dependent materialized view (the rename would leave them on the old table); plain dependent views are re-pointed', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await build(pool);
    await pool.query('CREATE TABLE legacy_probe.child (id uuid PRIMARY KEY, candidate_id uuid REFERENCES legacy_probe.evidence(candidate_id))');
    await assert.rejects(executeRebuild(pool, spec), (error: unknown) => error instanceof RebuildRefused && error.reasons.some((reason) => reason.startsWith('INBOUND_FOREIGN_KEYS')));
    await pool.query('DROP TABLE legacy_probe.child'); await pool.query('CREATE MATERIALIZED VIEW legacy_probe.mv AS SELECT candidate_id FROM legacy_probe.evidence');
    await assert.rejects(executeRebuild(pool, spec), (error: unknown) => error instanceof RebuildRefused && error.reasons.some((reason) => reason.startsWith('DEPENDENT_NON_PLAIN_VIEWS')));
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM legacy_probe.evidence')).rows[0].n), 4400, 'a refused rebuild changes nothing');
    await pool.query('DROP MATERIALIZED VIEW legacy_probe.mv');

    // a plain view (production has research.option_contract_risk_history over the PIT table) follows the table by OID: it must be re-pointed so it sees the NEW table and the old one can be dropped
    await pool.query(`CREATE VIEW legacy_probe.risk_history AS SELECT e.candidate_id, e.decision_time, e.payload_json->>'n' AS n FROM legacy_probe.evidence e`);
    const plan = await planRebuild(pool, spec);
    assert.deepEqual(plan.refused, []); assert.equal(plan.dependentViews.length, 1);
    assert.ok(plan.steps.some((step) => /CREATE OR REPLACE VIEW legacy_probe\.risk_history/.test(step)));
    await executeRebuild(pool, spec);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM legacy_probe.risk_history')).rows[0].n), 400, 'the view reads the rebuilt table');
    await pool.query(`INSERT INTO legacy_probe.evidence(candidate_id, parent_id, decision_time, hard_status, payload_json) VALUES ($1, $2, '2026-10-01T00:00:00Z', 'FEASIBLE', '{"n": 9}')`, [uuid(9500), uuid(1)]);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM legacy_probe.risk_history')).rows[0].n), 401, 'a NEW row written after the swap is visible through the view');
    await dropRetiredTable(pool, spec, { token: 'a-sufficiently-long-token', expectedToken: 'a-sufficiently-long-token', archiveVerifiedAt: '2026-10-03T00:00:00Z' });
  } finally { await pool.query('DROP SCHEMA IF EXISTS legacy_probe CASCADE').catch(() => undefined); await pool.end(); }
});
