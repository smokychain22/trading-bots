import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import {
  categoryBytes, measuredAppendRates, normalizeRelationStat,
  type AuditedRelation, type PostgresRelationStatRow,
} from '../src/storage/postgres-storage-audit.js';
import { aivenDeveloper1BootstrapStorageBudget, assessStorageBudget } from '../src/storage/storage-budget.js';

const environmentFile = process.argv.find((argument) => argument.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const configuredOutputRoot = process.argv.find((argument) => argument.startsWith('--output-root='))
  ?.slice('--output-root='.length);
const outputRoot = resolve(configuredOutputRoot ?? resolve('.theta-local-worker', 'storage-audits'));
const parquetRoot = resolve(process.argv.find((argument) => argument.startsWith('--parquet-root='))
  ?.slice('--parquet-root='.length) ?? 'C:\\ProjectBackups\\trading-bots\\research-archives');
const sqliteSpoolPath = resolve(process.argv.find((argument) => argument.startsWith('--sqlite-spool='))
  ?.slice('--sqlite-spool='.length) ?? resolve('.theta-local-worker', 'evidence-spool', 'theta-evidence.sqlite'));
const environment = loadEnvironmentFile(environmentFile);
const connectionString = environment.AIVEN_DATABASE_URL ?? environment.DATABASE_URL;
if (connectionString === undefined) throw new Error('CANONICAL_DATABASE_URL_NOT_CONFIGURED');

const relationSql = `SELECT n.nspname AS schema_name,c.relname AS relation_name,
  pg_relation_size(c.oid)::text AS table_data_bytes,
  pg_indexes_size(c.oid)::text AS index_bytes,
  CASE WHEN c.reltoastrelid=0 THEN '0' ELSE pg_total_relation_size(c.reltoastrelid)::text END AS toast_bytes,
  pg_total_relation_size(c.oid)::text AS total_relation_bytes,
  GREATEST(c.reltuples,0)::bigint::text AS row_count_estimate,
  COALESCE(s.n_live_tup,0)::text AS live_tuple_estimate,
  COALESCE(s.n_dead_tup,0)::text AS dead_tuple_estimate,
  COALESCE(s.n_tup_ins,0)::text AS inserted_since_stats_reset,
  COALESCE(s.n_tup_upd,0)::text AS updated_since_stats_reset,
  COALESCE(s.n_tup_del,0)::text AS deleted_since_stats_reset,
  s.last_vacuum,s.last_autovacuum,s.last_analyze,s.last_autoanalyze
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
WHERE c.relkind IN ('r','p','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC,n.nspname,c.relname`;

interface PriorAudit {
  readonly observedAt?: string;
  readonly relations?: readonly AuditedRelation[];
  readonly database?: { readonly databaseTotalBytes?: number };
}

interface AppendWindowRow {
  readonly qualified_name: string;
  readonly rows_last_rolling_hour: string | number;
  readonly rows_latest_observed_session: string | number;
  readonly latest_observed_session_date: string | Date | null;
  readonly session_start: string | Date | null;
  readonly session_end: string | Date | null;
}

const appendWindowSql = `WITH latest_session AS (
  SELECT max((observed_at AT TIME ZONE 'America/New_York')::date) AS session_date
  FROM trade.canonical_strategy_frontier
), bounds AS (
  SELECT session_date,
    ((session_date::timestamp + time '09:30') AT TIME ZONE 'America/New_York') AS session_start,
    ((session_date::timestamp + time '16:00') AT TIME ZONE 'America/New_York') AS session_end
  FROM latest_session
), counts AS (
  SELECT 'trade.canonical_strategy_frontier'::text AS qualified_name,
    count(*) FILTER (WHERE f.observed_at >= now() - interval '1 hour') AS rolling_hour,
    count(*) FILTER (WHERE f.observed_at >= (SELECT session_start FROM bounds) AND f.observed_at <= (SELECT session_end FROM bounds)) AS session_rows
  FROM trade.canonical_strategy_frontier f
  UNION ALL
  SELECT 'trade.canonical_strategy_candidate_evidence',
    count(*) FILTER (WHERE f.observed_at >= now() - interval '1 hour'),
    count(*) FILTER (WHERE f.observed_at >= (SELECT session_start FROM bounds) AND f.observed_at <= (SELECT session_end FROM bounds))
  FROM trade.canonical_strategy_candidate_evidence c
  JOIN trade.canonical_strategy_frontier f ON f.frontier_id=c.frontier_id
  UNION ALL
  SELECT 'trade.shadow_opportunity',
    count(*) FILTER (WHERE f.observed_at >= now() - interval '1 hour'),
    count(*) FILTER (WHERE f.observed_at >= (SELECT session_start FROM bounds) AND f.observed_at <= (SELECT session_end FROM bounds))
  FROM trade.shadow_opportunity s
  JOIN trade.canonical_strategy_frontier f ON f.fusion_snapshot_id=s.fusion_snapshot_id
  UNION ALL
  SELECT 'trade.candidate_point_in_time_evidence',
    count(*) FILTER (WHERE p.decision_time >= now() - interval '1 hour'),
    count(*) FILTER (WHERE p.decision_time >= (SELECT session_start FROM bounds) AND p.decision_time <= (SELECT session_end FROM bounds))
  FROM trade.candidate_point_in_time_evidence p
  UNION ALL
  SELECT 'trade.decision',
    count(*) FILTER (WHERE d.decided_at >= now() - interval '1 hour'),
    count(*) FILTER (WHERE d.decided_at >= (SELECT session_start FROM bounds) AND d.decided_at <= (SELECT session_end FROM bounds))
  FROM trade.decision d
)
SELECT c.qualified_name,c.rolling_hour::text AS rows_last_rolling_hour,
  c.session_rows::text AS rows_latest_observed_session,
  b.session_date::text AS latest_observed_session_date,
  b.session_start,b.session_end
FROM counts c CROSS JOIN bounds b ORDER BY c.qualified_name`;

async function latestPriorAudit(): Promise<PriorAudit | null> {
  try {
    const names = (await readdir(outputRoot)).filter((name) => name.endsWith('.json')).sort().reverse();
    const name = names[0];
    if (name === undefined) return null;
    return JSON.parse(await readFile(resolve(outputRoot, name), 'utf8')) as PriorAudit;
  } catch {
    return null;
  }
}

async function pathBytes(path: string): Promise<number | null> {
  try {
    const metadata = await stat(path);
    if (metadata.isFile()) return metadata.size;
    if (!metadata.isDirectory()) return 0;
    const entries = await readdir(path, { withFileTypes: true });
    const children = await Promise.all(entries.map((entry) => pathBytes(resolve(path, entry.name))));
    return children.reduce<number>((sum, size) => sum + (size ?? 0), 0);
  } catch {
    return null;
  }
}

const pool = new pg.Pool({
  connectionString, max: 1, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 2_000,
  application_name: 'theta-readonly-storage-audit',
  // The transaction itself is explicitly READ ONLY below. Do not override
  // default_transaction_read_only at connection time because the audit must
  // measure the provider's actual default rather than its own safety setting.
  // Scheduled only outside the supported options session. A 60-second bound
  // lets the direct timestamp-window census finish on the current 3.5 GiB
  // database without permitting an unbounded analytical query.
  options: '-c statement_timeout=60000',
});

try {
  const observedAt = new Date().toISOString();
  const client = await pool.connect();
  let relations: readonly AuditedRelation[] = [];
  let database: Record<string, unknown> = {};
  try {
    await client.query('BEGIN READ ONLY');
    const [databaseResult, relationResult] = await Promise.all([
      client.query(`SELECT pg_database_size(current_database())::text AS database_total_bytes,
        current_setting('server_version') AS server_version,
        current_setting('max_connections') AS max_connections,
        current_setting('default_transaction_read_only') AS default_transaction_read_only,
        current_setting('transaction_read_only') AS transaction_read_only,
        current_database() AS database_name`),
      client.query<PostgresRelationStatRow>(relationSql),
    ]);
    const row = databaseResult.rows[0] as Record<string, unknown>;
    const databaseName = String(row.database_name ?? '');
    database = {
      databaseIdentityHash: createHash('sha256').update(databaseName).digest('hex'),
      databaseTotalBytes: Number(row.database_total_bytes), serverVersion: row.server_version,
      providerReportedMaxConnections: Number(row.max_connections),
      defaultTransactionReadOnly: row.default_transaction_read_only,
      transactionReadOnly: row.transaction_read_only,
    };
    relations = relationResult.rows.map(normalizeRelationStat);
    const databaseTotalBytes = Number(row.database_total_bytes);
    relations = relations.map((relation) => ({ ...relation,
      percentOfDatabase: databaseTotalBytes > 0 ? relation.totalRelationBytes / databaseTotalBytes : null }));
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  let databaseActivity: Record<string, unknown> = { state: 'NOT_AVAILABLE' };
  try {
    const result = await pool.query(`SELECT stats_reset,xact_commit::text,xact_rollback::text,
      blks_read::text,blks_hit::text,temp_files::text,temp_bytes::text,deadlocks::text
      FROM pg_stat_database WHERE datname=current_database()`);
    databaseActivity = { state: 'AVAILABLE', ...(result.rows[0] as Record<string, unknown>) };
  } catch {
    databaseActivity = { state: 'PERMISSION_OR_PROVIDER_LIMITED' };
  }
  let databaseConnections: Record<string, unknown> = { state: 'NOT_AVAILABLE' };
  try {
    const result = await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE state='active')::int AS active,
      count(*) FILTER (WHERE state='idle')::int AS idle,
      count(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting
      FROM pg_stat_activity WHERE datname=current_database()`);
    databaseConnections = { state: 'AVAILABLE', ...(result.rows[0] as Record<string, unknown>) };
  } catch {
    databaseConnections = { state: 'PERMISSION_OR_PROVIDER_LIMITED' };
  }
  let statisticsConfiguration: Record<string, unknown> = { state: 'NOT_AVAILABLE' };
  try {
    const result = await pool.query('SHOW track_counts');
    statisticsConfiguration = { state: 'AVAILABLE', trackCounts: result.rows[0]?.track_counts ?? null };
  } catch {
    statisticsConfiguration = { state: 'PERMISSION_OR_PROVIDER_LIMITED' };
  }
  let directAppendWindows: Record<string, unknown> = { state: 'NOT_AVAILABLE' };
  let directAppendRows: readonly {
    readonly qualifiedName: string; readonly rowsLastRollingHour: number;
    readonly rowsLatestObservedSession: number;
  }[] = [];
  try {
    const result = await pool.query<AppendWindowRow>(appendWindowSql);
    directAppendRows = result.rows.map((row) => ({
      qualifiedName: row.qualified_name,
      rowsLastRollingHour: Number(row.rows_last_rolling_hour),
      rowsLatestObservedSession: Number(row.rows_latest_observed_session),
    }));
    directAppendWindows = {
      state: 'AVAILABLE',
      semantics: 'DIRECT_COUNTS_USING_PERSISTED_EVENT_TIMESTAMPS; LATEST_OBSERVED_NEW_YORK_CALENDAR_SESSION_NOT_EXCHANGE_CALENDAR_VALIDATED',
      relations: result.rows.map((row, index) => ({
        ...directAppendRows[index],
        latestObservedSessionDate: row.latest_observed_session_date === null ? null : String(row.latest_observed_session_date),
        sessionStart: row.session_start === null ? null : new Date(row.session_start).toISOString(),
        sessionEnd: row.session_end === null ? null : new Date(row.session_end).toISOString(),
      })),
    };
  } catch (error) {
    const errorCode = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code : 'UNCLASSIFIED';
    directAppendWindows = { state: 'PERMISSION_PROVIDER_OR_SCHEMA_LIMITED', errorCode };
  }
  let wal: Record<string, unknown> = { state: 'NOT_MEASURABLE' };
  try {
    const result = await pool.query(`SELECT wal_records::text,wal_fpi::text,wal_bytes::text,stats_reset FROM pg_stat_wal`);
    wal = { state: 'CLUSTER_CUMULATIVE_NOT_DATABASE_ATTRIBUTABLE', ...(result.rows[0] as Record<string, unknown>) };
  } catch {
    wal = { state: 'PERMISSION_OR_PROVIDER_LIMITED' };
  }

  const prior = await latestPriorAudit();
  const priorDatabaseBytes = typeof prior?.database?.databaseTotalBytes === 'number'
    ? prior.database.databaseTotalBytes : null;
  const priorObservedAt = prior?.observedAt ?? null;
  const elapsedDays = priorObservedAt === null ? null : (Date.parse(observedAt) - Date.parse(priorObservedAt)) / 86_400_000;
  const intervalGrowthMb = priorDatabaseBytes === null ? null
    : (Number(database.databaseTotalBytes) - priorDatabaseBytes) / (1024 ** 2);
  // A short catalog interval is useful as an exact delta but far too noisy
  // to annualize or extrapolate into a daily rate. Require at least one hour.
  const postgresDailyGrowthMb = priorDatabaseBytes === null || elapsedDays === null || !Number.isFinite(elapsedDays) || elapsedDays < (1 / 24)
    ? null : ((Number(database.databaseTotalBytes) - priorDatabaseBytes) / (1024 ** 2)) / elapsedDays;
  const classificationTotals = categoryBytes(relations);
  const mib = (bytes: number): number => bytes / (1024 ** 2);
  const storageTelemetry = {
    postgresTotalGb: Number(database.databaseTotalBytes) / (1024 ** 3), postgresDailyGrowthMb,
    canonicalStateMb: mib(classificationTotals.CANONICAL_TRADING_STATE + classificationTotals.CANONICAL_AUDIT),
    observationsMb: mib(classificationTotals.SHORT_RETENTION_OBSERVATION),
    researchMb: mib(classificationTotals.RESEARCH_HISTORY),
    indexesMb: mib(relations.reduce((sum, row) => sum + row.indexBytes, 0)),
    toastMb: mib(relations.reduce((sum, row) => sum + row.toastBytes, 0)),
  };
  const [parquetBytes, sqliteDatabaseBytes, sqliteWalBytes, sqliteShmBytes] = await Promise.all([
    pathBytes(parquetRoot), pathBytes(sqliteSpoolPath), pathBytes(`${sqliteSpoolPath}-wal`), pathBytes(`${sqliteSpoolPath}-shm`),
  ]);
  const sqliteSpoolBytes = [sqliteDatabaseBytes, sqliteWalBytes, sqliteShmBytes]
    .reduce<number>((sum, size) => sum + (size ?? 0), 0);
  const localStorageTelemetry = {
    parquetTotalGb: parquetBytes === null ? null : parquetBytes / (1024 ** 3),
    parquetState: parquetBytes === null ? 'PATH_NOT_AVAILABLE' : 'MEASURED_LOCAL_FILES',
    sqliteSpoolMb: sqliteSpoolBytes / (1024 ** 2),
    sqliteSpoolState: sqliteDatabaseBytes === null ? 'PATH_NOT_AVAILABLE' : 'MEASURED_SQLITE_DATABASE_WAL_AND_SHM',
    postgresFreeGb: null,
    postgresFreeGbState: 'PROVIDER_STORAGE_ALLOCATION_AND_OVERHEAD_NOT_AVAILABLE_FROM_DATABASE_CATALOG',
  };
  const appendByRelation = new Map(directAppendRows.map((row) => [row.qualifiedName, row]));
  const sessionDecisionCount = appendByRelation.get('trade.decision')?.rowsLatestObservedSession ?? null;
  const researchRowsThisSession = ['trade.canonical_strategy_candidate_evidence',
    'trade.candidate_point_in_time_evidence', 'trade.shadow_opportunity']
    .reduce((sum, relation) => sum + (appendByRelation.get(relation)?.rowsLatestObservedSession ?? 0), 0);
  const dataValueDensity = {
    state: sessionDecisionCount === null || sessionDecisionCount === 0 ? 'UNAVAILABLE_NO_DECISION_DENOMINATOR' : 'AVAILABLE',
    latestObservedSessionDecisionCount: sessionDecisionCount,
    latestObservedSessionResearchRows: sessionDecisionCount === null ? null : researchRowsThisSession,
    researchRowsPerCompletedDecision: sessionDecisionCount === null || sessionDecisionCount === 0
      ? null : researchRowsThisSession / sessionDecisionCount,
    bytesPerCompletedDecision: null,
    bytesPerCompletedDecisionState: 'UNAVAILABLE_REQUIRES_SESSION_BOUND_RELATION_BYTE_DELTAS',
  };
  const report = {
    auditVersion: 'theta-postgres-storage-audit-v1', observedAt, accessMode: 'READ_ONLY',
    measurementSemantics: {
      sizes: 'EXACT_AT_OBSERVED_AT', rowCounts: 'POSTGRES_PLANNER_ESTIMATES',
      tupleCounters: 'CUMULATIVE_SINCE_PG_STATS_RESET', deadTupleAndIndexRatios: 'BLOAT_INDICATORS_NOT_EXACT_BLOAT',
      percentOfDatabase: 'EXACT_RELATION_TOTAL_BYTES_DIVIDED_BY_EXACT_DATABASE_TOTAL_BYTES',
      lastWriteAt: 'NOT_AVAILABLE_FOR_EVERY_RELATION_FROM_STANDARD_POSTGRES_CATALOG; DIRECT_TIMESTAMP_WINDOWS_REPORTED_SEPARATELY',
      wal: 'CLUSTER_LEVEL_WHERE_PROVIDER_PERMITS_NOT_ATTRIBUTABLE_TO_ONE_DATABASE',
      appendRate: 'MEASURED_DELTA_BETWEEN_LOCAL_AUDIT_SNAPSHOTS_WHEN_COUNTERS_DID_NOT_RESET',
      dailyGrowth: 'REQUIRES_AT_LEAST_ONE_HOUR_BETWEEN_LOCAL_AUDIT_SNAPSHOTS',
    },
    database, databaseActivity, databaseConnections,
    localAuditPool: { max: 1, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
      checkoutP50Ms: null, checkoutP95Ms: null, checkoutMaxMs: null,
      checkoutLatencyState: 'NOT_INSTRUMENTED_FOR_HISTORICAL_PERCENTILES' },
    statisticsConfiguration, directAppendWindows, dataValueDensity,
    localStorageTelemetry, wal,
    totalsByClassificationBytes: classificationTotals,
    postgresTotalGb: Number(database.databaseTotalBytes) / (1024 ** 3),
    postgresDailyGrowthMb,
    measurementWindowMinutes: elapsedDays === null ? null : elapsedDays * 1_440,
    intervalGrowthMb,
    storageTelemetry,
    storageBudgetPolicy: aivenDeveloper1BootstrapStorageBudget,
    storageBudgetAssessment: assessStorageBudget(storageTelemetry, aivenDeveloper1BootstrapStorageBudget),
    measuredAppendRowsPerHourByRelation: measuredAppendRates(
      relations, observedAt, prior?.relations ?? null, prior?.observedAt ?? null,
    ),
    top30Relations: relations.slice(0, 30), relations,
    unknownClassificationCount: relations.filter((row) => row.classification === 'UNKNOWN_REQUIRES_REVIEW').length,
  };
  await mkdir(outputRoot, { recursive: true });
  const fileName = `${observedAt.replaceAll(':', '').replaceAll('.', '')}.json`;
  const csvName = fileName.replace(/\.json$/, '.top30.csv');
  await writeFile(resolve(outputRoot, fileName), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  const csvColumns = [
    'qualifiedName', 'tableDataBytes', 'indexBytes', 'toastBytes', 'totalRelationBytes', 'percentOfDatabase',
    'rowCountEstimate', 'liveTupleEstimate', 'deadTupleEstimate', 'deadTupleRatio',
    'indexToTableRatio', 'insertedSinceStatsReset', 'updatedSinceStatsReset',
    'deletedSinceStatsReset', 'classification',
  ] as const;
  const csv = [csvColumns.join(','), ...report.top30Relations.map((row) => csvColumns.map((column) => {
    const value = row[column];
    return value === null ? '' : JSON.stringify(String(value));
  }).join(','))].join('\n');
  await writeFile(resolve(outputRoot, csvName), `${csv}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ state: 'PASS', observedAt, outputFile: resolve(outputRoot, fileName),
    top30Csv: resolve(outputRoot, csvName),
    databaseTotalBytes: database.databaseTotalBytes, relationCount: relations.length,
    unknownClassificationCount: report.unknownClassificationCount,
    top30: report.top30Relations.map((row) => ({ relation: row.qualifiedName, totalRelationBytes: row.totalRelationBytes,
      classification: row.classification })) })}\n`);
} catch (error) {
  const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : 'UNCLASSIFIED_STORAGE_AUDIT_FAILURE';
  process.stdout.write(`${JSON.stringify({ state: 'EXTERNAL_BLOCKED', errorCode: /^[A-Z0-9_]+$/.test(code) ? code : 'SANITIZED_FAILURE' })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
