import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { classifyPostgresRuntimeError, PostgresCommitOutcomeUnknownError } from '../src/theta/postgres-runtime-error.js';
import { classifyPostgresAcquisitionFailure, classifyPostgresAcquisitionPath,
  withRuntimePostgresClient, withRuntimePostgresReadRetry,
  withRuntimePostgresTransaction,PostgresCheckedOutClientLostError,
  PostgresPoolWaitTimeoutError } from '../src/theta/runtime-postgres-client.js';
import type { RuntimePostgresClientObservation } from '../src/theta/runtime-postgres-client.js';
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
  return {options:{max:Math.max(1,clients.length),connectionTimeoutMillis:8_000},
    totalCount:0,idleCount:0,waitingCount:0,
    connect: async () => clients[cursor++] as unknown as PoolClient } as unknown as Pool;
};

test('observation sink failure cannot mask a committed result or original database failure',async(t)=>{
  t.mock.method(console,'warn',()=>{});
  const success=new FakeClient();
  assert.equal(await withRuntimePostgresClient(poolOf(success),async()=>42,
    {observe:()=>{throw new Error('private sink detail');}}),42);
  assert.deepEqual(success.releases,[false]);
  const failure=Object.assign(new Error('private database detail'),{code:'ECONNRESET'});
  const client=new FakeClient('SELECT 1',failure);
  await assert.rejects(withRuntimePostgresClient(poolOf(client),async(c)=>c.query('SELECT 1'),
    {observe:()=>{throw new Error('sink error');}}),(error:unknown)=>error===failure);
  assert.deepEqual(client.releases,[true]);
});

test('checked-out event preserves safe SQLSTATE and operation timing without private error text',async()=>{
  const observations:RuntimePostgresClientObservation[]=[];
  const client=new FakeClient();
  await assert.rejects(withRuntimePostgresClient(poolOf(client),async(c)=>{
    c.emit('error',Object.assign(new Error('private-host private-user'),{code:'57P01'}));
  },{observe:(o)=>observations.push(o)}),PostgresCheckedOutClientLostError);
  assert.equal(observations[0]?.sqlState,'57P01');
  assert.equal(observations[0]?.socketCode,null);
  assert.ok(observations[0]?.operationStartedAt);
  assert.ok(observations[0]?.releasedAt);
  assert.equal(observations[0]?.discarded,true);
  assert.doesNotMatch(JSON.stringify(observations),/private-host|private-user/);
});

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

test('every acquired client is observed and released on success and query failure',async()=>{
  const succeeded=new FakeClient();
  const successObservations:RuntimePostgresClientObservation[]=[];
  await withRuntimePostgresClient(poolOf(succeeded),(client)=>client.query('SELECT 1'),
    {observe:(value)=>successObservations.push(value),now:(()=>{let value=0;return()=>value+=10;})()});
  assert.deepEqual(succeeded.releases,[false]);
  assert.equal(successObservations.length,1);
  assert.equal(successObservations[0]?.outcome,'SUCCEEDED_RELEASED');
  assert.equal(successObservations[0]?.poolWaitTimeoutMillis,null);
  assert.equal(successObservations[0]?.acquisitionDurationMs,10);
  assert.equal(successObservations[0]?.operationDurationMs,10);
  assert.equal(successObservations[0]?.checkoutDurationMs,20);

  const failed=new FakeClient('SELECT broken',{code:'42601'});
  const failureObservations:RuntimePostgresClientObservation[]=[];
  await assert.rejects(withRuntimePostgresClient(poolOf(failed),(client)=>client.query('SELECT broken'),
    {observe:(value)=>failureObservations.push(value)}),{code:'42601'});
  assert.deepEqual(failed.releases,[false]);
  assert.equal(failureObservations[0]?.outcome,'OPERATION_FAILED_RELEASED');
  assert.equal(failureObservations[0]?.failureSafeCode,'POSTGRES_42601');
});

