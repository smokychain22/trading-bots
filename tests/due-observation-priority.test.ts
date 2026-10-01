import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { observationFreshWindowSeconds, processDueExecutionObservations } from '../src/research/production-shadow-runtime.js';

test('due-observation batch selects still-observable jobs before an unrecoverable backlog, never oldest-first only', async () => {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  const now = '2026-10-01T19:00:00.000Z';
  const stale = { observation_job_id: 'job-stale', candidate_id: 'c', contract_symbol: 'X', horizon_code: '1M',
    target_at: '2026-10-01T18:50:00.000Z', underlying: 'SPY', option_type: 'put' };
  const pool = { query: async (sql: string, values: readonly unknown[] = []) => {
    queries.push({ sql, values });
    return /FROM research\.theta_execution_observation_job j/.test(sql) ? { rows: [stale], rowCount: 1 } : { rows: [], rowCount: 1 };
  } } as unknown as Pool;
  const report = await processDueExecutionObservations({ pool, alpaca: {} as never, now: () => now });
  const select = queries[0];
  assert.ok(select !== undefined);
  assert.match(select.sql, /ORDER BY \(j\.target_at > \$1::timestamptz - make_interval\(secs => \$2\)\) DESC, j\.target_at/);
  assert.deepEqual(select.values, [now, observationFreshWindowSeconds]);
  assert.equal(observationFreshWindowSeconds, 120);
  assert.equal(report.observed, 0, 'a job 10 minutes past its target is not a valid observation of that target');
  assert.equal(report.missed, 1);
  assert.ok(queries.slice(1).some((query) => query.values.includes('OBSERVATION_MISSED_NO_ACTIVE_WORKER')),
    'the stale job is closed with an explicit reason, never silently observed late or dropped');
});
