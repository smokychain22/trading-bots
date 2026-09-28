import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Pool } from 'pg';
import { runWithBoundedConcurrency } from '../src/theta/bounded-concurrency.js';
import { classifyPostgresAcquisitionPath,withRuntimePostgresClient } from '../src/theta/runtime-postgres-client.js';

class ImmediatePoolClient extends EventEmitter{
  _queryable=true;
  _ending=false;
  connect(callback:(error?:Error)=>void):void{queueMicrotask(()=>callback());}
  end(callback?:()=>void):void{this._ending=true;queueMicrotask(()=>callback?.());}
  ref():void{}
  unref():void{}
}

function deterministicPool(connectionTimeoutMillis:number):Pool{
  return new Pool({Client:ImmediatePoolClient,max:2,connectionTimeoutMillis,idleTimeoutMillis:0} as never);
}

test('pg-pool uses connectionTimeoutMillis for a saturated pending queue',async()=>{
  const pool=deterministicPool(25);
  try{
    const first=await pool.connect();
    const second=await pool.connect();
    assert.equal(pool.totalCount,2);
    const before={total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount};
    const queued=pool.connect();
    assert.equal(pool.waitingCount,1);
    await assert.rejects(queued,/timeout exceeded when trying to connect/);
    assert.equal(classifyPostgresAcquisitionPath(pool,before,
      new Error('timeout exceeded when trying to connect')),'POOL_QUEUE');
    assert.equal(pool.waitingCount,0);
    first.release();
    second.release();
  }finally{await pool.end();}
});

test('bounded work equal to pool capacity completes without pending waiters',async()=>{
  const pool=deterministicPool(25);
  let maxWaiting=0;
  try{
    const results=await runWithBoundedConcurrency([0,1,2,3,4,5],2,async(value)=>{
      return withRuntimePostgresClient(pool,async()=>{
        maxWaiting=Math.max(maxWaiting,pool.waitingCount);
        await new Promise((resolve)=>setTimeout(resolve,5));
        return value;
      });
    });
    assert.deepEqual(results,[0,1,2,3,4,5]);
    assert.equal(maxWaiting,0);
    assert.equal(pool.waitingCount,0);
    assert.equal(pool.idleCount,2);
  }finally{await pool.end();}
});

test('old six-on-two soak pattern deterministically creates its own queue timeout',async()=>{
  const pool=deterministicPool(50);
  let maxWaiting=0;
  try{
    const operations=Array.from({length:6},async()=>withRuntimePostgresClient(pool,async()=>{
      maxWaiting=Math.max(maxWaiting,pool.waitingCount);
      await new Promise((resolve)=>setTimeout(resolve,30));
      return 1;
    }));
    await new Promise((resolve)=>setTimeout(resolve,5));
    maxWaiting=Math.max(maxWaiting,pool.waitingCount);
    const settled=await Promise.allSettled(operations);
    assert.equal(maxWaiting,4);
    assert.ok(settled.some((value)=>value.status==='rejected'
      &&/timeout exceeded when trying to connect/.test(String(value.reason))));
    assert.equal(pool.waitingCount,0);
  }finally{await pool.end();}
});
