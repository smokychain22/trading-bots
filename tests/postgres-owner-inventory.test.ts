import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('pool inventory classifies every construction without inventing a fleet connection bound',()=>{
  const child=spawnSync(process.execPath,['--import','tsx','tools/theta-postgres-owner-inventory.ts'],
    {encoding:'utf8',timeout:30_000,maxBuffer:2*1024*1024});
  assert.equal(child.status,0,child.stderr);
  const inventory=JSON.parse(child.stdout);
  assert.equal(inventory.unclassifiedOwners,0);
  assert.equal(inventory.simultaneousGlobalMaximum,null);
  assert.equal(inventory.serverlessBudget.fleetBoundProven,false);
  assert.deepEqual(inventory.safety,{databaseConnectionsOpened:0,brokerMutations:0});
  const sources=inventory.sites.filter((site:{file:string})=>site.file.startsWith('src/'));
  assert.equal(sources.length,29,'new sites require reviewed ownership');
  for(const site of sources){
    assert.ok(site.owner.lifetime);assert.ok(site.owner.releaseOwner);assert.ok(site.owner.concurrency);
    if(site.kind==='Pool'&&!site.maximumIsParameterized)assert.ok(site.options.max>=1&&site.options.max<=3);
  }
  const runtime=readFileSync('src/theta/autonomous-runtime-handler.ts','utf8');
  assert.equal((runtime.match(/runtimePool \?\?= createRuntimePostgresPool/g)??[]).length,3);
  assert.match(readFileSync('src/worker/resident-worker.ts','utf8'),/await this\.activeCycle[\s\S]*await this\.pool\.end\(\)/);
});