test('separate pool-wait timeout releases a client that arrives after the caller timed out',async()=>{
  class ImmediateClient extends EventEmitter{
    _queryable=true;
    _ending=false;
    connect(callback:(error?:Error)=>void):void{queueMicrotask(()=>callback());}
    end(callback?:()=>void):void{this._ending=true;queueMicrotask(()=>callback?.());}
    ref():void{}
    unref():void{}
  }
  const {Pool:RealPool}=await import('pg');
  const pool=new RealPool({Client:ImmediateClient,max:1,connectionTimeoutMillis:1_000,idleTimeoutMillis:0} as never);
  try{
    const held=await pool.connect();
    const observations:RuntimePostgresClientObservation[]=[];
    await assert.rejects(withRuntimePostgresClient(pool,async()=>1,
      {poolWaitTimeoutMillis:20,observe:(value)=>observations.push(value)}),PostgresPoolWaitTimeoutError);
    assert.equal(observations[0]?.acquisitionPath,'POOL_QUEUE');
    assert.equal(observations[0]?.acquisitionFailureClass,'POOL_QUEUE_TIMEOUT');
    assert.equal(observations[0]?.poolWaitTimerArmed,true);
    assert.equal(observations[0]?.poolWaitTimeoutMillis,20);
    held.release();
    await new Promise((resolve)=>setTimeout(resolve,10));
    assert.equal(pool.waitingCount,0);
    assert.equal(pool.idleCount,1);
  }finally{await pool.end();}
});

test('pg-pool exposes a normal next-tick pending handoff while idle clients still exist',async()=>{
  class ImmediateClient extends EventEmitter{
    _queryable=true;
    _ending=false;
    connect(callback:(error?:Error)=>void):void{queueMicrotask(()=>callback());}
    end(callback?:()=>void):void{this._ending=true;queueMicrotask(()=>callback?.());}
    ref():void{}
    unref():void{}
  }
  const {Pool:RealPool}=await import('pg');
  const pool=new RealPool({Client:ImmediateClient,max:2,connectionTimeoutMillis:1_000,idleTimeoutMillis:0} as never);
  try{
    const first=await pool.connect();
    const secondPromise=pool.connect();
    const second=await secondPromise;
    first.release();second.release();
    await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(pool.idleCount,2);
    const observations:RuntimePostgresClientObservation[]=[];
    await Promise.all([0,1].map(()=>withRuntimePostgresClient(pool,async()=>{
      await new Promise((resolve)=>setTimeout(resolve,1));
    },{poolWaitTimeoutMillis:20,observe:(value)=>observations.push(value)})));
    assert.ok(observations.some((value)=>value.poolBefore.idle>0&&value.poolBefore.waiting>0),
      'the second same-turn checkout must observe pg-pool pending the first idle-client handoff');
    assert.ok(observations.every((value)=>value.acquisitionPath==='IDLE_REUSE'));
    assert.ok(observations.every((value)=>(value.poolAfterRequest?.waiting??0)>0));
    assert.equal(pool.waitingCount,0);
    assert.equal(pool.idleCount,2);
  }finally{await pool.end();}
});

test('pool queue timeout and new-connection timeout have distinct acquisition paths',async()=>{
  const queueObservations:RuntimePostgresClientObservation[]=[];
  const queuePool={options:{max:2,connectionTimeoutMillis:5_000},totalCount:2,idleCount:0,waitingCount:4,
    connect:async()=>{throw new Error('timeout exceeded when trying to connect');}} as unknown as Pool;
  await assert.rejects(withRuntimePostgresClient(queuePool,async()=>1,{observe:(value)=>queueObservations.push(value)}),
    /timeout exceeded/);
  assert.equal(queueObservations[0]?.outcome,'ACQUISITION_FAILED');
  assert.equal(queueObservations[0]?.acquisitionPath,'POOL_QUEUE');
  assert.equal(queueObservations[0]?.acquisitionFailureClass,'POOL_QUEUE_TIMEOUT');
  assert.equal(queueObservations[0]?.physicalConnectionDurationMs,null);
  assert.equal(queueObservations[0]?.connectionTimeoutMillis,5_000);

  const connectionPool={options:{max:2,connectionTimeoutMillis:5_000},totalCount:0,idleCount:0,waitingCount:0,
    connect:async()=>{throw new Error('Connection terminated due to connection timeout');}} as unknown as Pool;
  const connectionObservations:RuntimePostgresClientObservation[]=[];
  await assert.rejects(withRuntimePostgresClient(connectionPool,async()=>1,
    {observe:(value)=>connectionObservations.push(value)}),/connection timeout/);
  assert.equal(connectionObservations[0]?.acquisitionPath,'NEW_CONNECTION');
  assert.equal(connectionObservations[0]?.acquisitionFailureClass,'PHYSICAL_CONNECTION_TIMEOUT');
  assert.equal(connectionObservations[0]?.poolQueueDurationMs,null);
  assert.equal(classifyPostgresAcquisitionPath(connectionPool,{total:0,idle:0,waiting:0},{code:'EAI_AGAIN'}),
    'NEW_CONNECTION');
  assert.equal(classifyPostgresAcquisitionPath(queuePool,{total:2,idle:0,waiting:4},
    new Error('timeout exceeded when trying to connect')),'POOL_QUEUE');
});

