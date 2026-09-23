import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';

const environment = loadEnvironmentFile('.env.local');
if (!environment.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1,
  connectionTimeoutMillis: 5_000, options: '-c statement_timeout=4000',
  application_name: 'theta-postgres-resilience-diagnostic' });
pool.on('error', () => { /* Diagnostics never crash on an idle disconnect. */ });
try {
  const started = Date.now();
  const stats = await pool.query(`SELECT current_setting('default_transaction_read_only') AS default_read_only,
    current_setting('max_connections')::int AS max_connections,
    current_setting('statement_timeout') AS statement_timeout,
    pg_postmaster_start_time() AS postmaster_started,
    pg_database_size(current_database())::bigint AS database_bytes,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS active_connections,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle') AS idle_connections`);
  const cycles = await pool.query(`SELECT correlation_id,invoked_at,completed_at,status,error_code
    FROM ops.runtime_worker_cycle ORDER BY invoked_at DESC LIMIT 12`);
  const workers = await pool.query(`SELECT s.build_sha,s.runtime_mode,s.state,s.last_heartbeat,s.execution_gate,
    l.expires_at AS lease_expires_at
    FROM ops.runtime_worker_status s LEFT JOIN ops.runtime_worker_lease l ON l.worker_id=s.worker_id
    ORDER BY s.last_heartbeat DESC LIMIT 3`);
  console.log(JSON.stringify({ observedAt:new Date().toISOString(), state:'PASS', durationMs:Date.now()-started,
    database:stats.rows[0],pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:1},
    cycles:cycles.rows,workers:workers.rows }));
} catch (error) {
  const classified = classifyPostgresRuntimeError(error);
  console.log(JSON.stringify({ observedAt:new Date().toISOString(),state:'FAIL',errorClass:classified.errorClass,
    safeCode:classified.safeCode,pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:1} }));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
