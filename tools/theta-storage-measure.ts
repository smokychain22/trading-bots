// Read-only data-platform measurements (Phase 4 storage architecture): (1) HOT bytes per decision, P50/P95, current contract vs legacy; (2) shared-context
// duplication per large JSON field (rows, unique hashes, duplication ratio, total bytes, normalized bytes, estimated saving). One BEGIN READ ONLY transaction per
// query, bounded samples, retry on transient connection loss. Output JSON to --output; stdout carries a summary only.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { explicitEnvironmentFile } from '../src/config/tool-environment.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const environment = loadEnvironmentFile(arg('environment-file') ?? explicitEnvironmentFile());
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const sampleSnapshots = Number(arg('sample-snapshots') ?? '60');
// fraction of the point-in-time evidence bytes that is a per-decision shared nested value (measured on the legacy evidence: 0.97)
const sharedFraction = Number(arg('shared-fraction') ?? '0.97');
const observedAt = new Date().toISOString();
const outputPath = resolve(arg('output') ?? resolve('.theta-local-worker', 'storage-forensics', `measure-${observedAt.replace(/[-:.]/g, '')}.json`));
const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-storage-measure', options: '-c statement_timeout=240000' });
pool.on('error', () => undefined);
async function read<T>(sql: string, parameters: unknown[] = []): Promise<T[]> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    client.on('error', () => undefined);
    let broken = false;
    try {
      await client.query('BEGIN READ ONLY');
      const rows = (await client.query(sql, parameters)).rows as T[];
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      broken = true;
      await client.query('ROLLBACK').catch(() => undefined);
      const transient = /terminated|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(`${(error as { code?: string }).code ?? ''} ${(error as Error).message}`);
      if (attempt >= 5 || !transient) throw error;
      await sleep(5_000 * attempt);
    } finally { client.release(broken ? true : undefined); }
  }
}

interface Scope { readonly name: string; readonly snapshotPredicate: string }
const scopes: readonly Scope[] = [
  { name: 'CURRENT_CONTRACT_V3', snapshotPredicate: `s.storage_contract_version = 'theta-postgres-cycle-evidence-storage-v3'` },
  { name: 'LEGACY_PRE_CONTRACT', snapshotPredicate: 's.storage_contract_version IS NULL' },
];

