// PRODUCTION-SHAPED hot-write measurement: the most recent real Production decisions (read-only), their real point-in-time rows planned and written by the REAL normalized writer on a
// disposable PostgreSQL, compared decision by decision.
//   old bytes  = stored bytes of every hot table of the decision as Production holds it today (read-only queries)
//   new bytes  = old bytes - the decision's point-in-time bytes + the bytes the real writer stores for the SAME rows in dp.decision_context / dp.pit_candidate / dp.rejection_histogram
//   index bytes use the measured average index bytes per row of each relation (Production for the old layout, the disposable database for the new one).
// Nothing is estimated and nothing is written to Production. The blob is reported separately: the new writer moves it to a partition, it does not change its size.
//   node --import tsx tools/theta-pit-production-measure.ts [--decisions=150] [--out=<file>] [--environment-file=.env.local]    (THETA_DATA_PLATFORM_FULL_DATABASE_URL, local only)
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { decisionBytes, indexBytesPerRow, indexBytesFor, percentile, type DecisionBytes } from '../src/storage/data-platform/hot-bytes.js';
import { PIT_JSON_COLUMNS, PIT_SCALAR_COLUMNS, type PitEvidenceRow } from '../src/storage/data-platform/pit-storage.js';
import { planPitWrite, writePlan } from '../src/storage/data-platform/pit-writer.js';
import { sessionDateNewYork } from '../src/storage/data-platform/cycle-blob-store.js';
import { explicitEnvironmentFile } from '../src/config/tool-environment.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const limit = Number(arg('decisions') ?? '150');
const environment = loadEnvironmentFile(arg('environment-file') ?? explicitEnvironmentFile());
const productionUrl = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
const localUrl = process.env.THETA_DATA_PLATFORM_FULL_DATABASE_URL;
if (productionUrl === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
if (localUrl === undefined || !['127.0.0.1', 'localhost'].includes(new URL(localUrl).hostname)) throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const kib = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10;

/** every production read is a short READ ONLY transaction with a transient-failure retry */
const production = new pg.Pool({ connectionString: productionUrl, max: 1, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-pit-measure', options: '-c statement_timeout=240000' });
production.on('error', () => undefined);
const readOnly: pg.Pool = new Proxy(production, {
  get(target, property) {
    if (property !== 'query') return (target as unknown as Record<string | symbol, unknown>)[property];
    return async (sql: string, values?: unknown[]) => {
      for (let attempt = 1; ; attempt += 1) {
        const client = await target.connect(); client.on('error', () => undefined); let broken = false;
        try { await client.query('BEGIN READ ONLY'); const result = await client.query(sql, values); await client.query('COMMIT'); return result; }
        catch (error) {
          broken = true; await client.query('ROLLBACK').catch(() => undefined);
          const transient = /terminated|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(`${(error as { code?: string }).code ?? ''} ${(error as Error).message}`);
          if (attempt >= 5 || !transient) throw error; await sleep(5_000 * attempt);
        } finally { client.release(broken ? true : undefined); }
      }
    };
  },
}) as unknown as pg.Pool;

async function main(): Promise<void> {
  const local = new pg.Pool({ connectionString: localUrl, max: 2 });
  try {
    await local.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await local.query('DROP SCHEMA IF EXISTS dp CASCADE');
    await local.query(readFileSync(new URL('../docs/proposals/DP1_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
    const decisions = (await readOnly.query(`SELECT d.fusion_snapshot_id::text AS fusion, d.decision_id::text AS decision, d.candidate_set_id::text AS candidate_set, s.decision_time::text AS decision_time, s.storage_contract_version AS contract
      FROM trade.decision d JOIN trade.fusion_snapshot s ON s.fusion_snapshot_id = d.fusion_snapshot_id WHERE s.storage_contract_version = 'theta-postgres-cycle-evidence-storage-v3' ORDER BY s.decision_time DESC LIMIT $1`, [limit])).rows as Array<{ fusion: string; decision: string; candidate_set: string | null; decision_time: string }>;
    const oldPerRow = await indexBytesPerRow(readOnly);
    const records: Array<{ id: string; pitRows: number; old: DecisionBytes; oldPit: number; oldTotal: number; oldTotalNoBlob: number; newPitBytes: number; newPitRows: number; exact: boolean }> = [];
    const newMeasured = new Map<string, DecisionBytes>();
    let exactAll = true;
    for (const row of decisions) {
      const old = await decisionBytes(readOnly, { fusion: row.fusion, decision: row.decision, candidateSet: row.candidate_set });
      const pitResult = await readOnly.query('SELECT * FROM trade.candidate_point_in_time_evidence WHERE fusion_snapshot_id = $1', [row.fusion]);
      const pitRows = pitResult.rows.map((record: Record<string, unknown>) => ({ ...record, decision_time: new Date(record.decision_time as string).toISOString() })) as unknown as PitEvidenceRow[];
      let newDecision: DecisionBytes = { buckets: { BLOB: 0, DECISION_CONTEXT: 0, CANDIDATE: 0, AUDIT_AND_FRONTIER: 0, FUSION_PROJECTION: 0, RAW_AND_RESEARCH: 0 }, rows: {}, candidateRows: 0, relationBytes: {} };
      let exact = true;
      if (pitRows.length > 0) {
        const plan = planPitWrite(row.fusion, pitRows, { compactOrdinaryRejected: true });
        const client = await local.connect();
        try {
          await client.query('BEGIN');
          await writePlan(client, plan, { fusionSnapshotId: row.fusion, decisionTimeUtc: new Date(row.decision_time).toISOString(), sessionDate: sessionDateNewYork(new Date(row.decision_time).toISOString()), decisionId: row.decision });
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
        newDecision = await decisionBytes(local, { fusion: row.fusion, decision: row.decision, candidateSet: null });
        // exactness of the full-fidelity rows through the real view (selected/finalist/near-boundary/anomaly rows are full; compact ones keep identity, reason and hash by design)
        const rebuilt = await local.query('SELECT * FROM dp.candidate_point_in_time_evidence_v WHERE fusion_snapshot_id = $1 AND NOT compact', [row.fusion]);
        for (const full of rebuilt.rows as Array<Record<string, unknown>>) {
          const original = pitRows.find((candidate) => String(candidate.candidate_id) === String(full.candidate_id));
          if (original === undefined || PIT_JSON_COLUMNS.some((column) => JSON.stringify(sortKeys(full[column])) !== JSON.stringify(sortKeys(original[column])))) exact = false;
          if (original !== undefined && PIT_SCALAR_COLUMNS.filter((column) => ['branch', 'selected', 'hard_status', 'soft_status', 'content_hash'].includes(column)).some((column) => full[column] !== original[column])) exact = false;
        }
      }
      exactAll &&= exact; newMeasured.set(row.fusion, newDecision);
      const oldPit = old.relationBytes['trade.candidate_point_in_time_evidence'] ?? 0;
      records.push({ id: row.fusion, pitRows: pitRows.length, old, oldPit, oldTotal: 0, oldTotalNoBlob: 0, newPitBytes: 0, newPitRows: newDecision.rows['dp.pit_candidate'] ?? 0, exact });
    }
    const newPerRow = await indexBytesPerRow(local);
    const oldTotals: number[] = []; const newTotals: number[] = []; const oldNoBlob: number[] = []; const newNoBlob: number[] = []; const perCandidateOld: number[] = []; const perCandidateNew: number[] = []; const blobs: number[] = [];
    const relationSums: Record<string, number> = {}; const samples: Array<Record<string, number>> = [];
    const bucketSums = { old: { PIT: 0, BLOB: 0, OTHER: 0, INDEX: 0 }, new: { DECISION_CONTEXT: 0, CANDIDATE: 0, AUDIT: 0, BLOB: 0, OTHER: 0, INDEX: 0 } };
    for (const record of records) {
      const fresh = newMeasured.get(record.id) as DecisionBytes;
      const oldBytes = Object.values(record.old.buckets).reduce((a, b) => a + b, 0) + indexBytesFor(record.old.rows, oldPerRow);
      const newIndex = indexBytesFor(fresh.rows, newPerRow);
      const oldPitIndex = (record.old.rows['trade.candidate_point_in_time_evidence'] ?? 0) * (oldPerRow['trade.candidate_point_in_time_evidence'] ?? 0);
      const newPit = Object.entries(fresh.relationBytes).filter(([relation]) => relation.startsWith('dp.')).reduce((sum, [, bytes]) => sum + bytes, 0) + newIndex;
      const newBytes = oldBytes - record.oldPit - oldPitIndex + newPit;
      const blob = record.old.buckets.BLOB; blobs.push(blob);
      oldTotals.push(oldBytes); newTotals.push(newBytes); oldNoBlob.push(oldBytes - blob); newNoBlob.push(newBytes - blob);
      if (record.pitRows > 0) { perCandidateOld.push((record.oldPit + oldPitIndex) / record.pitRows); perCandidateNew.push(newPit / record.pitRows); }
      for (const [relation, bytes] of Object.entries(record.old.relationBytes)) relationSums[relation] = (relationSums[relation] ?? 0) + bytes + (record.old.rows[relation] ?? 0) * (oldPerRow[relation] ?? 0);
      samples.push({ blob, oldPit: record.oldPit + oldPitIndex, newPit, oldTotal: oldBytes, newTotal: newBytes, pitRows: record.pitRows, decisionContext: fresh.relationBytes['dp.decision_context'] ?? 0, newCandidate: fresh.relationBytes['dp.pit_candidate'] ?? 0, ...Object.fromEntries(Object.entries(record.old.relationBytes).filter(([relation]) => relation !== 'trade.candidate_point_in_time_evidence').map(([relation, bytes]) => [relation, bytes + (record.old.rows[relation] ?? 0) * (oldPerRow[relation] ?? 0)])) });
      bucketSums.old.PIT += record.oldPit + oldPitIndex; bucketSums.old.BLOB += blob; bucketSums.old.OTHER += oldBytes - blob - record.oldPit - oldPitIndex;
      bucketSums.new.DECISION_CONTEXT += fresh.relationBytes['dp.decision_context'] ?? 0; bucketSums.new.CANDIDATE += (fresh.relationBytes['dp.pit_candidate'] ?? 0); bucketSums.new.AUDIT += fresh.relationBytes['dp.rejection_histogram'] ?? 0;
      bucketSums.new.BLOB += blob; bucketSums.new.INDEX += newIndex; bucketSums.new.OTHER += oldBytes - blob - record.oldPit - oldPitIndex;
    }
    const n = Math.max(1, records.length);
    const stat = (values: number[]) => ({ p50: kib(percentile(values, 0.5)), p95: kib(percentile(values, 0.95)), max: kib(values.length === 0 ? 0 : Math.max(...values)), mean: kib(values.reduce((a, b) => a + b, 0) / n) });
    const report = {
      source: 'PRODUCTION_READ_ONLY_RECENT_DECISIONS_WITH_REAL_NORMALIZED_WRITER_ON_DISPOSABLE_POSTGRES', measuredAt: new Date().toISOString(), decisions: records.length,
      pitRowsPerDecision: { p50: percentile(records.map((record) => record.pitRows), 0.5), p95: percentile(records.map((record) => record.pitRows), 0.95), max: Math.max(...records.map((record) => record.pitRows)) },
      exactReconstructionOfFullFidelityRows: exactAll ? 'PASS' : 'FAIL',
      hotKiBPerDecision: { OLD: stat(oldTotals), NEW: stat(newTotals) },
      hotKiBPerDecisionExcludingBlob: { OLD: stat(oldNoBlob), NEW: stat(newNoBlob) },
      blobKiB: stat(blobs),
      hotKiBPerCandidate: { OLD: stat(perCandidateOld), NEW: stat(perCandidateNew) },
      meanKiBByRelationOld: Object.fromEntries(Object.entries(relationSums).sort(([, a], [, b]) => b - a).map(([relation, bytes]) => [relation, kib(bytes / n)])),
      samples,
      meanKiBByBucket: { OLD: Object.fromEntries(Object.entries(bucketSums.old).map(([name, value]) => [name, kib(value / n)])), NEW: Object.fromEntries(Object.entries(bucketSums.new).map(([name, value]) => [name, kib(value / n)])) },
    };
    const out = arg('out'); const text = `${JSON.stringify(report, null, 2)}\n`; if (out !== undefined) writeFileSync(out, text); else process.stdout.write(text);
  } finally { await local.end(); await production.end(); }
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, sortKeys(inner)]));
  return value;
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
