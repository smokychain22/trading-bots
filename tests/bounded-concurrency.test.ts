import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runWithBoundedConcurrency } from '../src/theta/bounded-concurrency.js';

test('bounded concurrent tasks complete without exceeding the declared client budget',async()=>{
  let active=0;
  let maximumActive=0;
  const results=await runWithBoundedConcurrency([0,1,2,3,4,5],2,async(value)=>{
    active++;
    maximumActive=Math.max(maximumActive,active);
    await new Promise((resolve)=>setTimeout(resolve,5));
    active--;
    return value*2;
  });
  assert.equal(maximumActive,2);
  assert.equal(active,0);
  assert.deepEqual(results,[0,2,4,6,8,10]);
});

test('bounded concurrency rejects invalid limits and propagates task failures',async()=>{
  await assert.rejects(runWithBoundedConcurrency([1],0,async(value)=>value),/BOUNDED_CONCURRENCY_INVALID/);
  await assert.rejects(runWithBoundedConcurrency([0,1,2],2,async(value)=>{
    if(value===1)throw new Error('BOUNDED_TASK_FAILED');
    return value;
  }),/BOUNDED_TASK_FAILED/);
});

test('bounded concurrency drains already-started work before propagating the first failure',async()=>{
  let active=0;
  let released=0;
  const events:string[]=[];
  await assert.rejects(runWithBoundedConcurrency([0,1,2,3],2,async(value)=>{
    active++;
    events.push(`start-${value}`);
    try{
      if(value===0){await new Promise((resolve)=>setTimeout(resolve,5));throw new Error('PRIMARY_FAILURE');}
      await new Promise((resolve)=>setTimeout(resolve,20));
      return value;
    }finally{active--;released++;events.push(`release-${value}`);}
  }),/PRIMARY_FAILURE/);
  assert.equal(active,0);
  assert.equal(released,2);
  assert.deepEqual(events.slice(0,2),['start-0','start-1']);
  assert.ok(events.includes('release-1'),'the sibling already in flight must finish before rejection');
  assert.ok(!events.includes('start-2'),'no new task starts after the first failure');
});

test('bounded concurrency preserves an explicit undefined rejection without returning partial results',async()=>{
  let resolved=false;
  try{
    await runWithBoundedConcurrency([0,1],1,async()=>{throw undefined;});
    resolved=true;
  }catch(error){assert.equal(error,undefined);}
  assert.equal(resolved,false);
});

test('database soak uses one bounded primary pool without read-retry amplification',async()=>{
  const source=await readFile(new URL('../tools/theta-postgres-stability-soak.ts',import.meta.url),'utf8');
  assert.match(source,/runWithBoundedConcurrency\([\s\S]*?primaryPoolMax,/);
  assert.doesNotMatch(source,/withRuntimePostgresReadRetry/);
  assert.match(source,/evaluatePostgresSoakAcceptance/);
  assert.match(source,/poolWaitingAfterBatch/);
  assert.match(source,/maxTransientWaitMs/);
  assert.match(source,/persistentPoolCount:1/);
  assert.match(source,/maximumSimultaneousConnectionOwnerCount:2/);
  assert.match(source,/releasedClients:releasedClients\.length\+freshProbeClosedAcquiredCount/);
  assert.equal([...source.matchAll(/createRuntimePostgresPool\(/g)].length,1,
    'one primary pool is allowed; the fresh probe is one sequential instrumented client');
});
