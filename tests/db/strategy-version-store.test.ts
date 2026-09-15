import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {Pool} from 'pg';
import {resolveStrategyVersion,canonicalThetaStrategySources} from '../../src/theta/strategy-package.js';
import {registerImmutableStrategyVersion} from '../../src/theta/strategy-version-store.js';

test('persisted strategy version rejects changed immutable payload and accepts a new version',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const connectionString=process.env.TEST_DATABASE_URL;assert.ok(connectionString);const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Disposable local database only');
  const pool=new Pool({connectionString,max:1});
  try{
    const seed=canonicalThetaStrategySources[0];assert.ok(seed);const id=`test-${randomUUID()}`;
    const one=resolveStrategyVersion({...seed,strategyId:id,strategyVersion:'1.0.0'});
    assert.equal(await registerImmutableStrategyVersion(pool,one),'INSERTED');
    const changed=resolveStrategyVersion({...seed,strategyId:id,strategyVersion:'1.0.0',lattice:{...seed.lattice,dteMax:61}});
    await assert.rejects(()=>registerImmutableStrategyVersion(pool,changed),/STRATEGY_VERSION_HASH_MISMATCH/);
    const two=resolveStrategyVersion({...seed,strategyId:id,strategyVersion:'1.0.1',lattice:{...seed.lattice,dteMax:61}});
    assert.equal(await registerImmutableStrategyVersion(pool,two),'INSERTED');
    const rows=await pool.query(`SELECT semantic_version,config_hash FROM core.strategy_version WHERE semantic_version=ANY($1::text[]) ORDER BY semantic_version`,
      [[`${id}@1.0.0`,`${id}@1.0.1`]]);
    assert.equal(rows.rowCount,2);assert.equal(rows.rows[0]?.config_hash,one.configurationHash);
  }finally{await pool.end();}
});
