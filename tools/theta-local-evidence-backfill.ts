import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { LocalEvidenceSpool } from '../src/theta/local-evidence-spool.js';
import { PostgresLocalEvidenceBackfillTarget } from '../src/theta/postgres-local-evidence-backfill.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

const environmentFile=process.argv.find((argument)=>argument.startsWith('--environment-file='))
  ?.slice('--environment-file='.length)??'.env.local';
const environment=loadEnvironmentFile(environmentFile);
if(!environment.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[0-9a-f]{40}$/.test(sourceSha))throw new Error('SOURCE_SHA_INVALID');
const pool:Pool=createRuntimePostgresPool(environment.DATABASE_URL);
const spool=new LocalEvidenceSpool();
try{
  const schema=await pool.query(`SELECT to_regclass('ops.local_observation_evidence') IS NOT NULL AS ready`);
  if(schema.rows[0]?.ready!==true)throw new Error('LOCAL_EVIDENCE_POSTGRES_SCHEMA_066_REQUIRED');
  const receipt=await spool.backfill(new PostgresLocalEvidenceBackfillTarget(pool),sourceSha);
  process.stdout.write(`${JSON.stringify({state:'COMPLETE',sourceSha,...receipt})}\n`);
}finally{
  spool.close();
  await pool.end();
}
