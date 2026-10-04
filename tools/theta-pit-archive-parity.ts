// Production-shaped proof of the normalized point-in-time writer: REAL archived Production evidence (read-only NDJSON.gz archive) is planned by the real writer code,
// rebuilt by the real SQL view on a disposable PostgreSQL, and compared with the original rows by canonical content. Also measures stored bytes (legacy layout vs normalized layout).
//   node --import tsx tools/theta-pit-archive-parity.ts --archive=<dir> [--sample=150] [--pg-sample=40] [--seed=7] [--out=<file>]
// The database must be a disposable local one (THETA_DATA_PLATFORM_FULL_DATABASE_URL, 127.0.0.1/localhost only); the dp schema is recreated.
import { createReadStream, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import pg from 'pg';
import { canonicalJson } from '../src/storage/data-platform/archive-manifest.js';
import { PIT_JSON_COLUMNS, PIT_SCALAR_COLUMNS, type PitEvidenceRow } from '../src/storage/data-platform/pit-storage.js';
import { planPitWrite, writePlan, checkParity } from '../src/storage/data-platform/pit-writer.js';
import { sessionDateNewYork } from '../src/storage/data-platform/cycle-blob-store.js';

const argument = (name: string, fallback: string): string => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const archiveDir = argument('archive', 'C:/ProjectBackups/trading-bots/storage-archives/theta-20261003/legacy-candidate-point-in-time-evidence');
const sampleSize = Number(argument('sample', '150'));
const pgSample = Number(argument('pg-sample', '40'));
const seed = Number(argument('seed', '7'));

function mulberry32(initial: number): () => number { let a = initial >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const files = readdirSync(archiveDir).filter((name) => name.endsWith('.ndjson.gz')).sort().map((name) => join(archiveDir, name));
async function* lines(): AsyncGenerator<string> { for (const file of files) for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) if (line.length > 0) yield line; }
/** top-level key of the jsonb row text: keys sort by length, so the 18-character key sits near the end; take the LAST occurrence */
const fusionIdOf = (line: string): string | null => { const key = '"fusion_snapshot_id": "'; const at = line.lastIndexOf(key); return at === -1 ? null : line.slice(at + key.length, at + key.length + 36); };
const quantile = (values: readonly number[], p: number): number => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0; };
const kib = (bytes: number): number => Math.round(bytes / 1024);

