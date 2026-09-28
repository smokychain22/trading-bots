import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { buildFreshPostgresAttemptReceipt, executeFreshPostgresLifecycle,
  summarizeFreshPostgresCampaign, type FreshPostgresAttemptReceipt,
  type FreshPostgresLifecycleBoundaries,thetaSoakFreshPhysicalConnectionTimeoutMillis,
  thetaSoakPoolWaitTimeoutMillis } from '../src/theta/postgres-connection-characterization.js';
import { classifyPostgresRuntimeError } from '../src/theta/postgres-runtime-error.js';

const contractVersion='theta-postgres-fresh-connection-diagnostic-v1';
const environmentFile=process.argv.find((value)=>value.startsWith('--environment-file='))?.split('=',2)[1]??'.env.local';
const samplesArgument=Number(process.argv.find((value)=>value.startsWith('--samples='))?.split('=',2)[1]??40);
const intervalArgument=Number(process.argv.find((value)=>value.startsWith('--interval-ms='))?.split('=',2)[1]??5_000);
const receiptPathArgument=process.argv.find((value)=>value.startsWith('--receipt-path='))?.split('=',2)[1];
if(!Number.isSafeInteger(samplesArgument)||samplesArgument<20||samplesArgument>100)throw new Error('DIAGNOSTIC_SAMPLE_COUNT_INVALID');
if(!Number.isSafeInteger(intervalArgument)||intervalArgument<1_000||intervalArgument>60_000){
  throw new Error('DIAGNOSTIC_INTERVAL_INVALID');
}
const environment=loadEnvironmentFile(environmentFile);
const connectionString=environment.AIVEN_DATABASE_URL??environment.DATABASE_URL;
if(!connectionString)throw new Error('AIVEN_DATABASE_URL_NOT_CONFIGURED');
const diagnosticConnectionTimeoutMs=thetaSoakFreshPhysicalConnectionTimeoutMillis;
const connectionUrl=new URL(connectionString);
const sslExpected=!['disable','false','0'].includes(connectionUrl.searchParams.get('sslmode')?.toLowerCase()??'require');
const attempts:FreshPostgresAttemptReceipt[]=[];

type StatsRow={postmaster_start?:unknown;database_connections?:unknown;active_connections?:unknown;
  idle_connections?:unknown;idle_in_transaction_connections?:unknown;lock_waiting_connections?:unknown;
  long_transaction_connections?:unknown;backend_pid?:unknown};

const numberOrNull=(value:unknown):number|null=>{
  const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;
};

