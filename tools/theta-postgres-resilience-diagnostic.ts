import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';

const environmentFile = process.argv.find((value) => value.startsWith('--environment-file='))?.slice('--environment-file='.length)
  ?? '.env.local';
const environment = loadEnvironmentFile(environmentFile);
if (!environment.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1,
  connectionTimeoutMillis: 5_000, options: '-c statement_timeout=4000',
  application_name: 'theta-postgres-resilience-diagnostic' });
pool.on('error', () => { /* Diagnostics never crash on an idle disconnect. */ });
try {
  const started = Date.now();
  const statsStarted = Date.now();
  const stats = await pool.query(`SELECT current_setting('default_transaction_read_only') AS default_read_only,
    current_setting('max_connections')::int AS max_connections,
    current_setting('statement_timeout') AS statement_timeout,
    pg_postmaster_start_time() AS postmaster_started,
    pg_database_size(current_database())::bigint AS database_bytes,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS active_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle') AS idle_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction') AS idle_in_transaction,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND wait_event IS NOT NULL) AS waiting_connections,
    (SELECT max(extract(epoch FROM (clock_timestamp()-query_start))*1000)::bigint FROM pg_stat_activity
      WHERE datname=current_database() AND state='active' AND pid<>pg_backend_pid()) AS longest_query_ms,
    (SELECT max(extract(epoch FROM (clock_timestamp()-xact_start))*1000)::bigint FROM pg_stat_activity
      WHERE datname=current_database() AND xact_start IS NOT NULL AND pid<>pg_backend_pid()) AS longest_transaction_ms`);
  const statsDurationMs = Date.now() - statsStarted;
  const distributionStarted = Date.now();
  const distribution = await pool.query(`SELECT coalesce(nullif(application_name,''),'UNNAMED') AS application_name,
    coalesce(state,'UNKNOWN') AS state,count(*)::int AS connection_count,
    count(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting_count
    FROM pg_stat_activity WHERE datname=current_database()
    GROUP BY coalesce(nullif(application_name,''),'UNNAMED'),coalesce(state,'UNKNOWN')
    ORDER BY connection_count DESC,application_name,state LIMIT 24`);
  const distributionDurationMs = Date.now() - distributionStarted;
  const cyclesStarted = Date.now();
  const cycles = await pool.query(`SELECT correlation_id,invoked_at,completed_at,status,error_code
    FROM ops.runtime_worker_cycle ORDER BY invoked_at DESC LIMIT 12`);
  const cyclesDurationMs = Date.now() - cyclesStarted;
  const workersStarted = Date.now();
  const workers = await pool.query(`SELECT s.build_sha,s.runtime_mode,s.state,s.last_heartbeat,s.execution_gate,
    l.expires_at AS lease_expires_at
    FROM ops.runtime_worker_status s LEFT JOIN ops.runtime_worker_lease l ON l.worker_id=s.worker_id
    ORDER BY s.last_heartbeat DESC LIMIT 3`);
  const workersDurationMs = Date.now() - workersStarted;
  console.log(JSON.stringify({ observedAt:new Date().toISOString(), state:'PASS', durationMs:Date.now()-started,
    database:stats.rows[0],pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:1},
    queryDurationsMs:{stats:statsDurationMs,applicationDistribution:distributionDurationMs,
      recentCycles:cyclesDurationMs,workers:workersDurationMs},
    applicationDistribution:distribution.rows,
    thetaPoolInventory:{residentWorkerMax:2,canonicalRuntimePoolMax:2,customerControlPoolMax:2,
      masterRoleAdministrationMax:1,diagnosticPoolMax:1,researchExportPoolMax:2,noSubmitProbePoolMax:2,
      operatorControlAdditionalRuntimePoolMax:0},
    workerResearchScheduling:{researchExport:'SERIAL_AFTER_COMPLETE_SCAN_ONCE_PER_MARKET_SESSION',
      empiricalPipeline:'SERIAL_AFTER_NEW_CONTENT_HASH',localEvidenceBundle:'SERIAL_AFTER_RESEARCH'},
    cycles:cycles.rows,workers:workers.rows }));
} catch (error) {
  const classified = classifyPostgresRuntimeError(error);
  const postgres = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
  const safe = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9_ -]{1,80}$/.test(value)
    ? value : null;
  console.log(JSON.stringify({ observedAt:new Date().toISOString(),state:'FAIL',errorClass:classified.errorClass,
    safeCode:classified.safeCode,sqlState:safe(postgres.code),severity:safe(postgres.severity),routine:safe(postgres.routine),
    operationStage:'BOUNDED_READ_ONLY_PRESSURE_DIAGNOSTIC',
    pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:1} }));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