async function main(): Promise<void> {
  const counts = new Map<string, number>();
  for await (const line of lines()) { const id = fusionIdOf(line); if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1); }
  const decisions = [...counts.keys()].sort();
  const rand = mulberry32(seed);
  const chosen = new Set<string>();
  while (chosen.size < Math.min(sampleSize, decisions.length)) chosen.add(decisions[Math.floor(rand() * decisions.length)] as string);
  // always include the largest decisions (the tail that drives P95)
  for (const [id] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) chosen.add(id);
  const rowsByDecision = new Map<string, PitEvidenceRow[]>();
  for await (const line of lines()) { const id = fusionIdOf(line); if (id === null || !chosen.has(id)) continue; const list = rowsByDecision.get(id) ?? []; list.push(JSON.parse(line) as PitEvidenceRow); rowsByDecision.set(id, list); }

  const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
  const perDecision: Array<{ decisionRows: number; originalBytes: number; normalizedBytes: number; exact: boolean }> = [];
  let exactDecisions = 0; let rowsChecked = 0; let mismatches = 0;
  const plans = new Map<string, ReturnType<typeof planPitWrite>>();
  for (const [id, rows] of rowsByDecision) {
    const plan = planPitWrite(id, rows, { compactOrdinaryRejected: false });
    plans.set(id, plan);
    const jsonCols = (row: PitEvidenceRow) => Object.fromEntries(PIT_JSON_COLUMNS.map((column) => [column, row[column]]));
    let exact = true;
    for (const [index, row] of rows.entries()) {
      const planned = plan.rows[index]; if (planned === undefined) { exact = false; continue; }
      const rebuilt: Record<string, unknown> = {};
      for (const column of PIT_JSON_COLUMNS) {
        const own = planned.inline[column]; const shared = plan.context[column];
        const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
        rebuilt[column] = Array.isArray(row[column]) ? own ?? shared ?? [] : { ...(isObject(shared) ? shared : {}), ...(isObject(own) ? own : {}) };
      }
      rowsChecked += 1;
      if (canonicalJson(rebuilt) !== canonicalJson(jsonCols(row))) { exact = false; mismatches += 1; }
    }
    if (exact) exactDecisions += 1;
    perDecision.push({ decisionRows: rows.length, originalBytes: rows.reduce((sum, row) => sum + bytes(jsonCols(row)), 0), normalizedBytes: plan.stats.normalizedBytes, exact });
  }

  const report: Record<string, unknown> = { source: 'REAL_ARCHIVED_PRODUCTION_EVIDENCE_READ_ONLY', archiveFiles: files.length, archivedRows: [...counts.values()].reduce((a, b) => a + b, 0), archivedDecisions: counts.size,
    sampledDecisions: rowsByDecision.size, rowsChecked, tsReconstruction: { exactDecisions, mismatchedRows: mismatches },
    jsonBytesPerDecision: { originalKiB: { p50: kib(quantile(perDecision.map((d) => d.originalBytes), 0.5)), p95: kib(quantile(perDecision.map((d) => d.originalBytes), 0.95)), max: kib(Math.max(...perDecision.map((d) => d.originalBytes))) },
      normalizedKiB: { p50: kib(quantile(perDecision.map((d) => d.normalizedBytes), 0.5)), p95: kib(quantile(perDecision.map((d) => d.normalizedBytes), 0.95)), max: kib(Math.max(...perDecision.map((d) => d.normalizedBytes))) } },
    rowsPerDecision: { p50: quantile(perDecision.map((d) => d.decisionRows), 0.5), p95: quantile(perDecision.map((d) => d.decisionRows), 0.95), max: Math.max(...perDecision.map((d) => d.decisionRows)) } };

  const url = process.env.THETA_DATA_PLATFORM_FULL_DATABASE_URL;
  if (url !== undefined && pgSample > 0) {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('DISPOSABLE_LOCAL_DATABASE_ONLY');
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
      await pool.query(readFileSync(new URL('../docs/proposals/069_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
      await pool.query('DROP TABLE IF EXISTS public.pit_legacy_probe');
      await pool.query(`CREATE TABLE public.pit_legacy_probe (candidate_id uuid PRIMARY KEY, ${PIT_JSON_COLUMNS.map((column) => `${column} jsonb NOT NULL`).join(', ')})`);
      const ids = [...rowsByDecision.keys()].sort((a, b) => (rowsByDecision.get(b)?.length ?? 0) - (rowsByDecision.get(a)?.length ?? 0)).slice(0, Math.min(5, pgSample)).concat([...rowsByDecision.keys()].filter((_, index) => index % Math.max(1, Math.floor(rowsByDecision.size / pgSample)) === 0).slice(0, pgSample));
      const selected = [...new Set(ids)];
      let viewRows = 0; let viewDiffering = 0; let viewMissing = 0;
      for (const id of selected) {
        const rows = rowsByDecision.get(id) as PitEvidenceRow[];
        const first = rows[0] as PitEvidenceRow;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const plan = plans.get(id) as ReturnType<typeof planPitWrite>;
          await writePlan(client, plan, { fusionSnapshotId: id, decisionTimeUtc: String(first.decision_time), sessionDate: sessionDateNewYork(String(first.decision_time)), decisionId: first.decision_id === null ? null : String(first.decision_id) });
          await client.query(`INSERT INTO public.pit_legacy_probe(candidate_id, ${PIT_JSON_COLUMNS.join(', ')}) SELECT x.candidate_id::uuid, ${PIT_JSON_COLUMNS.map((column) => `x.${column}`).join(', ')} FROM jsonb_to_recordset($1::jsonb) AS x(candidate_id text, ${PIT_JSON_COLUMNS.map((column) => `${column} jsonb`).join(', ')})`, [JSON.stringify(rows.map((row) => ({ candidate_id: row.candidate_id, ...Object.fromEntries(PIT_JSON_COLUMNS.map((column) => [column, row[column]])) })))]);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
        const rebuilt = await pool.query('SELECT * FROM dp.candidate_point_in_time_evidence_v WHERE fusion_snapshot_id = $1', [id]);
        const byId = new Map(rebuilt.rows.map((row) => [row.candidate_id as string, row as Record<string, unknown>]));
        for (const original of rows) {
          viewRows += 1;
          const row = byId.get(String(original.candidate_id));
          if (row === undefined) { viewMissing += 1; continue; }
          const same = PIT_JSON_COLUMNS.every((column) => canonicalJson(row[column]) === canonicalJson(original[column]))
            && PIT_SCALAR_COLUMNS.filter((column) => !['decision_time', 'fusion_snapshot_id', 'candidate_id', 'decision_id'].includes(column)).every((column) => canonicalJson(row[column] ?? null) === canonicalJson(original[column] ?? null))
            && String(row.candidate_id) === String(original.candidate_id) && String(row.fusion_snapshot_id) === String(original.fusion_snapshot_id)
            && new Date(row.decision_time as Date).getTime() === new Date(String(original.decision_time)).getTime();
          if (!same) viewDiffering += 1;
        }
      }
      const size = async (sql: string): Promise<number> => Number((await pool.query(sql)).rows[0].n);
      const legacyStored = await size(`SELECT COALESCE(sum(${PIT_JSON_COLUMNS.map((column) => `pg_column_size(${column})`).join('+')}), 0)::bigint AS n FROM public.pit_legacy_probe`);
      const contextStored = await size('SELECT COALESCE(sum(pg_column_size(context_json)), 0)::bigint AS n FROM dp.decision_context');
      const candidateStored = await size('SELECT COALESCE(sum(pg_column_size(inline_json)), 0)::bigint AS n FROM dp.pit_candidate');
      const candidateRows = await size('SELECT count(*)::bigint AS n FROM dp.pit_candidate');
      report.realPostgres = { decisionsLoaded: selected.length, rows: viewRows, viewMissing, viewDiffering, canonicalEquivalence: viewMissing === 0 && viewDiffering === 0 ? 'PASS' : 'FAIL',
        storedBytes: { legacyJsonColumnsKiB: kib(legacyStored), decisionContextKiB: kib(contextStored), candidateInlineKiB: kib(candidateStored), normalizedTotalKiB: kib(contextStored + candidateStored), reduction: Number((1 - (contextStored + candidateStored) / legacyStored).toFixed(4)) },
        perDecisionStoredKiB: { legacyMean: kib(legacyStored / selected.length), normalizedMean: kib((contextStored + candidateStored) / selected.length) }, candidateRows };
      const parity = await checkParityOnProbe(pool);
      report.realPostgres = { ...(report.realPostgres as object), probeParityRows: parity };
    } finally { await pool.query('DROP TABLE IF EXISTS public.pit_legacy_probe').catch(() => undefined); await pool.end(); }
  }
  const out = argument('out', '');
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out !== '') writeFileSync(out, text); else process.stdout.write(text);
}

/** the view rebuilt from the dp tables equals the plain jsonb columns that were stored in the legacy layout (jsonb to jsonb, the same comparison the dual-write ledger uses) */
async function checkParityOnProbe(pool: pg.Pool): Promise<{ compared: number; differing: number }> {
  const result = await pool.query(`SELECT count(*)::int AS compared, count(*) FILTER (WHERE ${PIT_JSON_COLUMNS.map((column) => `v.${column} IS DISTINCT FROM l.${column}`).join(' OR ')})::int AS differing
    FROM public.pit_legacy_probe l JOIN dp.candidate_point_in_time_evidence_v v ON v.candidate_id = l.candidate_id`);
  return { compared: result.rows[0].compared as number, differing: result.rows[0].differing as number };
}
void checkParity;
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
