import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createRuntimePostgresPool } from '../../src/theta/runtime-postgres-pool.js';
import { withRuntimePostgresClient, withRuntimePostgresTransaction,
  PostgresPoolWaitTimeoutError, type RuntimePostgresClientObservation } from '../../src/theta/runtime-postgres-client.js';
import { classifyPostgresRuntimeError } from '../../src/theta/postgres-runtime-error.js';

const connectionString = process.env.THETA_RUNTIME_FAULT_DATABASE_URL;

// This suite deliberately terminates only its own backend sessions. It cannot
// run against a Production URL or an ordinary restore database.
function disposableConnection(): string {
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', ''].includes(url.hostname), 'LOCAL_DISPOSABLE_DATABASE_REQUIRED');
  assert.equal(url.pathname, '/theta_runtime_fault_ci');
  const socket = url.searchParams.get('host');
  assert.ok(socket === null || socket === '/var/run/postgresql');
  return url.toString();
}

test('real local PostgreSQL fault containment releases clients and distinguishes query failure from acquisition', {
  skip: !connectionString, timeout: 30_000,
}, async t => {
  const url = disposableConnection();
  const applicationName = `theta-fault-${randomUUID()}`;
  const poolErrors: string[] = [];
  const pool = createRuntimePostgresPool(url, code => poolErrors.push(code), {
    maximumConnections: 1, applicationName,
  });
  const control = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8_000 });
  const observations: RuntimePostgresClientObservation[] = [];
  const observe = (value: RuntimePostgresClientObservation) => observations.push(value);
  const assertDrained = async () => {
    await withRuntimePostgresClient(pool, client => client.query('SELECT 1'), { observe });
    assert.equal(pool.waitingCount, 0);
    assert.equal(pool.totalCount, pool.idleCount);
    const leaks = await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND state LIKE 'idle in transaction%'", [applicationName]);
    assert.equal(leaks.rows[0].n, 0);
  };
  try {
    await t.test('server statement timeout retains SQLSTATE 57014, never acquisition timeout', async () => {
      await assert.rejects(withRuntimePostgresClient(pool, async client => {
        await client.query("SET statement_timeout='40ms'");
        await client.query('SELECT pg_sleep(1)');
      }, { observe }), (error: unknown) => classifyPostgresRuntimeError(error).safeCode === 'POSTGRES_57014');
      const receipt = observations.at(-1);
      assert.ok(receipt);
      assert.equal(receipt.sqlState, '57014');
      assert.equal(receipt.outcome, 'OPERATION_FAILED_RELEASED');
      assert.equal(receipt.acquisitionFailureClass, null);
      assert.equal(receipt.discarded, true);
      assert.ok(receipt.releasedAt);
      await assertDrained();
    });

    await t.test('backend termination during a checked-out query is contained and the next client is fresh', async () => {
      let publishPid!: (pid: number) => void;
      const pidReady = new Promise<number>(resolve => { publishPid = resolve; });
      const operation = withRuntimePostgresClient(pool, async client => {
        const result = await client.query('SELECT pg_backend_pid() AS pid');
        publishPid(result.rows[0].pid);
        await client.query('SELECT pg_sleep(10)');
      }, { observe });
      const rejected = assert.rejects(operation, (error: unknown) =>
        ['POSTGRES_57P01', 'POSTGRES_CHECKED_OUT_CLIENT_LOST', 'POSTGRES_CONNECTION_TERMINATED'].includes(classifyPostgresRuntimeError(error).safeCode));
      const pid = await pidReady;
      const killed = await control.query('SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE pid=$1 AND application_name=$2 AND datname=current_database()', [pid, applicationName]);
      assert.equal(killed.rows[0]?.killed, true);
      await rejected;
      assert.equal(observations.at(-1)?.discarded, true);
      await assertDrained();
      const fresh = await withRuntimePostgresClient(pool, client => client.query('SELECT pg_backend_pid() AS pid'));
      assert.notEqual(fresh.rows[0].pid, pid);
    });

    await t.test('transaction error rolls back with no leaked transaction or client', async () => {
      await assert.rejects(withRuntimePostgresTransaction(pool, async client => {
        await client.query('CREATE TEMP TABLE theta_unique_probe (id integer PRIMARY KEY) ON COMMIT DROP');
        await client.query('INSERT INTO theta_unique_probe VALUES (1), (1)');
      }), { code: '23505' });
      await assertDrained();
    });

    await t.test('expired queued acquisition never invokes work and late client handoff is released', async () => {
      const held = await pool.connect();
      let invoked = false;
      try {
        await assert.rejects(withRuntimePostgresClient(pool, async () => { invoked = true; },
          { observe, poolWaitTimeoutMillis: 50 }), PostgresPoolWaitTimeoutError);
        const receipt = observations.at(-1);
        assert.ok(receipt);
        assert.equal(receipt.acquisitionFailureClass, 'POOL_QUEUE_TIMEOUT');
        assert.equal(receipt.connectionTimeoutMillis, 8_000);
      } finally { held.release(); }
      await assertDrained();
      assert.equal(invoked, false);
    });

    await t.test('idle backend termination is reported without an unhandled emitter error', async () => {
      const pidResult = await pool.query('SELECT pg_backend_pid() AS pid');
      const errorSeen = new Promise<void>(resolve => pool.once('error', () => resolve()));
      const killed = await control.query('SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE pid=$1 AND application_name=$2 AND datname=current_database()', [pidResult.rows[0].pid, applicationName]);
      assert.equal(killed.rows[0]?.killed, true);
      await errorSeen;
      assert.ok(poolErrors.includes('POSTGRES_57P01'));
      await assertDrained();
    });
    assert.equal(observations.filter(value => value.acquiredAt !== null).length,
      observations.filter(value => value.releasedAt !== null).length);
  } finally { await pool.end(); await control.end(); }
});
