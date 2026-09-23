import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import pino from 'pino';
import { loadEnvironment } from '../../src/config/environment.js';
import { refreshAegisIvStress } from '../../src/theta/aegis-iv-stress.js';
import type { AutonomousRuntimeReport } from '../../src/theta/autonomous-runtime.js';
import { ResidentThetaWorker } from '../../src/worker/resident-worker.js';

const connectionString = process.env.THETA_SCHEMA064_TEST_DATABASE_URL;

test('locked worker survives a real schema-064 IV persistence failure without broker mutation',
  { skip: connectionString === undefined }, async () => {
    if (connectionString === undefined) throw new Error('DISPOSABLE_DATABASE_URL_REQUIRED');
    const url = new URL(connectionString);
    assert.match(url.pathname, /^\/theta_schema064_[a-z0-9_]+$/,
      'The opt-in test may only use a disposable schema-064 database');
    assert.equal(url.hostname, '127.0.0.1');
    const pool = new pg.Pool({ connectionString, max: 2 });
    try {
      const schema = await pool.query(`SELECT
        (SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1) AS head,
        to_regclass('market.optionomics_iv_session_observation') IS NULL AS iv_table_missing,
        to_regclass('risk.aegis_iv_stress_assessment') IS NULL AS assessment_table_missing`);
      assert.equal(schema.rows[0]?.head, '064_alpaca_corporate_action_observation');
      assert.equal(schema.rows[0]?.iv_table_missing, true);
      assert.equal(schema.rows[0]?.assessment_table_missing, true);

      const before = await pool.query(`SELECT
        (SELECT count(*)::int FROM trade.order_intent) AS intents,
        (SELECT count(*)::int FROM trade.broker_order) AS broker_orders`);
      const environment = loadEnvironment({ NODE_ENV: 'test', DATABASE_URL: connectionString,
        ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
        PAPER_COPY_TOKEN_ENCRYPTION_KEY: 'disposable-test-only',
        THETA_AUTONOMOUS_WORKER_ENABLED: 'true', THETA_RUNTIME_MODE: 'MASTER_THETA_PAPER',
        MASTER_PAPER_EXECUTION_ENABLED: 'false', FOLLOWER_PAPER_EXECUTION_ENABLED: 'false',
        PAPER_PAUSE_NEW_ORDERS: 'true', THETA_PYTHON_EXECUTABLE: process.execPath,
      });
      const runner = async (): Promise<AutonomousRuntimeReport> => {
        const iv = await refreshAegisIvStress({ pool, decisionAsOf: '2026-09-23T00:00:02.000Z',
          optionomics: { apiBase: 'https://optionomics.ai', email: 'test@example.invalid',
            apiToken: 'test-only', maxRetryAttempts: 1,
            now: () => '2026-09-23T00:00:01.000Z',
            fetchImpl: async () => new Response(JSON.stringify({ date: '2026-09-22', symbol: 'SPY',
              metrics: { atm_iv: 0.2 } }), { status: 200, headers: { 'content-type': 'application/json' } }),
          },
        });
        assert.deepEqual(iv, { state: 'PERSISTENCE_ERROR', assessment: null,
          reason: 'AEGIS_IV_PERSISTENCE_42P01' });
        return { correlationId: 'schema-064-locked-test', status: 'DEGRADED',
          runtimeVersion: 'schema-064-test', policyVersion: 'test-only', jobsAttempted: 1,
          jobsCompleted: 1, jobResults: [{ jobType: 'OPPORTUNITY_SCAN', outcome: 'BLOCKED',
            status: 'DEGRADED', errorCode: iv.reason }], reconciliation: null,
          runtimeMode: 'MASTER_THETA_PAPER', executionGate: 'LOCKED',
          masterPaperOrdersSubmitted: 0, followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0 };
      };
      const worker = new ResidentThetaWorker(environment, pool, runner, pino({ level: 'silent' }));
      await worker.initialize();
      const first = await worker.runOnce();
      const second = await worker.runOnce();
      assert.equal(first?.executionGate, 'LOCKED');
      assert.equal(second?.status, 'DEGRADED');
      assert.equal(worker.snapshot().runningCycle, false);
      assert.equal(worker.snapshot().executionGate, 'LOCKED');
      const after = await pool.query(`SELECT
        (SELECT count(*)::int FROM trade.order_intent) AS intents,
        (SELECT count(*)::int FROM trade.broker_order) AS broker_orders`);
      assert.deepEqual(after.rows, before.rows);
    } finally {
      await pool.end();
    }
  });
