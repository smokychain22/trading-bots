import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { runWithBoundedConcurrency } from '../src/theta/bounded-concurrency.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';
import { decodeCycleEvidenceArchive, postgresCycleEvidenceStorageVersion } from '../src/theta/postgres-cycle-evidence-storage.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';
import { withRuntimePostgresClient } from '../src/theta/runtime-postgres-client.js';
import type { RuntimePostgresClientObservation } from '../src/theta/runtime-postgres-client.js';

const environmentFile=process.argv.find((value)=>value.startsWith('--environment-file='))?.split('=',2)[1]??'.env.local';
const durationArg=process.argv.find((value)=>value.startsWith('--duration-seconds='))?.split('=',2)[1];
const parsedDuration=Number(durationArg??900);
if(!Number.isFinite(parsedDuration))throw new Error('SOAK_DURATION_INVALID');
const durationSeconds=Math.max(120,Math.min(3_600,Math.trunc(parsedDuration)));
const environment=loadEnvironmentFile(environmentFile);
if(!environment.DATABASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');

const safeErrors:string[]=[];
const primaryPoolMax=2;
const connectionTimeoutMillis=5_000;
const pool=createRuntimePostgresPool(environment.DATABASE_URL,(code)=>safeErrors.push(code),
  {maximumConnections:primaryPoolMax,applicationName:'theta-db-stability-soak',connectionTimeoutMillis});
const startedAt=new Date().toISOString();
const deadline=Date.now()+durationSeconds*1_000;
let iterations=0;
let reads=0;
let freshAcquisitions=0;
let maxPoolTotal=0;
let maxPoolIdle=0;
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
const transactionLifetimesMs:number[]=[];
const clientObservations:Array<RuntimePostgresClientObservation&{readonly poolKind:'PRIMARY'|'FRESH_PROBE'}>=[];
let serverSettings:{statementTimeout:string;idleInTransactionSessionTimeout:string;lockTimeout:string}|null=null;

const observeClient=(poolKind:'PRIMARY'|'FRESH_PROBE')=>(observation:RuntimePostgresClientObservation):void=>{
  clientObservations.push({...observation,poolKind});
  for(const state of [observation.poolBefore,observation.poolAtAcquire,observation.poolAfterRelease]){
    if(state===null)continue;
    maxPoolTotal=Math.max(maxPoolTotal,state.total);
    maxPoolIdle=Math.max(maxPoolIdle,state.idle);
    maxPoolWaiting=Math.max(maxPoolWaiting,state.waiting);
  }
};

const sha256=(value:string|Buffer):string=>createHash('sha256').update(value).digest('hex');

async function proveSnapshotPersistenceAndArchiveReconstruction():Promise<void>{
  const latest=await withRuntimePostgresClient(pool,(client)=>client.query(`SELECT
    fusion_snapshot_id,snapshot_json,content_hash
    FROM trade.fusion_snapshot ORDER BY decision_time DESC LIMIT 1`),{observe:observeClient('PRIMARY')});
  const row=latest.rows[0] as {fusion_snapshot_id?:unknown;snapshot_json?:unknown;content_hash?:unknown}|undefined;
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
    const transactionStartedAt=Date.now();
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
      transactionLifetimesMs.push(Date.now()-transactionStartedAt);
    }
  },{observe:observeClient('PRIMARY')});
}

async function proveRollbackSafeWrite(iteration:number):Promise<void>{
  await withRuntimePostgresClient(pool,async(client)=>{
    let transactionOpen=false;
    const transactionStartedAt=Date.now();
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
      transactionLifetimesMs.push(Date.now()-transactionStartedAt);
    }
  },{observe:observeClient('PRIMARY')});
}

function percentile(values:readonly number[],fraction:number):number|null{
  if(values.length===0)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return Number(sorted[Math.min(sorted.length-1,Math.floor(fraction*sorted.length))]!.toFixed(3));
}