async function runAttempt(attemptId:number):Promise<FreshPostgresAttemptReceipt>{
  const observedAt=new Date().toISOString();
  const connectStartedAtMs=performance.now();
  let dnsEndedAtMs:number|null=null;
  let tcpConnectedAtMs:number|null=null;
  let tlsStartedAtMs:number|null=null;
  let tlsSecureAtMs:number|null=null;
  let postgresReadyAtMs:number|null=null;
  let firstQueryStartedAtMs:number|null=null;
  let firstQueryEndedAtMs:number|null=null;
  let closeStartedAtMs:number|null=null;
  let closeEndedAtMs:number|null=null;
  let dnsFailed=false;
  let tlsFailed=false;
  let stats:StatsRow|undefined;
  const socket=new Socket();
  socket.once('lookup',(error)=>{dnsEndedAtMs=performance.now();dnsFailed=error!==null;});
  socket.once('connect',()=>{tcpConnectedAtMs=performance.now();});
  const client=new pg.Client({connectionString,connectionTimeoutMillis:diagnosticConnectionTimeoutMs,
    application_name:'theta-fresh-connection-diagnostic',stream:()=>socket});
  client.connection.once('sslconnect',()=>{
    tlsStartedAtMs=performance.now();
    const secureStream=client.connection.stream as TLSSocket;
    secureStream.once('secureConnect',()=>{tlsSecureAtMs=performance.now();});
    secureStream.once('tlsClientError',()=>{tlsFailed=true;});
  });
  const lifecycle=await executeFreshPostgresLifecycle({
    connect:async()=>{await client.connect();postgresReadyAtMs=performance.now();},
    firstQuery:async()=>{
      firstQueryStartedAtMs=performance.now();
      const result=await client.query<StatsRow>(`SELECT pg_postmaster_start_time()::text AS postmaster_start,
        pg_backend_pid()::int AS backend_pid,
        count(*) FILTER (WHERE datname=current_database())::int AS database_connections,
        count(*) FILTER (WHERE datname=current_database() AND state='active')::int AS active_connections,
        count(*) FILTER (WHERE datname=current_database() AND state='idle')::int AS idle_connections,
        count(*) FILTER (WHERE datname=current_database() AND state='idle in transaction')::int
          AS idle_in_transaction_connections,
        count(*) FILTER (WHERE datname=current_database() AND wait_event_type='Lock')::int AS lock_waiting_connections,
        count(*) FILTER (WHERE datname=current_database() AND xact_start IS NOT NULL
          AND clock_timestamp()-xact_start > interval '30 seconds')::int AS long_transaction_connections
        FROM pg_stat_activity`);
      firstQueryEndedAtMs=performance.now();stats=result.rows[0];return stats;
    },
    close:async()=>{closeStartedAtMs=performance.now();await client.end();closeEndedAtMs=performance.now();},
  });
  const error=lifecycle.error??lifecycle.closeError;
  const boundaries:FreshPostgresLifecycleBoundaries={connectStartedAtMs,dnsEndedAtMs,tcpConnectedAtMs,tlsStartedAtMs,
    tlsSecureAtMs,postgresReadyAtMs,firstQueryStartedAtMs,firstQueryEndedAtMs,closeStartedAtMs,closeEndedAtMs,sslExpected};
  return buildFreshPostgresAttemptReceipt({attemptId,observedAt,boundaries,dnsFailed,tlsFailed,
    errorCode:error===null?null:classifyPostgresRuntimeError(error).safeCode,
    postmasterStart:typeof stats?.postmaster_start==='string'?stats.postmaster_start:null,
    databaseConnections:numberOrNull(stats?.database_connections),activeConnections:numberOrNull(stats?.active_connections),
    idleConnections:numberOrNull(stats?.idle_connections),
    idleInTransactionConnections:numberOrNull(stats?.idle_in_transaction_connections),
    lockWaitingConnections:numberOrNull(stats?.lock_waiting_connections),
    longTransactionConnections:numberOrNull(stats?.long_transaction_connections),backendPid:numberOrNull(stats?.backend_pid)});
}

const startedAt=new Date().toISOString();
for(let attemptId=1;attemptId<=samplesArgument;attemptId++){
  const receipt=await runAttempt(attemptId);
  attempts.push(receipt);
  process.stdout.write(`${JSON.stringify({event:'FRESH_CONNECTION_ATTEMPT',...receipt})}\n`);
  if(attemptId<samplesArgument)await delay(intervalArgument);
}
const summary=summarizeFreshPostgresCampaign(attempts);
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{
  encoding:'utf8',timeout:30_000,windowsHide:true}).trim();
const result={contractVersion,startedAt,completedAt:new Date().toISOString(),sourceSha,
  mode:'SEQUENTIAL_READ_ONLY_NON_CONTINUATION',diagnosticConnectionTimeoutMs,
  timeoutAuthority:{poolWaitTimeoutMs:thetaSoakPoolWaitTimeoutMillis,
    physicalConnectTimeoutMs:thetaSoakFreshPhysicalConnectionTimeoutMillis,
    currentSource:'src/theta/postgres-connection-characterization.ts',canonicalRequirement:true,
    purpose:'SEPARATE_POOL_WAIT_AND_FRESH_PHYSICAL_CONNECTION_POLICIES'},
  boundarySemantics:{dns:'NODE_SOCKET_LOOKUP_EVENT_WHEN_AVAILABLE',tcp:'NODE_SOCKET_CONNECT_EVENT',
    tls:'PG_SSL_UPGRADE_TO_TLS_SECURE_CONNECT',postgresStartup:'TLS_SECURE_TO_PG_CLIENT_READY',
    unavailableBoundaryValuesRemainNull:true},summary,attempts,
  provider:'AIVEN',hostIdentityHash:createHash('sha256').update(connectionUrl.hostname).digest('hex'),
  orderSubmissions:0,brokerMutations:0,followerSubmissions:0};
if(receiptPathArgument){
  const receiptPath=resolve(receiptPathArgument);
  if(!receiptPath.toLowerCase().endsWith('.json'))throw new Error('DIAGNOSTIC_RECEIPT_PATH_INVALID');
  await mkdir(dirname(receiptPath),{recursive:true});
  const temporaryPath=`${receiptPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath,`${JSON.stringify(result,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  await rename(temporaryPath,receiptPath);
}
console.log(JSON.stringify(result));
