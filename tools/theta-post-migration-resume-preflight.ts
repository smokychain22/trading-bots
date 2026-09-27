import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { assertPostMigrationResumeState, requiredPostMigrationVersions } from '../src/database/post-migration-resume.js';
import { classifyPostgresRelation } from '../src/storage/storage-authority-registry.js';

const environmentFile=process.argv.find((value)=>value.startsWith('--environment-file='))?.split('=',2)[1]??'.env.local';
const environment=loadEnvironmentFile(environmentFile);
if(!environment.AIVEN_DATABASE_URL)throw new Error('AIVEN_DATABASE_URL_NOT_CONFIGURED');
if(environment.MASTER_PAPER_EXECUTION_ENABLED!=='false'||environment.FOLLOWER_PAPER_EXECUTION_ENABLED!=='false'
  ||environment.PAPER_PAUSE_NEW_ORDERS!=='true')throw new Error('POST_MIGRATION_EXECUTION_FLAGS_NOT_LOCKED');
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:30_000,windowsHide:true}).trim();
const client=new pg.Client({connectionString:environment.AIVEN_DATABASE_URL,connectionTimeoutMillis:8_000,
  application_name:'theta-post-migration-resume-preflight'});
await client.connect();
try{
  const ledger=await client.query(`SELECT version,count(*)::int AS count FROM core.schema_migration
    GROUP BY version ORDER BY version`);
  const versions=ledger.rows.map((row)=>String(row.version));
  const state=await client.query(`SELECT
    (SELECT count(*)::int FROM ops.runtime_worker_lease WHERE expires_at>now()) AS active_leases,
    (SELECT pause_new_orders FROM ops.paper_execution_control WHERE singleton=true) AS paused,
    (SELECT master_execution_enabled FROM ops.paper_execution_control WHERE singleton=true) AS master_enabled,
    (SELECT follower_execution_enabled FROM ops.paper_execution_control WHERE singleton=true) AS follower_enabled,
    to_regclass('risk.aegis_iv_stress_assessment') IS NOT NULL AS risk_assessment,
    to_regclass('ops.local_observation_evidence') IS NOT NULL AS local_observation,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='trade' AND table_name='fusion_snapshot'
      AND column_name='evidence_archive_gzip') AS compressed_archive`);
  const row=state.rows[0];
  assertPostMigrationResumeState(
    ledger.rows.map((migration)=>({version:String(migration.version),count:Number(migration.count)})),
    {activeLeases:Number(row.active_leases),paused:row.paused===true,masterEnabled:row.master_enabled===true,
      followerEnabled:row.follower_enabled===true,riskAssessment:row.risk_assessment===true,
      localObservation:row.local_observation===true,compressedArchive:row.compressed_archive===true},
  );
  if(classifyPostgresRelation('risk','aegis_iv_stress_assessment').classification!=='CANONICAL_AUDIT')
    throw new Error('POST_MIGRATION_RISK_STORAGE_CLASSIFICATION_INVALID');
  console.log(JSON.stringify({contractVersion:'theta-post-migration-resume-preflight-v1',state:'PASS',sourceSha,
    schemaHead:versions.at(-1),migrationCardinality:Object.fromEntries(requiredPostMigrationVersions.map((version)=>[version,1])),
    activeLeases:0,executionLocked:true,riskStorageClassification:'CANONICAL_AUDIT',
    compressedCycleEvidence:'ENFORCED',localObservationEvidence:'ENFORCED'}));
}finally{await client.end();}
