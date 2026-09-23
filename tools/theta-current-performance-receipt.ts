import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { hashJson, type JsonValue } from '../src/market/fusion-snapshot.js';

const root = resolve(process.cwd());
const environmentFile = process.argv.find((argument) => argument.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const environment = loadEnvironmentFile(resolve(root, environmentFile), {});
if (!environment.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');

function quantile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * fraction) - 1] ?? null;
}

function latency(values: readonly number[]): { p50: number | null; p90: number | null; p95: number | null; p99: number | null } {
  return { p50: quantile(values, 0.5), p90: quantile(values, 0.9),
    p95: quantile(values, 0.95), p99: quantile(values, 0.99) };
}

const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 8_000,
  application_name: 'theta_current_performance_receipt',
});
try {
  const client = await pool.connect();
  try {
    const database = await client.query<{
      database_bytes: string; active_connections: string; max_connections: string;
      read_only: string; default_read_only: string;
    }>(`SELECT pg_database_size(current_database())::text AS database_bytes,
      (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database())::text AS active_connections,
      current_setting('max_connections') AS max_connections,
      current_setting('transaction_read_only') AS read_only,
      current_setting('default_transaction_read_only') AS default_read_only`);
    await client.query('BEGIN TRANSACTION READ ONLY');
    const tables = await client.query<{
      schema_name: string; table_name: string; total_bytes: string; estimated_rows: string;
    }>(`SELECT n.nspname AS schema_name,c.relname AS table_name,
      pg_total_relation_size(c.oid)::text AS total_bytes,
      greatest(c.reltuples::bigint,0)::text AS estimated_rows
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('trade','market','research','ops','core') AND c.relkind IN ('r','p','m')
      ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15`);
    const worker = await client.query<{
      invoked_at: Date; completed_at: Date | null; status: string;
      jobs_attempted: number; jobs_completed: number; error_code: string | null;
    }>(`SELECT invoked_at,completed_at,status,jobs_attempted,jobs_completed,error_code
      FROM ops.runtime_worker_cycle ORDER BY invoked_at DESC LIMIT 100`);
    const connections = await client.query<{ provider_connection_id: string; provider_code: string }>(
      `SELECT provider_connection_id::text,provider_code::text FROM core.provider_connection
       WHERE provider_code IN ('ALPACA','OPTIONOMICS')`,
    );
    const providerRequests: {
      provider: string; operation: string; sampleCount: number; successCount: number;
      failureCount: number; timeoutCount: number; latencyMs: ReturnType<typeof latency>;
    }[] = [];
    const optionomicsObservations = await client.query<{
      operation_alias: string; http_status: number | null;
      requested_at: Date | null; ingestion_timestamp: Date;
    }>(`SELECT operation_alias,http_status,requested_at,ingestion_timestamp
      FROM market.optionomics_raw_observation ORDER BY created_at DESC LIMIT 500`);
    for (const connection of connections.rows) {
      const requests = await client.query<{
        operation_alias: string; status_code: number | null; latency_ms: number | null; error_code: string | null;
      }>(`SELECT operation_alias,status_code,latency_ms,error_code FROM core.provider_request
          WHERE provider_connection_id=$1 ORDER BY requested_at DESC LIMIT 500`,
      [connection.provider_connection_id]);
      const aliases = [...new Set(requests.rows.map((row) => row.operation_alias))].sort();
      for (const operation of aliases) {
        const rows = requests.rows.filter((row) => row.operation_alias === operation);
        providerRequests.push({
          provider: connection.provider_code, operation, sampleCount: rows.length,
          successCount: rows.filter((row) => row.status_code !== null && row.status_code >= 200 && row.status_code < 300).length,
          failureCount: rows.filter((row) => row.status_code !== null && row.status_code >= 400).length,
          timeoutCount: rows.filter((row) => typeof row.error_code === 'string' && /TIMEOUT/i.test(row.error_code)).length,
          latencyMs: latency(rows.map((row) => row.latency_ms).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)),
        });
      }
    }
    const optionomicsRequestSamples = [...new Set(optionomicsObservations.rows.map((row) => row.operation_alias))]
      .sort().map((operation) => {
        const rows = optionomicsObservations.rows.filter((row) => row.operation_alias === operation);
        const elapsed = rows.flatMap((row) => row.requested_at === null ? []
          : [new Date(row.ingestion_timestamp).getTime() - new Date(row.requested_at).getTime()])
          .filter((value) => Number.isFinite(value) && value >= 0);
        return {
          operation, sampleCount: rows.length,
          successCount: rows.filter((row) => row.http_status !== null && row.http_status >= 200 && row.http_status < 300).length,
          failureCount: rows.filter((row) => row.http_status !== null && row.http_status >= 400).length,
          unknownHttpStatusCount: rows.filter((row) => row.http_status === null).length,
          requestToIngestionMs: latency(elapsed),
          latencySemantic: 'REQUEST_TO_PERSISTED_INGESTION_NOT_PURE_HTTP' as const,
        };
      });
    await client.query('COMMIT');
    const db = database.rows[0];
    if (!db) throw new Error('DATABASE_PERFORMANCE_PROBE_EMPTY');
    const cycleDurations = worker.rows.flatMap((row) => row.completed_at === null ? []
      : [new Date(row.completed_at).getTime() - new Date(row.invoked_at).getTime()])
      .filter((value) => Number.isFinite(value) && value >= 0);
    const oldestCycle = worker.rows.at(-1);
    const newestCycle = worker.rows[0];
    const body = {
      contractVersion: 'theta-current-performance-receipt-v1',
      generatedAt: new Date().toISOString(),
      database: {
        sizeBytes: Number(db.database_bytes),
        activeConnections: Number(db.active_connections),
        maxConnections: Number(db.max_connections),
        transactionReadOnly: db.read_only,
        defaultTransactionReadOnly: db.default_read_only,
        largestTables: tables.rows.map((row) => ({
          schema: row.schema_name, table: row.table_name,
          totalBytes: Number(row.total_bytes), estimatedRows: Number(row.estimated_rows),
        })),
      },
      workerCycles: {
        sampleCount: worker.rows.length,
        statusCounts: Object.fromEntries([...new Set(worker.rows.map((row) => row.status))].sort().map((status) =>
          [status, worker.rows.filter((row) => row.status === status).length])),
        errorCodeCounts: Object.fromEntries([...new Set(worker.rows.map((row) => row.error_code).filter((code): code is string => code !== null))]
          .sort().map((code) => [code, worker.rows.filter((row) => row.error_code === code).length])),
        attemptedJobs: worker.rows.reduce((sum, row) => sum + row.jobs_attempted, 0),
        completedJobs: worker.rows.reduce((sum, row) => sum + row.jobs_completed, 0),
        durationMs: latency(cycleDurations),
        earliestInvokedAt: oldestCycle ? new Date(oldestCycle.invoked_at).toISOString() : null,
        latestInvokedAt: newestCycle ? new Date(newestCycle.invoked_at).toISOString() : null,
      },
      coreProviderRequestCoverage: providerRequests.length === 0 ? 'NO_CORE_PROVIDER_REQUEST_SAMPLE' : 'BOUNDED_CORE_REQUEST_SAMPLE',
      providerRequests,
      optionomicsRawObservationCoverage: optionomicsRequestSamples.length === 0
        ? 'NO_OPTIONOMICS_RAW_OBSERVATION_SAMPLE' : 'BOUNDED_RAW_OBSERVATION_SAMPLE',
      optionomicsRawSampleSelection: 'PERSISTED_OBSERVATIONS_ONLY_NOT_ALL_REQUEST_ATTEMPTS',
      optionomicsRequestSamples,
      unavailableMetrics: [
        'PIPELINE_STAGE_DURATION_DISTRIBUTION', 'DATABASE_CONNECTION_ACQUISITION_LATENCY',
        'QUERY_LATENCY_DISTRIBUTION', 'WORKER_RSS_MEMORY_DISTRIBUTION', 'WORKER_CPU_DURATION',
        'FINALIST_REFRESH_LATENCY_DISTRIBUTION', 'PRE_SUBMIT_QUOTE_AGE_DISTRIBUTION',
      ],
      brokerAuthority: false,
    } as const;
    const contentHash = hashJson(body as unknown as JsonValue);
    const outputDir = resolve(root, 'research_exports', 'performance');
    await mkdir(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, `${contentHash}.json`);
    await writeFile(outputPath, `${JSON.stringify({ ...body, contentHash }, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({
      state: 'CAPTURED', path: outputPath, databaseSizeBytes: body.database.sizeBytes,
      activeConnections: body.database.activeConnections, maxConnections: body.database.maxConnections,
      workerCycleSample: body.workerCycles.sampleCount, workerDurationP95Ms: body.workerCycles.durationMs.p95,
      coreProviderOperationSamples: providerRequests.length,
      optionomicsRawOperationSamples: optionomicsRequestSamples.length,
      unavailableMetrics: body.unavailableMetrics,
      brokerAuthority: false, orderSubmission: 'DISABLED',
    })}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  const code = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : null;
  const state = code === 'EAI_AGAIN' ? 'DATABASE_DNS_TEMPORARY'
    : code === '57P03' ? 'DATABASE_STARTING'
      : code === '57014' ? 'DATABASE_QUERY_TIMEOUT' : 'DATABASE_READ_UNAVAILABLE';
  process.stderr.write(`${JSON.stringify({ state: 'UNAVAILABLE', errorClass: state,
    brokerAuthority: false, orderSubmission: 'DISABLED' })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
