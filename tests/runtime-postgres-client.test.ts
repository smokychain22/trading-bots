import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { classifyPostgresRuntimeError, PostgresCommitOutcomeUnknownError } from '../src/theta/postgres-runtime-error.js';
import { withRuntimePostgresClient, withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../src/theta/runtime-postgres-client.js';
import { PostgresRuntimeCycleStore, safeRuntimeFailure } from '../src/theta/autonomous-runtime.js';

class FakeClient extends EventEmitter {
  readonly queries: string[] = [];
  readonly releases: boolean[] = [];
  constructor(private readonly failOn: string | null = null, private readonly failure: unknown = null) { super(); }
  async query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push(sql);
    if (sql === this.failOn) throw this.failure;
    return { rows: [], rowCount: 0 };
  }
  release(destroy = false): void { this.releases.push(destroy); }
}

const poolOf = (...clients: FakeClient[]): Pool => {
  let cursor = 0;
  return { connect: async () => clients[cursor++] as unknown as PoolClient } as Pool;
};

test('Postgres classifier distinguishes temporary availability from permanent SQL and auth faults', () => {
  assert.equal(classifyPostgresRuntimeError({ code: '57P03' }).errorClass, 'TRANSIENT_SERVER_UNAVAILABLE');
  assert.equal(classifyPostgresRuntimeError({ code: '57P01' }).retryableRead, true);
  assert.deepEqual(classifyPostgresRuntimeError({ code: '57014' }), {
    errorClass: 'QUERY_TIMEOUT', safeCode: 'POSTGRES_57014', retryableRead: true,
  });
  assert.deepEqual(classifyPostgresRuntimeError({ code: '53000' }), {
    errorClass: 'RESOURCE_QUOTA', safeCode: 'POSTGRES_53000', retryableRead: false,
  });
  assert.equal(classifyPostgresRuntimeError({ code: '25006' }).errorClass, 'READ_ONLY');
  assert.equal(classifyPostgresRuntimeError({ code: '08006' }).retryableRead, true);
  assert.equal(classifyPostgresRuntimeError({ code: 'ECONNRESET' }).errorClass, 'TRANSIENT_CONNECTION');
  assert.equal(classifyPostgresRuntimeError({ code: 'EAI_AGAIN' }).safeCode, 'POSTGRES_EAI_AGAIN');
  assert.equal(classifyPostgresRuntimeError({ code: '53300' }).errorClass, 'RESOURCE_QUOTA');
  assert.equal(classifyPostgresRuntimeError(new Error('SSL EOF; secret=never-print')).safeCode, 'POSTGRES_CONNECTION_TERMINATED');
  assert.deepEqual(classifyPostgresRuntimeError(new Error('timeout exceeded when trying to connect')), {
    errorClass:'TRANSIENT_CONNECTION',safeCode:'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT',retryableRead:true,
  });
  assert.equal(classifyPostgresRuntimeError({ code: '23505' }).retryableRead, false);
  assert.equal(classifyPostgresRuntimeError({ code: '42601' }).retryableRead, false);
  assert.equal(classifyPostgresRuntimeError({ code: '28P01' }).errorClass, 'AUTH_ERROR');
});

test('checked-out client error is handled and broken client is discarded', async () => {
  const client = new FakeClient();
  await assert.rejects(withRuntimePostgresClient(poolOf(client), async (checkedOut) => {
    checkedOut.emit('error', Object.assign(new Error('private database URL'), { code: '57P03' }));
    return 1;
  }), { code: 'POSTGRES_CHECKED_OUT_CLIENT_LOST' });
  assert.deepEqual(client.releases, [true]);
  assert.equal(client.listenerCount('error'), 0);
});

test('read retry uses a new client only for a transient failure', async () => {
  const failed = new FakeClient('SELECT 1', { code: '57P03' });
  const recovered = new FakeClient();
  const receipt = await withRuntimePostgresReadRetry(poolOf(failed, recovered), (client) => client.query('SELECT 1'),
    { delayMs: () => 0 });
  assert.equal(receipt.attemptCount, 2);
  assert.deepEqual(failed.releases, [true]);
  assert.deepEqual(recovered.releases, [false]);
  const invalid = new FakeClient('SELECT 1', { code: '42601' });
  await assert.rejects(withRuntimePostgresReadRetry(poolOf(invalid), (client) => client.query('SELECT 1'),
    { delayMs: () => 0 }), { code: '42601' });
  assert.deepEqual(invalid.releases, [false]);
});

test('fresh connection acquisition timeout is typed and never becomes a strategy result', async()=>{
  const pool={connect:async()=>{throw new Error('timeout exceeded when trying to connect');}} as unknown as Pool;
  let observed:unknown;
  try{await withRuntimePostgresClient(pool,async()=>1);}catch(error){observed=error;}
  assert.deepEqual(classifyPostgresRuntimeError(observed),{
    errorClass:'TRANSIENT_CONNECTION',safeCode:'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT',retryableRead:true,
  });
});