test('pool state, not generic pg-pool timeout text, separates a physical connect timeout from starvation',()=>{
  const pool=({options:{max:2,connectionTimeoutMillis:8_000},totalCount:1,idleCount:1,
    waitingCount:1} as unknown) as Pool;
  const before={total:1,idle:1,waiting:1};
  const generic=new Error('timeout exceeded when trying to connect');
  const path=classifyPostgresAcquisitionPath(pool,before,generic);
  assert.equal(path,'NEW_CONNECTION');
  assert.equal(classifyPostgresAcquisitionFailure(generic,path),'PHYSICAL_CONNECTION_TIMEOUT');
  assert.equal(classifyPostgresAcquisitionFailure(Object.assign(new Error('lookup failed'),{code:'EAI_AGAIN'}),path),
    'DNS_RESOLUTION_FAILURE');
  assert.equal(classifyPostgresAcquisitionFailure(Object.assign(new Error('password failed'),{code:'28P01'}),path),
    'AUTHENTICATION_FAILURE');
  assert.equal(classifyPostgresAcquisitionFailure(new Error('TLS certificate verify failed'),path),'TLS_FAILURE');
  assert.equal(classifyPostgresAcquisitionFailure(Object.assign(new Error('server warming'),{code:'57P03'}),path),
    'SERVER_REJECTION');
  assert.equal(classifyPostgresAcquisitionFailure(new Error('startup protocol failed'),path),
    'POSTGRES_STARTUP_FAILURE');
  assert.equal(classifyPostgresAcquisitionFailure(new Error('cannot use a pool after calling end'),path),
    'POOL_SHUTDOWN_FALLOUT');
});

test('slow valid query time remains checkout duration and is never acquisition failure',async()=>{
  const client=new FakeClient();
  const observations:RuntimePostgresClientObservation[]=[];
  const times=[0,10,3_010];
  await withRuntimePostgresClient(poolOf(client),async(checkedOut)=>{
    await checkedOut.query('SELECT slow but valid');
    return 1;
  },{observe:(value)=>observations.push(value),now:()=>times.shift()??3_010});
  assert.equal(observations[0]?.outcome,'SUCCEEDED_RELEASED');
  assert.equal(observations[0]?.acquisitionDurationMs,10);
  assert.equal(observations[0]?.checkoutDurationMs,3_000);
  assert.equal(observations[0]?.failureSafeCode,null);
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
  assert.deepEqual(timedOut.releases,[true]);
  assert.deepEqual(recovered.releases,[false]);
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

test('rollback failure still releases and discards the checked-out client',async()=>{
  class RollbackFailureClient extends FakeClient{
    override async query(sql:string):Promise<{rows:unknown[];rowCount:number}>{
      this.queries.push(sql);
      if(sql==='INSERT evidence')throw {code:'23505'};
      if(sql==='ROLLBACK')throw {code:'08006'};
      return {rows:[],rowCount:0};
    }
  }
  const client=new RollbackFailureClient();
  await assert.rejects(withRuntimePostgresTransaction(poolOf(client),
    (checkedOut)=>checkedOut.query('INSERT evidence')),PostgresCheckedOutClientLostError);
  assert.deepEqual(client.queries,['BEGIN','INSERT evidence','ROLLBACK']);
  assert.deepEqual(client.releases,[true]);
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

test('discard() after a SUCCESSFUL operation returns the result and destroys the client; it is not a lost-client error (the DB recovery probe depends on this)', async () => {
  const observations: RuntimePostgresClientObservation[] = [];
  const client = new FakeClient();
  const value = await withRuntimePostgresClient(poolOf(client), async (c, discard) => {
    await c.query('SELECT 1');
    discard();
    return 'probe-ok';
  }, { observe: (o) => observations.push(o) });
  assert.equal(value, 'probe-ok');
  assert.deepEqual(client.releases, [true], 'the client must be destroyed on release');
  assert.equal(observations[0]?.discarded, true);
  assert.equal(observations[0]?.outcome, 'SUCCEEDED_RELEASED');
});

test('an operation that never calls discard() releases its client for reuse', async () => {
  const client = new FakeClient();
  await withRuntimePostgresClient(poolOf(client), async (c) => c.query('SELECT 1'));
  assert.deepEqual(client.releases, [false]);
});

test('the runtime DB recovery probe still relies on discard() succeeding', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/theta/autonomous-runtime-handler.ts', import.meta.url), 'utf8');
  assert.match(source, /SELECT 1'\);\s*discard\(\);/);
});