try{
  const settings=await withRuntimePostgresClient(pool,(client)=>client.query(`SELECT
    current_setting('statement_timeout') AS statement_timeout,
    current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout,
    current_setting('lock_timeout') AS lock_timeout`),{observe:observeClient('PRIMARY')});
  serverSettings={statementTimeout:String(settings.rows[0]?.statement_timeout??''),
    idleInTransactionSessionTimeout:String(settings.rows[0]?.idle_in_transaction_session_timeout??''),
    lockTimeout:String(settings.rows[0]?.lock_timeout??'')};
  await proveSnapshotPersistenceAndArchiveReconstruction();
  while(Date.now()<deadline){
    const iterationStarted=performance.now();
    const results=await runWithBoundedConcurrency(Array.from({length:6},(_,index)=>index),primaryPoolMax,
      async(index)=>{
        await withRuntimePostgresClient(pool,(client)=>client.query(
          'SELECT $1::int AS ordinal,pg_sleep(0.025)',[index]),{observe:observeClient('PRIMARY')});
        return 1;
      });
    await new Promise((resolve)=>setTimeout(resolve,5));
    maxPoolTotal=Math.max(maxPoolTotal,pool.totalCount);
    maxPoolIdle=Math.max(maxPoolIdle,pool.idleCount);
    maxPoolWaiting=Math.max(maxPoolWaiting,pool.waitingCount);
    if(pool.waitingCount!==0)throw Object.assign(new Error('SOAK_POOL_WAITERS_NOT_DRAINED'),{code:'SOAK_POOL_WAITERS_NOT_DRAINED'});
    reads+=results.length;
    const stats=await withRuntimePostgresClient(pool,(client)=>client.query(`SELECT
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS active,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle') AS idle,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction') AS idle_in_transaction,
      (SELECT count(*)::int FROM pg_stat_activity
        WHERE datname=current_database() AND state='active' AND wait_event IS NOT NULL) AS waiting_sessions,
      pg_postmaster_start_time()::text AS postmaster_started_at`),{observe:observeClient('PRIMARY')});
    reads++;
    maxDatabaseConnections=Math.max(maxDatabaseConnections,Number(stats.rows[0]?.connections??0));
    maxActiveConnections=Math.max(maxActiveConnections,Number(stats.rows[0]?.active??0));
    maxIdleConnections=Math.max(maxIdleConnections,Number(stats.rows[0]?.idle??0));
    maxIdleInTransaction=Math.max(maxIdleInTransaction,Number(stats.rows[0]?.idle_in_transaction??0));
    maxWaitingSessions=Math.max(maxWaitingSessions,Number(stats.rows[0]?.waiting_sessions??0));
    const postmasterStartedAt=String(stats.rows[0]?.postmaster_started_at??'');
    if(initialPostmasterStartedAt===null)initialPostmasterStartedAt=postmasterStartedAt;
    else if(postmasterStartedAt!==initialPostmasterStartedAt)postmasterRestartDetected=true;
    if(iterations%3===0)await proveRollbackSafeWrite(iterations);
    if(iterations%3===0){
      const fresh=createRuntimePostgresPool(environment.DATABASE_URL,(code)=>safeErrors.push(code),
        {maximumConnections:1,applicationName:'theta-db-fresh-probe',connectionTimeoutMillis});
      try{
        await withRuntimePostgresClient(fresh,(client)=>client.query('SELECT 1'),
          {observe:observeClient('FRESH_PROBE')});
        freshAcquisitions++;
      }finally{await fresh.end();}
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
const acquisitionDurationsMs=clientObservations.map((value)=>value.acquisitionDurationMs);
const checkoutDurationsMs=clientObservations.flatMap((value)=>value.checkoutDurationMs===null?[]:[value.checkoutDurationMs]);
const connectionCreationDurationsMs=clientObservations.filter((value)=>value.acquisitionPath==='NEW_CONNECTION')
  .map((value)=>value.acquisitionDurationMs);
const poolQueueDurationsMs=clientObservations.filter((value)=>value.acquisitionPath==='POOL_QUEUE')
  .map((value)=>value.acquisitionDurationMs);
const failedAcquisitions=clientObservations.filter((value)=>value.outcome==='ACQUISITION_FAILED');
const releasedClients=clientObservations.filter((value)=>value.releasedAt!==null);
const result={contractVersion:'theta-postgres-stability-soak-v3',startedAt,completedAt:new Date().toISOString(),
  requestedDurationSeconds:durationSeconds,iterations,reads,freshAcquisitions,maxPoolTotal,maxPoolWaiting,
  maxPoolIdle,
  maxDatabaseConnections,maxActiveConnections,maxIdleConnections,maxIdleInTransaction,maxWaitingSessions,
  rollbackSafeWrites,snapshotPersistenceProofs,archiveReconstructionProofs,recoveredReadRetries,initialPostmasterStartedAt,
  postmasterRestartDetected,queryLatencyMs:{p50:percentile(queryLatenciesMs,0.50),p95:percentile(queryLatenciesMs,0.95),
    max:queryLatenciesMs.length===0?null:Number(Math.max(...queryLatenciesMs).toFixed(3))},
  poolImplementation:'pg.Pool/pg-pool',poolConfiguration:{max:primaryPoolMax,min:0,connectionTimeoutMillis,
    idleTimeoutMillis:10_000,maxLifetimeSeconds:60,statementTimeout:serverSettings?.statementTimeout??null,
    idleInTransactionSessionTimeout:serverSettings?.idleInTransactionSessionTimeout??null,
    lockTimeout:serverSettings?.lockTimeout??null,queryTimeoutMillis:null,persistentPoolCount:1,
    transientFreshProbePoolCount:1,maximumSimultaneousPoolCount:2,
    transientFreshProbePool:'ONE_SEQUENTIAL_POOL_EVERY_THIRD_ITERATION_ENDED_BEFORE_NEXT_ITERATION'},
  acquisitionTelemetry:{count:clientObservations.length,failedCount:failedAcquisitions.length,
    releasedCount:releasedClients.length,acquisitionDurationMs:{p50:percentile(acquisitionDurationsMs,0.50),
      p95:percentile(acquisitionDurationsMs,0.95),max:acquisitionDurationsMs.length===0?null:Math.max(...acquisitionDurationsMs)},
    connectionCreationDurationMs:{p50:percentile(connectionCreationDurationsMs,0.50),
      p95:percentile(connectionCreationDurationsMs,0.95),max:connectionCreationDurationsMs.length===0?null:Math.max(...connectionCreationDurationsMs)},
    poolQueueDurationMs:{p50:percentile(poolQueueDurationsMs,0.50),p95:percentile(poolQueueDurationsMs,0.95),
      max:poolQueueDurationsMs.length===0?null:Math.max(...poolQueueDurationsMs)},
    checkoutDurationMs:{p50:percentile(checkoutDurationsMs,0.50),p95:percentile(checkoutDurationsMs,0.95),
      max:checkoutDurationsMs.length===0?null:Math.max(...checkoutDurationsMs)},
    transactionLifetimeMs:{p50:percentile(transactionLifetimesMs,0.50),p95:percentile(transactionLifetimesMs,0.95),
      max:transactionLifetimesMs.length===0?null:Math.max(...transactionLifetimesMs)},
    dnsDurationMs:null,tlsDurationMs:null,
    lastFailure:failedAcquisitions.at(-1)??null,recentObservations:clientObservations.slice(-32)},
  classifiedPoolErrors,unclassifiedErrors,lastSafeCode,
  connectionBudget:{poolMax:2,freshProbeMax:1,providerObservedMax:20},
  providerResourceTelemetry:'AIVEN_CONSOLE_REQUIRED',
  orderSubmissions:0,brokerMutations:0,
  result:lastSafeCode===null&&unclassifiedErrors===0&&maxPoolTotal<=2&&maxPoolWaiting===0&&maxIdleInTransaction===0
    &&failedAcquisitions.length===0&&releasedClients.length===clientObservations.length
    &&classifiedPoolErrors.length===0&&recoveredReadRetries===0&&!postmasterRestartDetected&&rollbackSafeWrites>0
    &&snapshotPersistenceProofs===1&&archiveReconstructionProofs===1?'PASS':'FAIL'};
const receiptHash=createHash('sha256').update(JSON.stringify(result)).digest('hex');
console.log(JSON.stringify({...result,receiptHash}));
if(result.result!=='PASS')process.exitCode=1;
