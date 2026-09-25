import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';
import { decodeCycleEvidenceArchive, postgresCycleEvidenceStorageVersion } from '../src/theta/postgres-cycle-evidence-storage.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';
import { withRuntimePostgresClient, withRuntimePostgresReadRetry } from '../src/theta/runtime-postgres-client.js';

const environmentFile=process.argv.find((value)=>value.startsWith('--environment-file='))?.split('=',2)[1]??'.env.local';
const durationArg=process.argv.find((value)=>value.startsWith('--duration-seconds='))?.split('=',2)[1];
const parsedDuration=Number(durationArg??900);
if(!Number.isFinite(parsedDuration))throw new Error('SOAK_DURATION_INVALID');
const durationSeconds=Math.max(120,Math.min(3_600,Math.trunc(parsedDuration)));
const environment=loadEnvironmentFile(environmentFile);
if(!environment.DATABASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');

const safeErrors:string[]=[];
const pool=createRuntimePostgresPool(environment.DATABASE_URL,(code)=>safeErrors.push(code),
  {maximumConnections:2,applicationName:'theta-db-stability-soak',connectionTimeoutMillis:5_000});
const startedAt=new Date().toISOString();
const deadline=Date.now()+durationSeconds*1_000;
let iterations=0;
let reads=0;
let freshAcquisitions=0;
let maxPoolTotal=0;
let maxPoolWaiting=0;
let maxDatabaseConnections=0;
let maxActiveConnections=0;
let maxIdleConnections=0;
let maxIdleInTransaction=0;
let maxWaitingSessions=0;
let unclassifiedErrors=0;
let lastSafeCode:string|null=null;
let rollbackSafeWrites=0;
let snapshotPersistenceProofs=0;
let archiveReconstructionProofs=0;
let recoveredReadRetries=0;
let initialPostmasterStartedAt:string|null=null;
let postmasterRestartDetected=false;
const queryLatenciesMs:number[]=[];

const sha256=(value:string|Buffer):string=>createHash('sha256').update(value).digest('hex');

async function proveSnapshotPersistenceAndArchiveReconstruction():Promise<void>{
  const latest=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT
    fusion_snapshot_id,snapshot_json,content_hash
    FROM trade.fusion_snapshot ORDER BY decision_time DESC LIMIT 1`),{maximumAttempts:2});
  if(latest.attemptCount>1)recoveredReadRetries++;
  const row=latest.value.rows[0] as {fusion_snapshot_id?:unknown;snapshot_json?:unknown;content_hash?:unknown}|undefined;
  if(row===undefined||typeof row.content_hash!=='string'||row.snapshot_json===null||typeof row.snapshot_json!=='object'){
    throw new Error('SOAK_SOURCE_SNAPSHOT_UNAVAILABLE');
  }
  const archiveJson=JSON.stringify({contractVersion:postgresCycleEvidenceStorageVersion,
    snapshotContentHash:row.content_hash,snapshot:row.snapshot_json,strategyFrontier:null,thetaQ:null,
    decisionReceipt:null,shadowOpportunities:[]});
  const archive=gzipSync(Buffer.from(archiveJson),{level:9});
  const archiveHash=sha256(archiveJson);
  await withRuntimePostgresClient(pool,async(client)=>{
    let transactionOpen=false;
    try{
      await client.query('BEGIN');transactionOpen=true;
      await client.query(`CREATE TEMP TABLE theta_soak_fusion_snapshot
        (LIKE trade.fusion_snapshot INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING CONSTRAINTS) ON COMMIT DROP`);
      await client.query(`INSERT INTO theta_soak_fusion_snapshot SELECT * FROM trade.fusion_snapshot
        WHERE fusion_snapshot_id=$1`,[row.fusion_snapshot_id]);
      const written=await client.query(`UPDATE theta_soak_fusion_snapshot SET
        storage_contract_version=$2,evidence_archive_gzip=$3,evidence_archive_hash=$4,
        evidence_archive_uncompressed_bytes=$5,evidence_archive_compressed_bytes=$6
        WHERE fusion_snapshot_id=$1 RETURNING evidence_archive_gzip,evidence_archive_hash`,
      [row.fusion_snapshot_id,postgresCycleEvidenceStorageVersion,archive,archiveHash,
        Buffer.byteLength(archiveJson),archive.byteLength]);
      const persisted=written.rows[0] as {evidence_archive_gzip?:unknown;evidence_archive_hash?:unknown}|undefined;
      if(persisted===undefined||!Buffer.isBuffer(persisted.evidence_archive_gzip)
        ||persisted.evidence_archive_hash!==archiveHash)throw new Error('SOAK_SNAPSHOT_PERSISTENCE_FAILED');
      const reconstructed=decodeCycleEvidenceArchive(persisted.evidence_archive_gzip);
      if(reconstructed.snapshotContentHash!==row.content_hash||sha256(archiveJson)!==archiveHash){
        throw new Error('SOAK_ARCHIVE_RECONSTRUCTION_FAILED');
      }
      snapshotPersistenceProofs++;
      archiveReconstructionProofs++;
      await client.query('ROLLBACK');transactionOpen=false;
    }finally{
      if(transactionOpen)await client.query('ROLLBACK').catch(()=>undefined);
    }
  });
}

async function proveRollbackSafeWrite(iteration:number):Promise<void>{
  await withRuntimePostgresClient(pool,async(client)=>{
    let transactionOpen=false;
    try{
      await client.query('BEGIN');transactionOpen=true;
      await client.query('CREATE TEMP TABLE theta_soak_write_probe(iteration integer NOT NULL) ON COMMIT DROP');
      await client.query('INSERT INTO theta_soak_write_probe(iteration) VALUES($1)',[iteration]);
      const readback=await client.query('SELECT iteration FROM theta_soak_write_probe');
      if(Number(readback.rows[0]?.iteration)!==iteration)throw new Error('SOAK_WRITE_READBACK_FAILED');
      await client.query('ROLLBACK');transactionOpen=false;
      rollbackSafeWrites++;
    }finally{
      if(transactionOpen)await client.query('ROLLBACK').catch(()=>undefined);
    }
  });
}

function percentile(values:readonly number[],fraction:number):number|null{
  if(values.length===0)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return Number(sorted[Math.min(sorted.length-1,Math.floor(fraction*sorted.length))]!.toFixed(3));
}

try{
  await proveSnapshotPersistenceAndArchiveReconstruction();
  while(Date.now()<deadline){
    const iterationStarted=performance.now();
    const concurrentReads=Array.from({length:6},async(_,index)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(
        'SELECT $1::int AS ordinal,pg_sleep(0.025)',[index]),{maximumAttempts:2});
      return receipt.attemptCount;
    });
    await new Promise((resolve)=>setTimeout(resolve,5));
    maxPoolTotal=Math.max(maxPoolTotal,pool.totalCount);
    maxPoolWaiting=Math.max(maxPoolWaiting,pool.waitingCount);
    const results=await Promise.all(concurrentReads);
    recoveredReadRetries+=results.filter((attemptCount)=>attemptCount>1).length;
    reads+=results.length;
    const stats=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS active,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle') AS idle,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction') AS idle_in_transaction,
      (SELECT count(*)::int FROM pg_stat_activity
        WHERE datname=current_database() AND state='active' AND wait_event IS NOT NULL) AS waiting_sessions,
      pg_postmaster_start_time()::text AS postmaster_started_at`),
    {maximumAttempts:2});
    if(stats.attemptCount>1)recoveredReadRetries++;
    reads++;
    maxDatabaseConnections=Math.max(maxDatabaseConnections,Number(stats.value.rows[0]?.connections??0));
    maxActiveConnections=Math.max(maxActiveConnections,Number(stats.value.rows[0]?.active??0));
    maxIdleConnections=Math.max(maxIdleConnections,Number(stats.value.rows[0]?.idle??0));
    maxIdleInTransaction=Math.max(maxIdleInTransaction,Number(stats.value.rows[0]?.idle_in_transaction??0));
    maxWaitingSessions=Math.max(maxWaitingSessions,Number(stats.value.rows[0]?.waiting_sessions??0));
    const postmasterStartedAt=String(stats.value.rows[0]?.postmaster_started_at??'');
    if(initialPostmasterStartedAt===null)initialPostmasterStartedAt=postmasterStartedAt;
    else if(postmasterStartedAt!==initialPostmasterStartedAt)postmasterRestartDetected=true;
    if(iterations%3===0)await proveRollbackSafeWrite(iterations);
    if(iterations%3===0){
      const fresh=createRuntimePostgresPool(environment.DATABASE_URL,(code)=>safeErrors.push(code),
        {maximumConnections:1,applicationName:'theta-db-fresh-probe',connectionTimeoutMillis:5_000});
      try{await fresh.query('SELECT 1');freshAcquisitions++;}finally{await fresh.end();}
    }
    queryLatenciesMs.push(performance.now()-iterationStarted);
    iterations++;
    process.stdout.write(JSON.stringify({event:'progress',iteration:iterations,elapsedSeconds:Math.round(
      (Date.now()-Date.parse(startedAt))/1_000),poolTotal:pool.totalCount,poolWaiting:pool.waitingCount})+'\n');
    await new Promise((resolve)=>setTimeout(resolve,5_000));
  }
}catch(error){
  const classified=classifyPostgresRuntimeError(error);
  lastSafeCode=classified.safeCode;
  if(classified.safeCode==='POSTGRES_UNKNOWN_ERROR')unclassifiedErrors++;
}finally{await pool.end().catch(()=>undefined);}

