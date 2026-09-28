import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { summarizeFreshPostgresCampaign, type FreshPostgresAttemptReceipt,
  thetaSoakFreshPhysicalConnectionTimeoutMillis,
  thetaSoakPoolWaitTimeoutMillis } from '../src/theta/postgres-connection-characterization.js';
import { runInstrumentedFreshPostgresAttempt } from '../src/theta/postgres-fresh-connection-probe.js';

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
const attempts:FreshPostgresAttemptReceipt[]=[];

const startedAt=new Date().toISOString();
for(let attemptId=1;attemptId<=samplesArgument;attemptId++){
  const receipt=await runInstrumentedFreshPostgresAttempt({connectionString,
    connectionTimeoutMillis:diagnosticConnectionTimeoutMs,
    applicationName:'theta-fresh-connection-diagnostic',attemptId});
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