// ---- 1. hot bytes per decision (stored size of every large column of every hot table keyed by the decision's fusion snapshot) -----------------------------
const hotBytesSql = (predicate: string): string => `WITH decisions AS (SELECT s.fusion_snapshot_id, s.decision_time FROM trade.fusion_snapshot s WHERE ${predicate}),
  fusion AS (SELECT s.fusion_snapshot_id, COALESCE(pg_column_size(s.evidence_archive_gzip),0) AS blob_bytes, COALESCE(pg_column_size(s.evidence_archive_gzip),0)+COALESCE(pg_column_size(s.snapshot_json),0)+COALESCE(pg_column_size(s.portfolio_state_json),0)+COALESCE(pg_column_size(s.provider_provenance_json),0)+COALESCE(pg_column_size(s.feature_snapshot_refs_json),0)+COALESCE(pg_column_size(s.unknown_features_json),0) AS bytes FROM trade.fusion_snapshot s JOIN decisions d USING (fusion_snapshot_id)),
  dec AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.receipt_json),0)+COALESCE(pg_column_size(x.explanation_text),0)) AS bytes FROM trade.decision x JOIN decisions d USING (fusion_snapshot_id) GROUP BY 1),
  fr AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.frontier_json),0)+COALESCE(pg_column_size(x.branches_considered_json),0)+COALESCE(pg_column_size(x.branches_evaluated_json),0)) AS bytes FROM trade.canonical_strategy_frontier x JOIN decisions d USING (fusion_snapshot_id) GROUP BY 1),
  pit AS (SELECT x.fusion_snapshot_id, sum(pg_column_size(x.contract_json)+pg_column_size(x.market_json)+pg_column_size(x.volatility_json)+pg_column_size(x.technical_json)+pg_column_size(x.event_json)+pg_column_size(x.flow_json)+pg_column_size(x.ownership_json)+pg_column_size(x.account_json)+pg_column_size(x.portfolio_json)+pg_column_size(x.aegis_json)+pg_column_size(x.execution_json)+pg_column_size(x.known_economics_json)+pg_column_size(x.unknown_economics_json)+pg_column_size(x.hard_blockers_json)+pg_column_size(x.soft_evidence_json)+pg_column_size(x.provider_provenance_json)) AS bytes, count(*) AS candidates FROM trade.candidate_point_in_time_evidence x JOIN decisions d USING (fusion_snapshot_id) GROUP BY 1),
  chain AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.structure_comparator_json),0)+COALESCE(pg_column_size(x.optionomics_attachments_json),0)+COALESCE(pg_column_size(x.chain_snapshot_json),0)+COALESCE(pg_column_size(x.strike_delta_frontier_json),0)+COALESCE(pg_column_size(x.expiration_frontier_json),0)) AS bytes FROM research.theta_option_chain_decision_evidence x JOIN decisions d USING (fusion_snapshot_id) GROUP BY 1),
  raw AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.payload_json),0)) AS bytes FROM market.optionomics_raw_observation x JOIN decisions d USING (fusion_snapshot_id) GROUP BY 1),
  feat AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.feature_state_json),0)) AS bytes FROM market.optionomics_feature_snapshot x JOIN decisions d USING (fusion_snapshot_id) GROUP BY 1),
  per AS (SELECT d.fusion_snapshot_id, d.decision_time, COALESCE(fusion.blob_bytes,0) AS blob_bytes, COALESCE(fusion.bytes,0) AS fusion_bytes, COALESCE(dec.bytes,0) AS decision_bytes, COALESCE(fr.bytes,0) AS frontier_bytes, COALESCE(pit.bytes,0) AS pit_bytes,
      COALESCE(pit.candidates,0) AS pit_candidates, COALESCE(chain.bytes,0) AS chain_bytes, COALESCE(raw.bytes,0) AS raw_bytes, COALESCE(feat.bytes,0) AS feature_bytes
    FROM decisions d LEFT JOIN fusion USING (fusion_snapshot_id) LEFT JOIN dec USING (fusion_snapshot_id) LEFT JOIN fr USING (fusion_snapshot_id) LEFT JOIN pit USING (fusion_snapshot_id)
      LEFT JOIN chain USING (fusion_snapshot_id) LEFT JOIN raw USING (fusion_snapshot_id) LEFT JOIN feat USING (fusion_snapshot_id)),
  totals AS (SELECT *, fusion_bytes+decision_bytes+frontier_bytes+pit_bytes+chain_bytes+raw_bytes+feature_bytes AS total, fusion_bytes-blob_bytes+decision_bytes+frontier_bytes+pit_bytes+chain_bytes+raw_bytes+feature_bytes AS total_no_blob FROM per), totals2 AS (SELECT *, total_no_blob - pit_bytes * ${sharedFraction} * CASE WHEN pit_candidates > 1 THEN (pit_candidates - 1.0) / pit_candidates ELSE 0 END AS total_no_blob_normalized FROM totals)
  SELECT count(*)::int AS decisions, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY total))::bigint AS p50_total, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY total))::bigint AS p95_total,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_no_blob))::bigint AS p50_no_blob, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY total_no_blob))::bigint AS p95_no_blob, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY blob_bytes))::bigint AS p50_blob, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY blob_bytes))::bigint AS p95_blob, round(avg(total))::bigint AS mean_total, max(total)::bigint AS max_total, sum(total)::bigint AS sum_total,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY fusion_bytes))::bigint AS p50_fusion, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY decision_bytes))::bigint AS p50_decision,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY frontier_bytes))::bigint AS p50_frontier, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY pit_bytes))::bigint AS p50_pit,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY chain_bytes))::bigint AS p50_chain, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY raw_bytes))::bigint AS p50_raw,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY feature_bytes))::bigint AS p50_feature, round(avg(pit_candidates),2)::float AS avg_pit_candidates,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_no_blob_normalized))::bigint AS p50_no_blob_normalized, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY total_no_blob_normalized))::bigint AS p95_no_blob_normalized, sum(fusion_bytes)::bigint AS sum_fusion, sum(decision_bytes)::bigint AS sum_decision, sum(frontier_bytes)::bigint AS sum_frontier, sum(pit_bytes)::bigint AS sum_pit,
    sum(chain_bytes)::bigint AS sum_chain, sum(raw_bytes)::bigint AS sum_raw, sum(feature_bytes)::bigint AS sum_feature FROM totals2`;

