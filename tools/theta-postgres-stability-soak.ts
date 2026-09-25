import { createHash } from 'node:crypto';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';
import { withRuntimePostgresReadRetry } from '../src/theta/runtime-postgres-client.js';

const environmentFile=process.argv.find((value)=>value.startsWith('--environment-file='))?.split('=',2)[1]??'.env.local';
const durationArg=process.argv.find((value)=>value.startsWith('--duration-seconds='))?.split('=',2)[1];
const durationSeconds=Math.max(120,Math.min(600,Number(durationArg??210)));
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
let maxIdleInTransaction=0;
let unclassifiedErrors=0;
let lastSafeCode:string|null=null;

try{
  while(Date.now()<deadline){
    const concurrentReads=Array.from({length:6},async(_,index)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(
        'SELECT $1::int AS ordinal,pg_sleep(0.025)',[index]),{maximumAttempts:2});
      return receipt.attemptCount;
    });
    await new Promise((resolve)=>setTimeout(resolve,5));
    maxPoolTotal=Math.max(maxPoolTotal,pool.totalCount);
    maxPoolWaiting=Math.max(maxPoolWaiting,pool.waitingCount);
    const results=await Promise.all(concurrentReads);
    reads+=results.length;
    const stats=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction') AS idle_in_transaction`),
    {maximumAttempts:2});
    reads++;
    maxDatabaseConnections=Math.max(maxDatabaseConnections,Number(stats.value.rows[0]?.connections??0));
    maxIdleInTransaction=Math.max(maxIdleInTransaction,Number(stats.value.rows[0]?.idle_in_transaction??0));
    if(iterations%3===0){
      const fresh=createRuntimePostgresPool(environment.DATABASE_URL,(code)=>safeErrors.push(code),
        {maximumConnections:1,applicationName:'theta-db-fresh-probe',connectionTimeoutMillis:5_000});
      try{await fresh.query('SELECT 1');freshAcquisitions++;}finally{await fresh.end();}
    }
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

const result={contractVersion:'theta-postgres-stability-soak-v1',startedAt,completedAt:new Date().toISOString(),
  requestedDurationSeconds:durationSeconds,iterations,reads,freshAcquisitions,maxPoolTotal,maxPoolWaiting,
  maxDatabaseConnections,maxIdleInTransaction,classifiedPoolErrors:[...new Set(safeErrors)],unclassifiedErrors,lastSafeCode,
  connectionBudget:{poolMax:2,freshProbeMax:1,providerObservedMax:20},
  orderSubmissions:0,brokerMutations:0,
  result:lastSafeCode===null&&unclassifiedErrors===0&&maxPoolTotal<=2&&maxIdleInTransaction===0?'PASS':'FAIL'};
const receiptHash=createHash('sha256').update(JSON.stringify(result)).digest('hex');
console.log(JSON.stringify({...result,receiptHash}));
if(result.result!=='PASS')process.exitCode=1;
