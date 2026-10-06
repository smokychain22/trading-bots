// REAL PostgreSQL: the SQL reconstruction view returns exactly the rows the legacy writer would have stored, for random decisions that include a single candidate, many candidates, empty
// objects, missing children, nulls, arrays, a large shared volatility surface, provider provenance and account/portfolio context, and a 2,619-candidate decision. Compact (tiered) rows keep
// their identity, reason and hash. The comparison is the database's own jsonb equality (the same one the dual-write ledger uses). Skipped unless THETA_DATA_PLATFORM_DATABASE_URL is set.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { PIT_ARRAY_COLUMNS, PIT_JSON_COLUMNS, PIT_OBJECT_COLUMNS, type PitEvidenceRow } from '../../src/storage/data-platform/pit-storage.js';
import { planPitWrite, writePlan } from '../../src/storage/data-platform/pit-writer.js';

const url = process.env.THETA_DATA_PLATFORM_DATABASE_URL;
const skip = url === undefined;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function mulberry32(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

let counter = 0;
function decision(seed: number, candidates: number, options: { readonly surfaceKiB?: number; readonly perturb?: boolean } = {}): { readonly fusion: string; readonly decisionId: string; readonly rows: PitEvidenceRow[] } {
  const rand = mulberry32(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const fusion = uuid(1_000_000 + seed); const decisionId = uuid(2_000_000 + seed);
  const surface = Array.from({ length: Math.ceil(((options.surfaceKiB ?? 4) * 1024) / 90) }, (_, index) => ({ strike: 300 + index, iv: Number((0.1 + rand() * 0.4).toFixed(4)), source: 'OPTIONOMICS' }));
  const shared: Record<string, Record<string, unknown>> = {};
  for (const column of PIT_OBJECT_COLUMNS) {
    shared[column] = {};
    const children = Math.floor(rand() * 5);
    for (let index = 0; index < children; index += 1) shared[column][`k${index}`] = pick([rand(), 'text-' + 'x'.repeat(60), null, true, { nested: [1, 2, { a: rand() }], pad: 'y'.repeat(70) }, [], {}]);
  }
  shared.volatility_json = { ...shared.volatility_json, surface, providerMetrics: { ivRank: 0.4, items: surface.slice(0, 5) } };
  shared.account_json = { ...shared.account_json, equity: 100000, positions: [] };
  shared.portfolio_json = { ...shared.portfolio_json, exposure: { delta: 0, notional: 0 } };
  const provenance = [{ source: 'ALPACA', operationAlias: 'quotes', asOf: null }, { source: 'OPTIONOMICS', operationAlias: 'chain', asOf: '2026-09-11T14:59:00Z' }];
  const rows = Array.from({ length: candidates }, (_, index) => {
    const row: Record<string, unknown> = {};
    const id = counter += 1;
    Object.assign(row, { candidate_id: uuid(3_000_000 + id), decision_id: decisionId, fusion_snapshot_id: fusion, decision_time: '2026-09-11T15:00:00.000Z', branch: 'THETA_CONVENTIONAL', rank_at_decision: index + 1, selected: index === 0,
      hard_status: index % 3 === 0 ? 'FEASIBLE' : 'HARD_VETO', soft_status: 'RANKED', rejection_reason: index % 5 === 0 ? null : 'EDGE_UNKNOWN', strategy_version: 's1', risk_version: 'r1', feature_version: 'f1', cost_model_version: 'c1', regime_version: 'g1', execution_model_version: 'e1',
      content_hash: String(id).padStart(64, 'a').slice(-64) });
    for (const column of PIT_OBJECT_COLUMNS) {
      const own: Record<string, unknown> = { ...shared[column] };
      if (options.perturb !== false && rand() < 0.4) own[`own${Math.floor(rand() * 3)}`] = pick([rand(), 'x', null, [], {}]);
      if (options.perturb !== false && rand() < 0.15) delete own.k0;
      if (column === 'contract_json') Object.assign(own, { contractSymbol: `SPY261009P${String(index).padStart(8, '0')}`, strike: 400 + index });
      row[column] = own;
    }
    for (const column of PIT_ARRAY_COLUMNS) row[column] = column === 'provider_provenance_json' ? provenance : rand() < 0.2 ? [{ own: index }] : [];
    return row as PitEvidenceRow;
  });
  return { fusion, decisionId, rows };
}

async function prepare(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
  await pool.query(readFileSync(new URL('../../docs/proposals/DP1_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
  await pool.query('DROP TABLE IF EXISTS public.pit_probe');
  await pool.query(`CREATE TABLE public.pit_probe (candidate_id uuid PRIMARY KEY, ${PIT_JSON_COLUMNS.map((column) => `${column} jsonb NOT NULL`).join(', ')}, hard_status text, soft_status text, selected boolean, rank_at_decision int, rejection_reason text, content_hash char(64))`);
}

async function load(pool: pg.Pool, input: ReturnType<typeof decision>, compact: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writePlan(client, planPitWrite(input.fusion, input.rows, { compactOrdinaryRejected: compact }), { fusionSnapshotId: input.fusion, decisionTimeUtc: '2026-09-11T15:00:00.000Z', sessionDate: '2026-09-11', decisionId: input.decisionId });
    // the legacy-shaped probe is inserted in pages: a single 2,619-row jsonb array of the legacy layout exceeds PostgreSQL's 256 MiB limit (that is why the legacy relational writer fails on large chains)
    for (let offset = 0; offset < input.rows.length; offset += 100) {
      await client.query(`INSERT INTO public.pit_probe(candidate_id, ${PIT_JSON_COLUMNS.join(', ')}, hard_status, soft_status, selected, rank_at_decision, rejection_reason, content_hash)
        SELECT x.candidate_id::uuid, ${PIT_JSON_COLUMNS.map((column) => `x.${column}`).join(', ')}, x.hard_status, x.soft_status, x.selected, x.rank_at_decision, x.rejection_reason, x.content_hash
        FROM jsonb_to_recordset($1::jsonb) AS x(candidate_id text, ${PIT_JSON_COLUMNS.map((column) => `${column} jsonb`).join(', ')}, hard_status text, soft_status text, selected boolean, rank_at_decision int, rejection_reason text, content_hash char(64))`, [JSON.stringify(input.rows.slice(offset, offset + 100))]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

const compare = `SELECT count(*)::int AS compared, count(*) FILTER (WHERE ${PIT_JSON_COLUMNS.map((column) => `v.${column} IS DISTINCT FROM p.${column}`).join(' OR ')} OR v.hard_status <> p.hard_status OR v.soft_status <> p.soft_status OR v.selected <> p.selected OR v.rank_at_decision IS DISTINCT FROM p.rank_at_decision OR v.rejection_reason IS DISTINCT FROM p.rejection_reason OR v.content_hash <> p.content_hash)::int AS differing,
  count(*) FILTER (WHERE v.candidate_id IS NULL)::int AS missing FROM public.pit_probe p LEFT JOIN dp.candidate_point_in_time_evidence_v v ON v.candidate_id = p.candidate_id`;

test('REAL POSTGRES VIEW: 80 random decisions (single, many, empty objects, missing children, nulls, arrays) rebuild to the exact legacy rows', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await prepare(pool);
    for (let seed = 1; seed <= 80; seed += 1) await load(pool, decision(seed, seed % 11 === 0 ? 1 : 1 + (seed % 25)), false);
    const result = (await pool.query(compare)).rows[0] as { compared: number; differing: number; missing: number };
    assert.ok(result.compared > 500, `compared ${result.compared}`);
    assert.deepEqual([result.differing, result.missing], [0, 0], 'BYTE/CANONICAL EQUIVALENCE');
  } finally { await pool.query('DROP TABLE IF EXISTS public.pit_probe').catch(() => undefined); await pool.end(); }
});

test('REAL POSTGRES VIEW: a 2,619-candidate decision with a large shared volatility surface rebuilds exactly and the shared context is stored ONCE', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await prepare(pool);
    const big = decision(9001, 2619, { surfaceKiB: 150, perturb: false });
    await load(pool, big, false);
    const result = (await pool.query(compare)).rows[0] as { compared: number; differing: number; missing: number };
    assert.deepEqual([result.compared, result.differing, result.missing], [2619, 0, 0]);
    assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM dp.decision_context')).rows[0].n), 1);
    const sizes = (await pool.query(`SELECT (SELECT sum(pg_column_size(context_json)) FROM dp.decision_context)::bigint AS context, (SELECT sum(pg_column_size(inline_json)) FROM dp.pit_candidate)::bigint AS inline`)).rows[0] as { context: string; inline: string };
    const legacyBytes = big.rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(PIT_JSON_COLUMNS.map((column) => row[column]))), 0);
    assert.ok((Number(sizes.context) + Number(sizes.inline)) * 20 < legacyBytes, `normalized ${Number(sizes.context) + Number(sizes.inline)} vs legacy JSON ${legacyBytes}`);
  } finally { await pool.query('DROP TABLE IF EXISTS public.pit_probe').catch(() => undefined); await pool.end(); }
});

test('REAL POSTGRES VIEW: tiered compaction keeps selected and feasible rows in full and ordinary rejected rows as identity + blockers + hash only', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await prepare(pool);
    const input = decision(7001, 60, { surfaceKiB: 20 });
    await load(pool, input, true);
    const rows = (await pool.query('SELECT tier, compact, selected, hard_status, contract_json, volatility_json, hard_blockers_json, content_hash, candidate_id FROM dp.candidate_point_in_time_evidence_v WHERE fusion_snapshot_id = $1', [input.fusion])).rows as Array<Record<string, unknown>>;
    assert.equal(rows.length, 60, 'no candidate is dropped from the hot rows, only its detail');
    const compactRows = rows.filter((row) => row.compact === true); const fullRows = rows.filter((row) => row.compact === false);
    assert.ok(compactRows.length > 20 && fullRows.length > 0);
    for (const row of compactRows) {
      assert.equal(row.tier, 'ORDINARY_REJECTED'); assert.notEqual(row.selected, true);
      assert.deepEqual(Object.keys(row.volatility_json as object), [], 'no detail is invented for a compact row');
      assert.ok(Object.keys(row.contract_json as object).length > 0, 'identity is kept');
      assert.match(String(row.content_hash), /^[0-9a-f]{64}$/);
    }
    assert.ok(fullRows.some((row) => row.selected === true), 'the selected candidate is always full');
    for (const row of fullRows) assert.ok(Object.keys(row.volatility_json as object).length > 0);
    const histogram = (await pool.query('SELECT total_candidates, reason_counts FROM dp.rejection_histogram WHERE decision_id = $1', [input.decisionId])).rows[0] as { total_candidates: number; reason_counts: { tiers: Record<string, number> } };
    assert.equal(histogram.total_candidates, 60);
    assert.equal(Object.values(histogram.reason_counts.tiers).reduce((a, b) => a + b, 0), 60);
  } finally { await pool.query('DROP TABLE IF EXISTS public.pit_probe').catch(() => undefined); await pool.end(); }
});
