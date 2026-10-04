// Measures the REAL cycle store (legacy layout vs the normalized data-platform layout) on a disposable PostgreSQL migrated to 068 (+ draft 069): stored bytes per decision and per
// candidate for chains from a handful of contracts to 10,000, split into DECISION_CONTEXT / CANDIDATE / BLOB / INDEX / OTHER. Every number is read back from the database; none is estimated.
//   node --import tsx tools/theta-writer-measure.ts [--out=<file>] [--quick]     (THETA_DATA_PLATFORM_FULL_DATABASE_URL, 127.0.0.1/localhost only)
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { PostgresThetaCycleStore } from '../src/theta/postgres-theta-cycle-store.js';
import { postgresCycleBlobSink } from '../src/storage/data-platform/cycle-blob-store.js';
import { PIT_DATASET } from '../src/storage/data-platform/pit-writer.js';
import { decisionBytes, indexBytesPerRow } from '../src/storage/data-platform/hot-bytes.js';
import { buildCycle, persistenceContext, seedWorld } from '../tests/helpers/theta-cycle-fixture.js';

const argument = (name: string): string | undefined => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const quick = process.argv.includes('--quick');
const url = process.env.THETA_DATA_PLATFORM_FULL_DATABASE_URL;
if (url === undefined || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');

const quantile = (values: readonly number[], p: number): number => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0; };
const kib = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10;

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const pending: Array<{ contracts: number; variant: string; relational: boolean; repeats: number; perDecision: number[]; perDecisionNoBlob: number[]; perCandidate: number[]; bucketTotals: Record<string, number[]>; rowMaps: Array<Record<string, number>>; candidateRowsTotal: number }> = [];
  const failures: Array<{ contracts: number; variant: string; relational: boolean; error: string }> = [];
  const report: Record<string, unknown> = { measuredAt: new Date().toISOString(), method: 'pg_column_size over the stored (compressed/TOAST) value of every column of every decision-keyed hot table, plus 28 bytes tuple overhead per row; index bytes are the batch growth of pg_indexes_size divided by the decisions of the batch', scenarios: [] };
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
    await pool.query(readFileSync(new URL('../docs/proposals/069_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
    await pool.query(`INSERT INTO dp.dual_write_ledger(dataset, mode, dual_write_started_at, dual_write_deadline, cutover_at, legacy_writer_disabled) VALUES ($1, 'AUTHORITATIVE', now(), now() + interval '1 day', now(), true)`, [PIT_DATASET]);
    const world = await seedWorld(pool, '2026-09-11T14:59:00.000Z'); const context = persistenceContext(world);
    // [contracts, decisions per variant, relational research copies (the opt-in the store supports; Production runs without it)]
    const plan: Array<[number, number, boolean]> = quick ? [[40, 3, false], [300, 3, false], [2619, 2, false], [300, 2, true]]
      : [[40, 12, false], [300, 10, false], [1000, 8, false], [2619, 8, false], [5000, 4, false], [10000, 3, false], [300, 6, true], [1000, 4, true], [2619, 3, true]];
    const richnessCycle = [30, 90, 180, 240, 60];
    let clock = 0; const runSalt = Date.now() % 1_000_000;
    const variants = (relational: boolean) => [
      { name: relational ? 'LEGACY_RELATIONAL' : 'LEGACY', options: { persistRelationalCandidateEvidence: relational } },
      { name: relational ? 'NORMALIZED_RELATIONAL_FULL_FIDELITY' : 'NORMALIZED', options: { persistRelationalCandidateEvidence: relational, cycleBlobSink: postgresCycleBlobSink, pitWriter: { mode: 'AUTHORITATIVE' as const, compactOrdinaryRejected: false } } },
      ...(relational ? [{ name: 'NORMALIZED_RELATIONAL_TIERED', options: { persistRelationalCandidateEvidence: relational, cycleBlobSink: postgresCycleBlobSink, pitWriter: { mode: 'AUTHORITATIVE' as const, compactOrdinaryRejected: true } } }] : [{ name: 'NORMALIZED_TIERED', options: { persistRelationalCandidateEvidence: relational, cycleBlobSink: postgresCycleBlobSink, pitWriter: { mode: 'AUTHORITATIVE' as const, compactOrdinaryRejected: true } } }]),
    ];
    for (const [contracts, repeats, relational] of plan) {
      for (const variantSpec of variants(relational)) {
        const variant = variantSpec.name;
        const store = new PostgresThetaCycleStore(pool, variantSpec.options);
        const perDecision: number[] = []; const perDecisionNoBlob: number[] = []; const perCandidate: number[] = []; const bucketTotals: Record<string, number[]> = {};
        const rowMaps: Array<Record<string, number>> = [];
        let candidateRowsTotal = 0; let failed = false;
        for (let repeat = 0; repeat < repeats; repeat += 1) {
          clock += 1;
          const at = `2026-09-${String(12 + (clock % 14)).padStart(2, '0')}T${String(14 + (clock % 6)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}:${String(Math.floor(clock / 60) % 60).padStart(2, '0')}.000Z`;
          const cycle = buildCycle(contracts, at, { sharedKiB: richnessCycle[repeat % richnessCycle.length] as number }, clock + runSalt);
          let saved: Awaited<ReturnType<PostgresThetaCycleStore['persist']>>;
          try { saved = await store.persist(context, cycle); } catch (error) {
            // a writer that CAN NOT persist this decision is a measurement, not a crash (the legacy relational writer exceeds PostgreSQL's 256 MiB jsonb limit on large chains)
            failures.push({ contracts, variant, relational, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
            failed = true; break;
          }
          const found = await pool.query('SELECT d.decision_id, d.candidate_set_id FROM trade.decision d WHERE d.fusion_snapshot_id = $1', [saved.fusionSnapshotId]);
          const measured = await decisionBytes(pool, { fusion: saved.fusionSnapshotId, decision: (found.rows[0]?.decision_id as string | undefined) ?? null, candidateSet: (found.rows[0]?.candidate_set_id as string | undefined) ?? null });
          const total = Object.values(measured.buckets).reduce((a, b) => a + b, 0);
          perDecision.push(total); perDecisionNoBlob.push(total - measured.buckets.BLOB); candidateRowsTotal += measured.candidateRows; rowMaps.push(measured.rows);
          if (measured.candidateRows > 0) perCandidate.push((measured.buckets.CANDIDATE + measured.buckets.DECISION_CONTEXT) / measured.candidateRows);
          for (const [name, value] of Object.entries(measured.buckets)) (bucketTotals[name] ??= []).push(value);
        }
        if (failed) { process.stderr.write(`${contracts} ${variant} FAILED\n`); continue; }
        pending.push({ contracts, variant, relational, repeats, perDecision, perDecisionNoBlob, perCandidate, bucketTotals, rowMaps, candidateRowsTotal });
        process.stderr.write(`${contracts} ${variant} done\n`);
      }
    }
    const perRow = await indexBytesPerRow(pool);
    for (const entry of pending) {
      const indexPerDecisionList = entry.rowMaps.map((rows) => Object.entries(rows).reduce((sum, [relation, n]) => sum + n * (perRow[relation] ?? 0), 0));
      const withIndex = entry.perDecision.map((value, index) => value + (indexPerDecisionList[index] ?? 0));
      const withIndexNoBlob = entry.perDecisionNoBlob.map((value, index) => value + (indexPerDecisionList[index] ?? 0));
      const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
      (report.scenarios as unknown[]).push({ contracts: entry.contracts, variant: entry.variant, relationalResearchCopies: entry.relational, decisions: entry.repeats, candidateRowsPerDecision: Number((entry.candidateRowsTotal / entry.repeats).toFixed(1)),
        hotKiBPerDecision: { p50: kib(quantile(withIndex, 0.5)), p95: kib(quantile(withIndex, 0.95)), max: kib(Math.max(...withIndex)) },
        hotKiBPerDecisionExcludingBlob: { p50: kib(quantile(withIndexNoBlob, 0.5)), p95: kib(quantile(withIndexNoBlob, 0.95)), max: kib(Math.max(...withIndexNoBlob)) },
        hotKiBPerCandidate: entry.perCandidate.length === 0 ? null : { p50: kib(quantile(entry.perCandidate, 0.5)), p95: kib(quantile(entry.perCandidate, 0.95)) },
        meanKiBByBucket: { ...Object.fromEntries(Object.entries(entry.bucketTotals).map(([name, values]) => [name, kib(mean(values))])), INDEX: kib(mean(indexPerDecisionList)) } });
    }
  } finally { await pool.end(); }
  report.writerFailures = failures;
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const out = argument('out'); if (out !== undefined) writeFileSync(out, text); else process.stdout.write(text);
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