// ---- 2. shared-context duplication per large JSON field ---------------------------------------------------------------------------------------------------
interface FieldSpec { readonly table: string; readonly keyColumn: string; readonly columns: readonly string[] }
const fieldSpecs: readonly FieldSpec[] = [
  { table: 'trade.candidate_point_in_time_evidence', keyColumn: 'candidate_id', columns: ['contract_json', 'market_json', 'volatility_json', 'technical_json', 'event_json', 'flow_json', 'ownership_json', 'account_json', 'portfolio_json', 'aegis_json', 'execution_json', 'known_economics_json', 'provider_provenance_json'] },
  { table: 'research.theta_option_chain_decision_evidence', keyColumn: 'chain_decision_evidence_id', columns: ['structure_comparator_json', 'optionomics_attachments_json', 'chain_snapshot_json'] },
  { table: 'market.optionomics_feature_snapshot', keyColumn: 'feature_snapshot_id', columns: ['feature_state_json'] },
  { table: 'market.optionomics_raw_observation', keyColumn: 'observation_id', columns: ['payload_json'] },
];

const duplicationSql = (spec: FieldSpec, column: string, predicate: string): string => `WITH sample AS (SELECT s.fusion_snapshot_id FROM trade.fusion_snapshot s WHERE ${predicate} ORDER BY md5(s.fusion_snapshot_id::text) LIMIT $1),
  v AS (SELECT t.${q(column)} AS value, pg_column_size(t.${q(column)}) AS size, md5(t.${q(column)}::text) AS h, t.fusion_snapshot_id AS snapshot FROM ${spec.table} t JOIN sample USING (fusion_snapshot_id)),
  firsts AS (SELECT DISTINCT ON (h) h, size FROM v ORDER BY h, size)
  SELECT (SELECT count(*) FROM v)::bigint AS rows, (SELECT count(DISTINCT h) FROM v)::bigint AS unique_hashes, (SELECT COALESCE(sum(size),0) FROM v)::bigint AS total_bytes,
    (SELECT COALESCE(sum(size),0) FROM firsts)::bigint AS normalized_bytes, (SELECT count(DISTINCT snapshot) FROM v)::int AS snapshots,
    (SELECT COALESCE(sum(c),0) FROM (SELECT count(DISTINCT h) AS c FROM v GROUP BY snapshot) x)::bigint AS unique_per_snapshot_sum`;

