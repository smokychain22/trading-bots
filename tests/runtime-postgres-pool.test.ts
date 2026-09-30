import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRuntimePostgresPool, containRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

test('temporary pool containment is idempotent and preserves owned connection policy', async () => {
  const codes:string[]=[];
  const pool=new Pool({max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:1000});
  const options={...pool.options};
  try {
    assert.equal(containRuntimePostgresPool(pool,code=>codes.push(code)),pool);
    containRuntimePostgresPool(pool,()=>assert.fail('second observer must not be installed'));
    assert.deepEqual(pool.options,options);
    assert.equal(pool.listenerCount('error'),1);
    assert.equal(pool.listenerCount('connect'),1);
    const client=new EventEmitter();pool.emit('connect',client as never);
    assert.doesNotThrow(()=>client.emit('error',Object.assign(new Error('private'),{code:'ECONNRESET'})));
    assert.doesNotThrow(()=>pool.emit('error',Object.assign(new Error('private'),{code:'57P03'})));
    assert.deepEqual(codes,['POSTGRES_ECONNRESET','POSTGRES_57P03']);
  } finally {await pool.end();}
});

test('every request-owned raw pool installs containment before its first operation',()=>{
  for(const file of ['src/customer/operator-readiness.ts','src/customer/database-readiness.ts',
    'src/customer/api.ts','src/theta/autonomous-runtime-handler.ts']){
    const source=readFileSync(file,'utf8');
    const creations=[...source.matchAll(/const pool\s*=\s*new Pool\([\s\S]*?\);/g)];
    assert.ok(creations.length>0,file);
    for(const match of creations){
      assert.ok(match.index!==undefined);
      assert.match(source.slice(match.index+match[0].length),/^\s*containRuntimePostgresPool\(pool\);/,file);
    }
  }
});

test('idle Postgres disconnect is handled and reported without secret-bearing error text', async () => {
  const codes: string[] = [];
  const pool = createRuntimePostgresPool('postgres://user:secret@localhost:5432/test', (code) => codes.push(code));
  try {
    assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('secret=do-not-log'), { code: '57P03' })));
    assert.deepEqual(codes, ['POSTGRES_57P03']);
    assert.doesNotThrow(() => pool.emit('error', new Error('token=do-not-log')));
    assert.deepEqual(codes, ['POSTGRES_57P03', 'POSTGRES_IDLE_CONNECTION_ERROR']);
  } finally {
    await pool.end();
  }
});

test('checked-out Postgres disconnect is handled before it can become an uncaught exception', async () => {
  const codes: string[] = [];
  const pool = createRuntimePostgresPool('postgres://user:secret@localhost:5432/test', (code) => codes.push(code));
  try {
    const checkedOut = new EventEmitter();
    pool.emit('connect', checkedOut as never);
    assert.doesNotThrow(() => checkedOut.emit('error',
      Object.assign(new Error('private database URL'), { code: '57P03' })));
    assert.deepEqual(codes, ['POSTGRES_57P03']);
  } finally {
    await pool.end();
  }
});

test('runtime pool has an explicit bounded connection budget and identity',async()=>{
  const pool=createRuntimePostgresPool('postgres://user:secret@localhost:5432/test',()=>undefined,
    {maximumConnections:2,applicationName:'theta-budget-test'});
  try{
    assert.equal(pool.options.max,2);
    assert.equal(pool.options.connectionTimeoutMillis,8_000);
    assert.equal(pool.options.idleTimeoutMillis,10_000);
    assert.equal(pool.options.maxLifetimeSeconds,60);
    assert.equal(pool.options.application_name,'theta-budget-test');
  }finally{await pool.end();}
});

test('a failing telemetry reporter cannot reintroduce uncaught idle or checked-out errors', async () => {
  const pool=createRuntimePostgresPool('postgres://synthetic@localhost/test',()=>{throw new Error('private reporter failure');});
  try {
    const client=new EventEmitter();
    pool.emit('connect',client as never);
    assert.doesNotThrow(()=>pool.emit('error',Object.assign(new Error('private'),{code:'57P03'})));
    assert.doesNotThrow(()=>client.emit('error',Object.assign(new Error('private'),{code:'ECONNRESET'})));
  } finally {await pool.end();}
});

test('invalid numeric pool options cannot silently become pg default capacity or an unbounded timeout',()=>{
  for(const value of [NaN,Infinity,-Infinity,0,-1,1.5]){
    assert.throws(()=>createRuntimePostgresPool('synthetic',undefined,{maximumConnections:value}),/POOL_MAX_INVALID/);
    assert.throws(()=>createRuntimePostgresPool('synthetic',undefined,{connectionTimeoutMillis:value}),/CONNECTION_TIMEOUT_INVALID/);
  }
});
