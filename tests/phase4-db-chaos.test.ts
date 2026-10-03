// Phase 4: database chaos matrix (fake pool/clients; no database). Every error class is driven through the read-retry, transaction, commit and
// acquisition paths. Invariants: reads retry a bounded number of times on a FRESH client and only for transient classes; a write is NEVER
// replayed; an ambiguous COMMIT is never reported as success without identity proof; a client whose connection state is unknown is destroyed,
// never returned to the pool; every checked-out client is released exactly once.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { classifyPostgresRuntimeError, PostgresCommitOutcomeUnknownError } from '../src/theta/postgres-runtime-error.js';
import { withRuntimePostgresClient, withRuntimePostgresReadRetry, withRuntimePostgresTransaction, PostgresCheckedOutClientLostError } from '../src/theta/runtime-postgres-client.js';

type Failure = unknown;
class ScriptedClient extends EventEmitter {
  readonly queries: string[] = [];
  readonly releases: boolean[] = [];
  constructor(private readonly script: (sql: string) => Failure | null = () => null) { super(); }
  async query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push(sql);
    const failure = this.script(sql);
    if (failure !== null) throw failure;
    return { rows: [], rowCount: 0 };
  }
  release(destroy = false): void { this.releases.push(destroy); }
}

function poolOf(factory: () => ScriptedClient | Promise<ScriptedClient>, clients: ScriptedClient[] = []): Pool {
  return { options: { max: 4, connectionTimeoutMillis: 8_000 }, totalCount: 0, idleCount: 0, waitingCount: 0,
    connect: async () => { const client = await factory(); clients.push(client); return client as unknown as PoolClient; } } as unknown as Pool;
}

const sqlstate = (code: string): Error => Object.assign(new Error(`synthetic ${code}`), { code });
const socket = (code: string): Error => Object.assign(new Error(`synthetic ${code}`), { code });

const MATRIX: ReadonlyArray<readonly [string, Failure, string, boolean]> = [
  // name, error, expected class, retryable for a READ
  ['57P03 database starting up', sqlstate('57P03'), 'TRANSIENT_SERVER_UNAVAILABLE', true],
  ['57P01 admin shutdown', sqlstate('57P01'), 'TRANSIENT_SERVER_UNAVAILABLE', true],
  ['57014 statement timeout', sqlstate('57014'), 'QUERY_TIMEOUT', true],
  ['08006 connection failure', sqlstate('08006'), 'TRANSIENT_CONNECTION', true],
  ['08003 connection does not exist', sqlstate('08003'), 'TRANSIENT_CONNECTION', true],
  ['ECONNRESET', socket('ECONNRESET'), 'TRANSIENT_CONNECTION', true],
  ['EPIPE', socket('EPIPE'), 'TRANSIENT_CONNECTION', true],
  ['ETIMEDOUT', socket('ETIMEDOUT'), 'TRANSIENT_CONNECTION', true],
  ['EAI_AGAIN (DNS)', socket('EAI_AGAIN'), 'TRANSIENT_CONNECTION', true],
  ['pool/connect timeout message', new Error('timeout exceeded when trying to connect'), 'TRANSIENT_CONNECTION', true],
  ['connection terminated message', new Error('Connection terminated unexpectedly'), 'TRANSIENT_CONNECTION', true],
  ['40001 serialization failure', sqlstate('40001'), 'TRANSACTION_ABORTED', false],
  ['40P01 deadlock detected', sqlstate('40P01'), 'TRANSACTION_ABORTED', false],
  ['25P02 transaction aborted', sqlstate('25P02'), 'TRANSACTION_ABORTED', false],
  ['53300 too many connections', sqlstate('53300'), 'RESOURCE_QUOTA', false],
  ['53400 configuration limit', sqlstate('53400'), 'RESOURCE_QUOTA', false],
  ['25006 read-only transaction', sqlstate('25006'), 'READ_ONLY', false],
  ['23505 unique violation', sqlstate('23505'), 'CONSTRAINT_ERROR', false],
  ['42P01 undefined table', sqlstate('42P01'), 'QUERY_ERROR', false],
  ['28P01 invalid password', sqlstate('28P01'), 'AUTH_ERROR', false],
  ['non-database error', new Error('boom'), 'UNKNOWN_DATABASE_ERROR', false],
];