try {
  const results: Record<string, unknown> = { observedAt, sampleSnapshots };
  results.hotBytesPerDecision = {};
  for (const scope of scopes) {
    const [row] = await read<Record<string, string | number>>(hotBytesSql(scope.snapshotPredicate));
    (results.hotBytesPerDecision as Record<string, unknown>)[scope.name] = row;
  }
  const [tail] = await read<Record<string, string | number>>(`WITH decisions AS (SELECT s.fusion_snapshot_id FROM trade.fusion_snapshot s WHERE ${scopes[0]?.snapshotPredicate ?? 'true'}),
    fusion AS (SELECT s.fusion_snapshot_id, COALESCE(pg_column_size(s.snapshot_json),0)+COALESCE(pg_column_size(s.portfolio_state_json),0)+COALESCE(pg_column_size(s.provider_provenance_json),0)+COALESCE(pg_column_size(s.unknown_features_json),0) AS b FROM trade.fusion_snapshot s JOIN decisions USING (fusion_snapshot_id)),
    dec AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.receipt_json),0)) AS b FROM trade.decision x JOIN decisions USING (fusion_snapshot_id) GROUP BY 1),
    fr AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.frontier_json),0)+COALESCE(pg_column_size(x.branches_considered_json),0)+COALESCE(pg_column_size(x.branches_evaluated_json),0)) AS b FROM trade.canonical_strategy_frontier x JOIN decisions USING (fusion_snapshot_id) GROUP BY 1),
    pit AS (SELECT x.fusion_snapshot_id, sum(pg_column_size(x.contract_json)+pg_column_size(x.market_json)+pg_column_size(x.volatility_json)+pg_column_size(x.technical_json)+pg_column_size(x.event_json)+pg_column_size(x.flow_json)+pg_column_size(x.ownership_json)+pg_column_size(x.account_json)+pg_column_size(x.portfolio_json)+pg_column_size(x.aegis_json)+pg_column_size(x.execution_json)+pg_column_size(x.known_economics_json)+pg_column_size(x.unknown_economics_json)+pg_column_size(x.hard_blockers_json)+pg_column_size(x.soft_evidence_json)+pg_column_size(x.provider_provenance_json)) AS b, count(*) AS n FROM trade.candidate_point_in_time_evidence x JOIN decisions USING (fusion_snapshot_id) GROUP BY 1),
    raw AS (SELECT x.fusion_snapshot_id, sum(COALESCE(pg_column_size(x.payload_json),0)) AS b FROM market.optionomics_raw_observation x JOIN decisions USING (fusion_snapshot_id) GROUP BY 1),
    per AS (SELECT d.fusion_snapshot_id, COALESCE(fusion.b,0) AS fusion_b, COALESCE(dec.b,0) AS dec_b, COALESCE(fr.b,0) AS fr_b, COALESCE(pit.b,0) AS pit_b, COALESCE(pit.n,0) AS pit_n, COALESCE(raw.b,0) AS raw_b FROM decisions d LEFT JOIN fusion USING (fusion_snapshot_id) LEFT JOIN dec USING (fusion_snapshot_id) LEFT JOIN fr USING (fusion_snapshot_id) LEFT JOIN pit USING (fusion_snapshot_id) LEFT JOIN raw USING (fusion_snapshot_id)),
    ranked AS (SELECT *, fusion_b+dec_b+fr_b+pit_b+raw_b AS total, ntile(20) OVER (ORDER BY fusion_b+dec_b+fr_b+pit_b+raw_b) AS bucket FROM per)
    SELECT count(*)::int AS tail_decisions, round(avg(total))::bigint AS avg_total, round(avg(fusion_b))::bigint AS avg_fusion_json, round(avg(dec_b))::bigint AS avg_decision, round(avg(fr_b))::bigint AS avg_frontier, round(avg(pit_b))::bigint AS avg_pit, round(avg(pit_n),1)::float AS avg_pit_rows, round(avg(raw_b))::bigint AS avg_raw
    FROM ranked WHERE bucket = 20`);
  results.tailDecomposition = tail;
  const duplication: Array<Record<string, unknown>> = [];
  for (const scope of scopes) {
    for (const spec of fieldSpecs) {
      for (const column of spec.columns) {
        try {
          const [row] = await read<Record<string, string | number>>(duplicationSql(spec, column, scope.snapshotPredicate), [sampleSnapshots]);
          const totalBytes = Number(row?.total_bytes ?? 0), normalizedBytes = Number(row?.normalized_bytes ?? 0), rows = Number(row?.rows ?? 0), unique = Number(row?.unique_hashes ?? 0);
          duplication.push({ scope: scope.name, table: spec.table, field: column, rows, uniqueHashes: unique, duplicationRatio: unique === 0 ? null : +(rows / unique).toFixed(2), totalBytes, normalizedBytes,
            estimatedSavingBytes: totalBytes - normalizedBytes, estimatedSavingPercent: totalBytes === 0 ? null : +(100 * (totalBytes - normalizedBytes) / totalBytes).toFixed(1), snapshots: Number(row?.snapshots ?? 0),
            uniquePerSnapshotMean: Number(row?.snapshots ?? 0) === 0 ? null : +(Number(row?.unique_per_snapshot_sum ?? 0) / Number(row?.snapshots ?? 1)).toFixed(2) });
        } catch (error) { duplication.push({ scope: scope.name, table: spec.table, field: column, error: (error as { code?: string }).code ?? (error as Error).message }); }
      }
    }
  }
  results.fieldDuplication = duplication;
  results.archiveBlobIdentity = (await read(`SELECT count(*)::int AS rows, count(DISTINCT evidence_archive_hash)::int AS unique_archive_hashes, COALESCE(sum(pg_column_size(evidence_archive_gzip)),0)::bigint AS bytes FROM trade.fusion_snapshot WHERE evidence_archive_gzip IS NOT NULL`))[0];
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(results, null, 2));
  process.stdout.write(`${JSON.stringify({ state: 'PASS', observedAt, outputPath })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ state: 'FAILED', code: (error as { code?: string }).code ?? (error as Error).message })}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
