import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { summarizeAegisBaselineProgress } from '../src/theta/aegis-baseline-progress.js';

const environmentFile = process.argv.find((arg) => arg.startsWith('--environment-file='))
  ?.slice('--environment-file='.length) ?? '.env.local';
const environment = loadEnvironmentFile(environmentFile);
if (!environment.DATABASE_URL) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1,
  connectionTimeoutMillis: 5_000, options: '-c statement_timeout=5000',
  application_name: 'theta-aegis-baseline-progress-read-only' });
pool.on('error', () => { process.exitCode = 1; });
try {
  const result = await pool.query(`SELECT decision_time,snapshot_json->'riskState' AS risk_state,
    snapshot_json->'regimeState' AS regime_state FROM trade.fusion_snapshot
    ORDER BY decision_time DESC LIMIT 1`);
  const row = result.rows[0];
  console.log(JSON.stringify(summarizeAegisBaselineProgress({
    decisionAsOf: row?.decision_time instanceof Date ? row.decision_time.toISOString() : null,
    riskState: row?.risk_state ?? null, regimeState: row?.regime_state ?? null,
  })));
} catch {
  console.log(JSON.stringify({ state: 'DATABASE_UNAVAILABLE', authority: 'EXPLAINABILITY_ONLY' }));
  process.exitCode = 1;
} finally { await pool.end().catch(() => { process.exitCode = 1; }); }