test('the classifier contract is locked for every database failure class', () => {
  for (const [name, error, errorClass, retryable] of MATRIX) {
    const result = classifyPostgresRuntimeError(error);
    assert.equal(result.errorClass, errorClass, name);
    assert.equal(result.retryableRead, retryable, name);
    assert.doesNotMatch(result.safeCode, /synthetic|password|postgres:\/\//i, `${name}: the safe code must not echo error text`);
  }
});

test('READS: transient classes retry on a fresh client at most 3 times; every other class fails after exactly one attempt; every client is released once', async () => {
  for (const [name, error, , retryable] of MATRIX) {
    const clients: ScriptedClient[] = [];
    const pool = poolOf(() => new ScriptedClient((sql) => (sql === 'SELECT 1' ? error : null)), clients);
    await assert.rejects(withRuntimePostgresReadRetry(pool, async (client) => client.query('SELECT 1'), { delayMs: () => 0, random: () => 0 }), (thrown: unknown) => thrown === error || thrown instanceof Error, name);
    assert.equal(clients.length, retryable ? 3 : 1, `${name}: attempts`);
    for (const client of clients) assert.equal(client.releases.length, 1, `${name}: each client released exactly once`);
    if (retryable) for (const client of clients) assert.deepEqual(client.releases, [true], `${name}: a client that saw a transient failure must be destroyed`);
  }
});

test('READS: a transient failure followed by recovery returns the value from a fresh client (no wedge after one fault)', async () => {
  for (const [name, error, , retryable] of MATRIX.filter((row) => row[3])) {
    let call = 0;
    const clients: ScriptedClient[] = [];
    const pool = poolOf(() => new ScriptedClient((sql) => (sql === 'SELECT 1' && (call += 1) === 1 ? error : null)), clients);
    const result = await withRuntimePostgresReadRetry(pool, async (client) => { await client.query('SELECT 1'); return 'ok'; }, { delayMs: () => 0, random: () => 0 });
    assert.equal(result.value, 'ok', name);
    assert.equal(result.attemptCount, 2, name);
    assert.equal(retryable, true);
    assert.deepEqual(clients.map((client) => client.releases[0]), [true, false], `${name}: the faulted client is destroyed, the recovered one is reusable`);
  }
});

test('WRITES: a failure inside the transaction rolls back and is never replayed; the original error surfaces unchanged', async () => {
  for (const [name, error, , transient] of MATRIX) {
    const clients: ScriptedClient[] = [];
    const pool = poolOf(() => new ScriptedClient(), clients);
    let invocations = 0;
    await assert.rejects(withRuntimePostgresTransaction(pool, async () => { invocations += 1; throw error; }), (thrown: unknown) => thrown === error, name);
    assert.equal(invocations, 1, `${name}: the write operation ran more than once`);
    assert.equal(clients.length, 1, `${name}: a failed write must not check out a second client`);
    assert.ok(clients[0]?.queries.includes('ROLLBACK'), `${name}: no rollback`);
    assert.ok(!clients[0]?.queries.includes('COMMIT'), `${name}: committed a failed transaction`);
    // a transient (connection-class) failure also destroys the client: the connection itself may be the cause
    assert.deepEqual(clients[0]?.releases, [transient], `${name}: client release policy`);
  }
});

test('WRITES: when ROLLBACK itself fails the client is destroyed and the failure is a typed lost-client error, not the masked original', async () => {
  for (const [name, error] of MATRIX) {
    const clients: ScriptedClient[] = [];
    const pool = poolOf(() => new ScriptedClient((sql) => (sql === 'ROLLBACK' ? socket('ECONNRESET') : null)), clients);
    await assert.rejects(withRuntimePostgresTransaction(pool, async () => { throw error; }), PostgresCheckedOutClientLostError, name);
    assert.deepEqual(clients[0]?.releases, [true], `${name}: a client with unknown transaction state must be destroyed`);
  }
});

test('COMMIT: a transient failure at COMMIT is an UNKNOWN outcome (never success, never replayed); a definite failure surfaces as is; the client is destroyed either way', async () => {
  for (const [name, error, , retryable] of MATRIX) {
    const clients: ScriptedClient[] = [];
    const pool = poolOf(() => new ScriptedClient((sql) => (sql === 'COMMIT' ? error : null)), clients);
    let invocations = 0;
    await assert.rejects(withRuntimePostgresTransaction(pool, async () => { invocations += 1; return 'written'; }), (thrown: unknown) =>
      retryable ? thrown instanceof PostgresCommitOutcomeUnknownError : thrown === error, name);
    assert.equal(invocations, 1, `${name}: a write must never be replayed after a COMMIT failure`);
    assert.equal(clients.length, 1, name);
    assert.deepEqual(clients[0]?.releases, [true], `${name}: the commit client must be destroyed`);
  }
});

test('COMMIT: an ambiguous outcome is resolved ONLY by an identity verification that proves the write; a failed or negative verification stays unknown', async () => {
  const transient = sqlstate('57P03');
  const run = async (verify: (pool: Pool) => Promise<boolean>): Promise<unknown> => {
    const pool = poolOf(() => new ScriptedClient((sql) => (sql === 'COMMIT' ? transient : null)));
    return withRuntimePostgresTransaction(pool, async () => 'written', { verifyCommitted: verify });
  };
  assert.equal(await run(async () => true), 'written');
  await assert.rejects(run(async () => false), PostgresCommitOutcomeUnknownError);
  await assert.rejects(run(async () => { throw sqlstate('57P03'); }), PostgresCommitOutcomeUnknownError);
  await assert.rejects(run(async () => { throw sqlstate('23505'); }), (thrown: unknown) => (thrown as { code?: string }).code === '23505');
});

test('ACQUISITION / pool exhaustion: a failed checkout leaves nothing to release, is typed, and the next call works', async () => {
  let failing = true;
  const clients: ScriptedClient[] = [];
  const pool = poolOf(() => { if (failing) throw new Error('timeout exceeded when trying to connect'); return new ScriptedClient(); }, clients);
  await assert.rejects(withRuntimePostgresClient(pool, async (client) => client.query('SELECT 1')), (thrown: unknown) =>
    classifyPostgresRuntimeError(thrown).safeCode === 'POSTGRES_CONNECTION_ACQUISITION_TIMEOUT');
  assert.equal(clients.length, 0);
  failing = false;
  assert.equal(await withRuntimePostgresClient(pool, async () => 'recovered'), 'recovered');
  assert.deepEqual(clients.map((client) => client.releases), [[false]]);
});

test('CONCURRENCY: 200 interleaved operations with random failures release every client exactly once and destroy every faulted one', async () => {
  let seed = 20261004;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const clients: ScriptedClient[] = [];
  const faulted = new Set<ScriptedClient>();
  const pool = poolOf(() => {
    const client: ScriptedClient = new ScriptedClient((sql) => {
      if (sql === 'SELECT 1' && next() < 0.3) { faulted.add(client); return socket('ECONNRESET'); }
      return null;
    });
    return client;
  }, clients);
  await Promise.allSettled(Array.from({ length: 200 }, (_, index) => index % 2 === 0
    ? withRuntimePostgresClient(pool, async (client) => { await client.query('SELECT 1'); return index; })
    : withRuntimePostgresTransaction(pool, async (client) => { await client.query('SELECT 1'); return index; })));
  assert.equal(clients.length, 200);
  assert.ok(faulted.size > 20 && faulted.size < 180, 'the fault schedule must actually exercise both paths');
  for (const client of clients) {
    assert.equal(client.releases.length, 1, 'a client was released zero or several times');
    assert.equal(client.releases[0], faulted.has(client), 'exactly the faulted clients are destroyed');
  }
});
