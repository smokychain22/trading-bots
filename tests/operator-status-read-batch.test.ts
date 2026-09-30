import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSingleFlightRead, readSequentially } from '../src/customer/operator-status-read-batch.js';

test('overlapping status readers share one bounded batch without caching completed truth',async()=>{
  const read=createSingleFlightRead<readonly number[]>();
  let active=0,maximum=0,created=0,released=0;
  const batch=()=>readSequentially(Array.from({length:7},(_,i)=>async()=>{
    created++;active++;maximum=Math.max(maximum,active);
    try {await new Promise((resolve)=>setImmediate(resolve));return i;}
    finally {active--;released++;}
  }));
  const results=await Promise.all(Array.from({length:25},()=>read('same-database',batch)));
  assert.equal(maximum,1);
  assert.equal(created,7);
  assert.equal(released,7);
  assert.equal(active,0);
  assert.deepEqual(results[0],[0,1,2,3,4,5,6]);
  await read('same-database',batch);
  assert.equal(created,14,'later request must perform fresh reads');
});

test('failed batch releases single-flight ownership and never reuses a partial result',async()=>{
  const read=createSingleFlightRead<readonly number[]>();
  let unreached=0;
  const failure=new Error('query failed');
  const batch=()=>readSequentially([async()=>{throw failure;},async()=>++unreached]);
  const results=await Promise.allSettled([read('db',batch),read('db',batch)]);
  assert.ok(results.every((r)=>r.status==='rejected'&&r.reason===failure));
  assert.equal(unreached,0);
  assert.deepEqual(await read('db',()=>readSequentially([async()=>9])),[9]);
});

test('distinct database identities never share an operator result',async()=>{
  const read=createSingleFlightRead<number>();
  assert.deepEqual(await Promise.all([read('db-a',async()=>1),read('db-b',async()=>2)]),[1,2]);
});

test('Production operator status and max-one helpers use bounded reads',()=>{
  const api=readFileSync('src/customer/api.ts','utf8');
  const helpers=readFileSync('src/customer/operator-readiness.ts','utf8');
  assert.match(api,/await statusDatabaseRead\(/);
  assert.doesNotMatch(helpers,/Promise\.all\(/);
  assert.equal((helpers.match(/finally\{await pool\.end\(\);\}/g)??[]).length,6);
});
