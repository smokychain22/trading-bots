// Read-only storage AMPLIFICATION probe (Phase 4 storage decision). Looks for the same evidence persisted repeatedly or in several forms.
// One BEGIN READ ONLY transaction, bounded samples, 120 s statement timeout. Output JSON to --output=<file>; stdout carries a summary only.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { explicitEnvironmentFile } from '../src/config/tool-environment.js';

const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const environment = loadEnvironmentFile(arg('environment-file') ?? explicitEnvironmentFile());
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');
const observedAt = new Date().toISOString();
const outputPath = resolve(arg('output') ?? resolve('.theta-local-worker', 'storage-forensics', `amplification-${observedAt.replace(/[-:.]/g, '')}.json`));
const SAMPLE_SNAPSHOTS = Number(arg('sample-snapshots') ?? '25');

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 2_000, application_name: 'theta-readonly-storage-amplification',
  options: '-c statement_timeout=120000' });
const client = await pool.connect();
const results: Record<string, unknown> = {};
const run = async (name: string, sql: string, parameters: unknown[] = []): Promise<void> => {
  await client.query('SAVEPOINT probe');
  try { results[name] = (await client.query(sql, parameters)).rows; await client.query('RELEASE SAVEPOINT probe'); }
  catch (error) { results[name] = { error: (error as { code?: string }).code ?? (error as Error).message }; await client.query('ROLLBACK TO SAVEPOINT probe'); }
};
try {
  await client.query('BEGIN READ ONLY');
  // 1. candidate_point_in_time_evidence: how many distinct copies of each JSON column exist per decision snapshot (a sampled, spread-out set of snapshots)
  const pitColumns = ['contract_json', 'market_json', 'volatility_json', 'technical_json', 'event_json', 'flow_json', 'account_json', 'portfolio_json', 'ownership_json', 'provider_provenance_json', 'aegis_json'];
  const pitSql = `WITH snapshots AS (
      SELECT fusion_snapshot_id, count(*) AS rows FROM trade.candidate_point_in_time_evidence GROUP BY 1 ORDER BY md5(fusion_snapshot_id::text) LIMIT $1)
    SELECT ${pitColumns.map((column) => `sum(pg_column_size(p.${column}))::bigint AS ${column}_bytes, count(DISTINCT md5(p.${column}::text))::bigint AS ${column}_distinct`).join(',')},
      count(*)::bigint AS rows, count(DISTINCT p.fusion_snapshot_id)::bigint AS snapshots
    FROM trade.candidate_point_in_time_evidence p JOIN snapshots s USING (fusion_snapshot_id)`;
  await run('candidatePointInTimeSample', pitSql, [SAMPLE_SNAPSHOTS]);
  // per-snapshot distinct volatility copies (the largest column), distribution
  await run('volatilityCopiesPerSnapshot', `WITH snapshots AS (SELECT fusion_snapshot_id FROM trade.candidate_point_in_time_evidence GROUP BY 1 ORDER BY md5(fusion_snapshot_id::text) LIMIT $1)
    SELECT p.fusion_snapshot_id::text AS snapshot, count(*)::int AS rows, count(DISTINCT md5(p.volatility_json::text))::int AS distinct_volatility,
      count(DISTINCT md5(p.event_json::text))::int AS distinct_event, count(DISTINCT md5(p.provider_provenance_json::text))::int AS distinct_provenance,
      sum(pg_column_size(p.volatility_json))::bigint AS volatility_bytes
    FROM trade.candidate_point_in_time_evidence p JOIN snapshots s USING (fusion_snapshot_id) GROUP BY 1 ORDER BY 2 DESC`, [SAMPLE_SNAPSHOTS]);
  // 2. fusion_snapshot / decision / frontier: archive coverage and the relation between the stored forms
  await run('fusionSnapshotArchiveCoverage', `SELECT count(*)::int AS rows, count(evidence_archive_gzip)::int AS with_archive, count(snapshot_json)::int AS with_snapshot_json,
      sum(pg_column_size(evidence_archive_gzip))::bigint AS archive_stored_bytes, sum(evidence_archive_compressed_bytes)::bigint AS archive_declared_compressed,
      sum(evidence_archive_uncompressed_bytes)::bigint AS archive_declared_uncompressed, sum(pg_column_size(snapshot_json))::bigint AS snapshot_json_bytes,
      count(*) FILTER (WHERE storage_contract_version IS NULL)::int AS legacy_rows_without_storage_contract,
      sum(pg_column_size(snapshot_json)) FILTER (WHERE storage_contract_version IS NULL)::bigint AS legacy_snapshot_json_bytes,
      sum(pg_column_size(evidence_archive_gzip)) FILTER (WHERE storage_contract_version IS NOT NULL)::bigint AS contract_archive_bytes,
      sum(pg_column_size(snapshot_json)) FILTER (WHERE storage_contract_version IS NOT NULL)::bigint AS contract_snapshot_json_bytes
    FROM trade.fusion_snapshot`);
  await run('fusionSnapshotByStorageContractAndMonth', `SELECT COALESCE(storage_contract_version,'(none)') AS storage_contract, (decision_time AT TIME ZONE 'America/New_York')::date::text AS day,
      count(*)::int AS rows, sum(pg_column_size(evidence_archive_gzip))::bigint AS archive_bytes, sum(pg_column_size(snapshot_json))::bigint AS snapshot_json_bytes,
      avg(full_contract_count)::int AS avg_full_contracts
    FROM trade.fusion_snapshot GROUP BY 1,2 ORDER BY 2,1`);
  await run('fusionSnapshotTopKeys', `WITH sample AS (SELECT snapshot_json FROM trade.fusion_snapshot WHERE snapshot_json IS NOT NULL ORDER BY md5(fusion_snapshot_id::text) LIMIT 30)
    SELECT e.key AS key, sum(pg_column_size(e.value))::bigint AS bytes, count(*)::int AS rows FROM sample, jsonb_each(snapshot_json) e GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  await run('decisionReceiptTopKeys', `WITH sample AS (SELECT receipt_json FROM trade.decision WHERE receipt_json IS NOT NULL ORDER BY md5(decision_id::text) LIMIT 30)
    SELECT e.key AS key, sum(pg_column_size(e.value))::bigint AS bytes, count(*)::int AS rows FROM sample, jsonb_each(receipt_json) e GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  await run('frontierTopKeys', `WITH sample AS (SELECT frontier_json FROM trade.canonical_strategy_frontier WHERE frontier_json IS NOT NULL ORDER BY md5(frontier_id::text) LIMIT 30)
    SELECT e.key AS key, sum(pg_column_size(e.value))::bigint AS bytes, count(*)::int AS rows FROM sample, jsonb_each(frontier_json) e GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  await run('decisionVersusFrontierDuplicates', `SELECT count(*)::int AS pairs,
      count(*) FILTER (WHERE d.receipt_json = f.frontier_json)::int AS identical_json,
      count(*) FILTER (WHERE d.receipt_json -> 'frontier' IS NOT NULL)::int AS receipt_embeds_frontier
    FROM trade.decision d JOIN trade.canonical_strategy_frontier f ON f.fusion_snapshot_id = d.fusion_snapshot_id WHERE d.decided_at >= now() - interval '8 days'`);
  await run('dailyStoredBytesByTable', `SELECT day, table_name, rows, bytes FROM (
      SELECT (decision_time AT TIME ZONE 'America/New_York')::date::text AS day, 'trade.fusion_snapshot' AS table_name, count(*)::int AS rows,
        sum(COALESCE(pg_column_size(evidence_archive_gzip),0)+COALESCE(pg_column_size(snapshot_json),0))::bigint AS bytes FROM trade.fusion_snapshot GROUP BY 1
      UNION ALL SELECT (decided_at AT TIME ZONE 'America/New_York')::date::text, 'trade.decision', count(*)::int, sum(pg_column_size(receipt_json))::bigint FROM trade.decision GROUP BY 1
      UNION ALL SELECT (observed_at AT TIME ZONE 'America/New_York')::date::text, 'trade.canonical_strategy_frontier', count(*)::int, sum(pg_column_size(frontier_json))::bigint FROM trade.canonical_strategy_frontier GROUP BY 1
      UNION ALL SELECT (decision_time AT TIME ZONE 'America/New_York')::date::text, 'trade.candidate_point_in_time_evidence', count(*)::int,
        sum(pg_column_size(volatility_json)+pg_column_size(event_json)+pg_column_size(provider_provenance_json)+pg_column_size(portfolio_json)+pg_column_size(flow_json)+pg_column_size(market_json)+pg_column_size(contract_json))::bigint FROM trade.candidate_point_in_time_evidence GROUP BY 1
      UNION ALL SELECT (created_at AT TIME ZONE 'America/New_York')::date::text, 'market.optionomics_raw_observation', count(*)::int, sum(pg_column_size(payload_json))::bigint FROM market.optionomics_raw_observation GROUP BY 1
      UNION ALL SELECT (observed_at AT TIME ZONE 'America/New_York')::date::text, 'market.optionomics_feature_snapshot', count(*)::int, sum(pg_column_size(feature_state_json))::bigint FROM market.optionomics_feature_snapshot GROUP BY 1
      UNION ALL SELECT (observed_at AT TIME ZONE 'America/New_York')::date::text, 'research.theta_option_chain_decision_evidence', count(*)::int,
        sum(pg_column_size(structure_comparator_json)+pg_column_size(optionomics_attachments_json)+pg_column_size(chain_snapshot_json))::bigint FROM research.theta_option_chain_decision_evidence GROUP BY 1
    ) t ORDER BY day, table_name`);
  await run('volatilityInnerKeys', `WITH sample AS (SELECT volatility_json FROM trade.candidate_point_in_time_evidence ORDER BY md5(candidate_id::text) LIMIT 400)
    SELECT e.key AS key, sum(pg_column_size(e.value))::bigint AS bytes, count(DISTINCT md5(e.value::text))::int AS distinct_values, count(*)::int AS rows FROM sample, jsonb_each(volatility_json) e GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  // 3. candidate evidence: duplicate content and age relative to the archive
  await run('candidateEvidenceDuplicates', `SELECT count(*)::bigint AS rows, count(DISTINCT content_hash)::bigint AS distinct_content_hash, min(created_at)::text AS oldest, max(created_at)::text AS newest,
      count(DISTINCT frontier_id)::int AS frontiers FROM trade.canonical_strategy_candidate_evidence`);
  await run('candidateEvidenceByStorageContract', `SELECT (f.observed_at AT TIME ZONE 'America/New_York')::date::text AS day, count(*)::bigint AS rows, f.storage_contract_version AS frontier_storage_contract
    FROM trade.canonical_strategy_candidate_evidence c JOIN trade.canonical_strategy_frontier f ON f.frontier_id = c.frontier_id GROUP BY 2,3 ORDER BY 2`);
  // 4. orphans
  await run('orphans', `SELECT
      (SELECT count(*) FROM trade.candidate c WHERE NOT EXISTS (SELECT 1 FROM trade.candidate_set s WHERE s.candidate_set_id = c.candidate_set_id))::bigint AS candidates_without_set,
      (SELECT count(*) FROM trade.candidate_reason r WHERE NOT EXISTS (SELECT 1 FROM trade.candidate c WHERE c.candidate_id = r.candidate_id))::bigint AS reasons_without_candidate,
      (SELECT count(*) FROM trade.canonical_strategy_candidate_evidence e WHERE NOT EXISTS (SELECT 1 FROM trade.canonical_strategy_frontier f WHERE f.frontier_id = e.frontier_id))::bigint AS candidate_evidence_without_frontier,
      (SELECT count(*) FROM trade.decision d WHERE NOT EXISTS (SELECT 1 FROM trade.fusion_snapshot s WHERE s.fusion_snapshot_id = d.fusion_snapshot_id))::bigint AS decisions_without_snapshot`);
  // 5. observation jobs: duplicates and state mix
  await run('observationJobs', `SELECT state, count(*)::bigint AS rows FROM research.theta_execution_observation_job GROUP BY 1 ORDER BY 2 DESC`);
  await run('observationJobDuplicates', `SELECT count(*)::bigint AS rows, count(DISTINCT (candidate_id, horizon_version, contract_symbol))::bigint AS distinct_keys FROM research.theta_execution_observation_job`);
  // 6. unused indexes over 1 MiB
  await run('unusedIndexes', `SELECT s.schemaname||'.'||s.relname AS table_name, s.indexrelname AS index_name, pg_relation_size(s.indexrelid)::bigint AS bytes, s.idx_scan::bigint AS scans, i.indisunique AS is_unique, i.indisprimary AS is_primary
    FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid WHERE s.idx_scan = 0 AND pg_relation_size(s.indexrelid) > 1048576 ORDER BY 3 DESC LIMIT 15`);
  // 7. bloat indicators (stats-based; pgstattuple is not available through the provider read role)
  await run('bloatIndicators', `SELECT schemaname||'.'||relname AS table_name, n_live_tup::bigint AS live, n_dead_tup::bigint AS dead, round(100.0*n_dead_tup/GREATEST(n_live_tup+n_dead_tup,1),1)::float AS dead_pct,
      last_autovacuum::text AS last_autovacuum, last_autoanalyze::text AS last_autoanalyze, autovacuum_count::bigint, n_tup_upd::bigint AS updates, n_tup_del::bigint AS deletes
    FROM pg_stat_user_tables WHERE n_dead_tup > 100 OR n_tup_upd > 1000 ORDER BY n_dead_tup DESC LIMIT 15`);
  await run('extensions', `SELECT name FROM pg_available_extensions WHERE name IN ('pgstattuple','pg_freespacemap') ORDER BY 1`);
  await client.query('COMMIT');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ observedAt, sampleSnapshots: SAMPLE_SNAPSHOTS, results }, null, 2));
  process.stdout.write(`${JSON.stringify({ state: 'PASS', observedAt, outputPath })}\n`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ state: 'FAILED', code: (error as { code?: string }).code ?? (error as Error).message })}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
