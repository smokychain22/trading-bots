import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import { observationFreshWindowSeconds, observationMarksTickIntervalSeconds, observationRetryReserveSeconds,
  processDueExecutionObservations } from '../src/research/production-shadow-runtime.js';

const NOW = '2026-10-01T15:00:00.000Z';
const targetAgo = (milliseconds: number): string => new Date(Date.parse(NOW) - milliseconds).toISOString();

function harness(ageMilliseconds: number, providerStatus: number) {
  const updates: { sql: string; values: readonly unknown[] }[] = [];
  const job = { observation_job_id: 'job-1', candidate_id: 'c', contract_symbol: 'SPY261120P00600000', horizon_code: '1M',
    target_at: targetAgo(ageMilliseconds), underlying: 'SPY', option_type: 'put' };
  const pool = { query: async (sql: string, values: readonly unknown[] = []) => {
    if (/SELECT j\.observation_job_id/.test(sql)) return { rows: [job], rowCount: 1 };
    updates.push({ sql, values });
    return { rows: [], rowCount: 1 };
  } } as unknown as Pool;
  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'K', apiSecret: 'S', fetchImpl: (async () => new Response('{}', { status: providerStatus })) as typeof fetch };
  return { pool, alpaca, updates };
}

test('timing constants keep at least two attempts inside the observable window', () => {
  assert.equal(observationFreshWindowSeconds, 120);
  assert.ok(observationMarksTickIntervalSeconds * 2 + observationRetryReserveSeconds >= observationFreshWindowSeconds - 5,
    'tick interval must allow a retry before the window closes');
  assert.ok(observationMarksTickIntervalSeconds < observationFreshWindowSeconds / 2);
  assert.ok(observationRetryReserveSeconds < observationFreshWindowSeconds);
});

test('a transient provider failure inside the retry budget leaves the mark PENDING for the next tick, never MISSED', async () => {
  const { pool, alpaca, updates } = harness(10_000, 503);
  const report = await processDueExecutionObservations({ pool, alpaca, now: () => NOW });
  assert.equal(report.deferred, 1);
  assert.equal(report.missed, 0);
  assert.equal(report.observed, 0);
  assert.equal(updates.length, 0, 'no terminal write happened');
});

test('the retry budget boundary is exact: 75.000 s old is still deferred, 75.001 s old becomes MISSED with an explicit reason', async () => {
  const edge = (observationFreshWindowSeconds - observationRetryReserveSeconds) * 1000;
  const retry = harness(edge, 503);
  assert.equal((await processDueExecutionObservations({ pool: retry.pool, alpaca: retry.alpaca, now: () => NOW })).deferred, 1);
  const spent = harness(edge + 1, 503);
  const report = await processDueExecutionObservations({ pool: spent.pool, alpaca: spent.alpaca, now: () => NOW });
  assert.equal(report.deferred, 0);
  assert.equal(report.missed, 1);
  assert.ok(spent.updates.some((update) => /status='MISSED'/.test(update.sql)));
});

test('a job past the observable window is closed as MISSED regardless of provider health (no late mark is passed off as on-time)', async () => {
  const { pool, alpaca, updates } = harness((observationFreshWindowSeconds + 1) * 1000, 200);
  const report = await processDueExecutionObservations({ pool, alpaca, now: () => NOW });
  assert.equal(report.missed, 1);
  assert.equal(report.observed, 0);
  assert.ok(updates.some((update) => update.values.includes('OBSERVATION_MISSED_NO_ACTIVE_WORKER')));
});
