import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { connectOwnedPostgresPool } from '../src/database/owned-pool-client.js';

test('owned pool acquisition failure closes the pool and preserves the exact cause', async () => {
  for (const closeFailure of [false, true]) {
    const failure = Object.assign(new Error('synthetic acquisition failed'), {code:'ECONNRESET'});
    let closed = 0;
    const pool = {connect:async()=>{throw failure;},end:async()=>{closed++;if(closeFailure)throw new Error('cleanup failed');}} as unknown as Pool;
    await assert.rejects(connectOwnedPostgresPool(pool), (error:unknown)=>error===failure);
    assert.equal(closed,1);
  }
});

test('successful owned acquisition does not close a client still owned by its caller', async () => {
  let closed=0;
  const client={} as PoolClient;
  const pool={connect:async()=>client,end:async()=>{closed++;}} as unknown as Pool;
  assert.equal(await connectOwnedPostgresPool(pool),client);
  assert.equal(closed,0);
});

test('all seven ephemeral preflight/import/migration acquisitions use the failure-safe owner boundary', () => {
  let sites=0;
  for(const file of ['target-migration','target-validation','target-preflight','legacy-import',
    'legacy-reconstruction-registry','local-forensic-recovery']){
    const source=readFileSync(`src/database/${file}.ts`,'utf8');
    assert.doesNotMatch(source,/await pool\.connect\(\)/);
    sites+=(source.match(/await connectOwnedPostgresPool\(pool\)/g)??[]).length;
    assert.match(source,/finally\s*\{/);
    assert.match(source,/await pool\.end\(\)/);
  }
  assert.equal(sites,7);
});