const classifiedPoolErrors=[...new Set(safeErrors)];
const result={contractVersion:'theta-postgres-stability-soak-v2',startedAt,completedAt:new Date().toISOString(),
  requestedDurationSeconds:durationSeconds,iterations,reads,freshAcquisitions,maxPoolTotal,maxPoolWaiting,
  maxDatabaseConnections,maxActiveConnections,maxIdleConnections,maxIdleInTransaction,maxWaitingSessions,
  rollbackSafeWrites,snapshotPersistenceProofs,archiveReconstructionProofs,recoveredReadRetries,initialPostmasterStartedAt,
  postmasterRestartDetected,queryLatencyMs:{p50:percentile(queryLatenciesMs,0.50),p95:percentile(queryLatenciesMs,0.95),
    max:queryLatenciesMs.length===0?null:Number(Math.max(...queryLatenciesMs).toFixed(3))},
  classifiedPoolErrors,unclassifiedErrors,lastSafeCode,
  connectionBudget:{poolMax:2,freshProbeMax:1,providerObservedMax:20},
  providerResourceTelemetry:'AIVEN_CONSOLE_REQUIRED',
  orderSubmissions:0,brokerMutations:0,
  result:lastSafeCode===null&&unclassifiedErrors===0&&maxPoolTotal<=2&&maxIdleInTransaction===0
    &&classifiedPoolErrors.length===0&&recoveredReadRetries===0&&!postmasterRestartDetected&&rollbackSafeWrites>0
    &&snapshotPersistenceProofs===1&&archiveReconstructionProofs===1?'PASS':'FAIL'};
const receiptHash=createHash('sha256').update(JSON.stringify(result)).digest('hex');
console.log(JSON.stringify({...result,receiptHash}));
if(result.result!=='PASS')process.exitCode=1;