test('query timeout retries reads once while transfer quota and read-only failures do not loop', async () => {
  const timedOut = new FakeClient('SELECT bounded', { code: '57014' });
  const recovered = new FakeClient();
  const receipt = await withRuntimePostgresReadRetry(poolOf(timedOut, recovered),
    (client) => client.query('SELECT bounded'), { maximumAttempts: 2, delayMs: () => 0 });
  assert.equal(receipt.attemptCount, 2);
  for (const code of ['53000', '25006']) {
    const failed = new FakeClient('SELECT bulk', { code });
    await assert.rejects(withRuntimePostgresReadRetry(poolOf(failed, new FakeClient()),
      (client) => client.query('SELECT bulk'), { maximumAttempts: 3, delayMs: () => 0 }), { code });
    assert.equal(failed.queries.filter((sql) => sql === 'SELECT bulk').length, 1);
  }
});

test('transaction rolls back a pre-commit failure without retrying the write', async () => {
  const client = new FakeClient('INSERT evidence', { code: '23505' });
  await assert.rejects(withRuntimePostgresTransaction(poolOf(client), (checkedOut) => checkedOut.query('INSERT evidence')),
    { code: '23505' });
  assert.deepEqual(client.queries, ['BEGIN', 'INSERT evidence', 'ROLLBACK']);
  assert.deepEqual(client.releases, [false]);
});

test('ambiguous COMMIT requires identity reconciliation, never replays the write', async () => {
  const client = new FakeClient('COMMIT', { code: '08006' });
  const pool = poolOf(client);
  const value = await withRuntimePostgresTransaction(pool, async (checkedOut) => {
    await checkedOut.query('INSERT evidence');
    return 'stable-id';
  }, { verifyCommitted: async (_pool, outcome) => outcome === 'stable-id' });
  assert.equal(value, 'stable-id');
  assert.deepEqual(client.queries, ['BEGIN', 'INSERT evidence', 'COMMIT']);
  assert.deepEqual(client.releases, [true]);

  const uncertain = new FakeClient('COMMIT', { code: '57P03' });
  await assert.rejects(withRuntimePostgresTransaction(poolOf(uncertain), async (checkedOut) => {
    await checkedOut.query('INSERT evidence');
    return 'stable-id';
  }, { verifyCommitted: async () => false }), PostgresCommitOutcomeUnknownError);
  assert.deepEqual(uncertain.queries, ['BEGIN', 'INSERT evidence', 'COMMIT']);
  assert.deepEqual(uncertain.releases, [true]);
});

test('a rejected COMMIT discards the transaction client even when SQLSTATE is permanent', async () => {
  const client = new FakeClient('COMMIT', { code: '23503' });
  await assert.rejects(withRuntimePostgresTransaction(poolOf(client), async (checkedOut) => {
    await checkedOut.query('INSERT evidence');
    return 'stable-id';
  }), { code: '23503' });
  assert.deepEqual(client.queries, ['BEGIN', 'INSERT evidence', 'COMMIT']);
  assert.deepEqual(client.releases, [true]);
});

test('commit reconciliation propagates a deterministic conflict and supports void outcomes', async () => {
  const conflict = new FakeClient('COMMIT', { code: '08006' });
  await assert.rejects(withRuntimePostgresTransaction(poolOf(conflict), async (checkedOut) => {
    await checkedOut.query('INSERT evidence');
  }, { verifyCommitted: async () => { throw new Error('DETERMINISTIC_RECONCILIATION_CONFLICT'); } }),
  /DETERMINISTIC_RECONCILIATION_CONFLICT/);

  const confirmed = new FakeClient('COMMIT', { code: '08006' });
  await withRuntimePostgresTransaction(poolOf(confirmed), async (checkedOut) => {
    await checkedOut.query('INSERT evidence');
  }, { verifyCommitted: async () => true });
  assert.deepEqual(confirmed.releases, [true]);
});

test('a 57P03 failure is not represented as WAIT or a fabricated AEGIS veto', () => {
  assert.deepEqual(safeRuntimeFailure({ code:'57P03',message:'private URL' }), {
    code:'POSTGRES_57P03',detail:'PostgreSQL connection or service became unavailable; the decision cycle failed closed.',
  });
  assert.equal(safeRuntimeFailure(new Error('connection terminated')).code,'POSTGRES_CONNECTION_TERMINATED');
});

test('a recovered cycle marks only stale RUNNING rows failed before starting a new cycle', async () => {
  const queries: string[]=[];
  const pool={query:async (sql:string)=>{queries.push(sql);return {rowCount:1};}} as unknown as Pool;
  const started=await new PostgresRuntimeCycleStore(pool).begin('theta-runtime:2026-09-23T15:20:evidence','worker',
    '2026-09-23T15:20:00.000Z');
  assert.equal(started,true);
  assert.match(queries[0]??'',/status='FAILED'/);
  assert.match(queries[0]??'',/status='RUNNING'/);
  assert.match(queries[0]??'',/INTERRUPTED_STALE_LEASE/);
  assert.match(queries[0]??'',/interval '7 minutes'/);
  assert.match(queries[0]??'',/LIMIT 32 FOR UPDATE SKIP LOCKED/);
  assert.match(queries[1]??'',/ON CONFLICT\(correlation_id\) DO NOTHING/);
});
