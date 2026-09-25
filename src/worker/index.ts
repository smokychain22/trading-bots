import pino from 'pino';
import { existsSync } from 'node:fs';
import { loadEnvironment } from '../config/environment.js';
import { ResidentThetaWorker } from './resident-worker.js';
import { PostgresWorkerRuntimeStore } from './postgres-worker-runtime-store.js';
import { createRuntimePostgresPool } from '../theta/runtime-postgres-pool.js';

const environment = loadEnvironment();
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['*.apiKey', '*.apiSecret', '*.secret', '*.token', '*.authorization'], censor: '[REDACTED]' },
});
if(!environment.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');
const pool = createRuntimePostgresPool(environment.DATABASE_URL,(code)=>{
  logger.warn({event:'runtime_database_connection_error',errorCode:code},'THETA runtime database connection degraded');
},{maximumConnections:2,applicationName:'theta-resident-worker'});
const worker = new ResidentThetaWorker(environment,pool,undefined,logger,undefined,
  new PostgresWorkerRuntimeStore(pool),{buildSha:environment.THETA_BUILD_SHA});

let stopping = false;
let stopFileTimer:ReturnType<typeof setInterval>|null=null;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  if(stopFileTimer!==null)clearInterval(stopFileTimer);
  logger.info({ event: 'shutdown_requested', signal }, 'THETA resident worker stopping');
  await worker.stop();
};

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

const stopFile=process.env.THETA_STOP_FILE;
if(stopFile){
  stopFileTimer=setInterval(()=>{
    if(existsSync(stopFile))void shutdown('LOCAL_STOP_REQUEST');
  },1_000);
  stopFileTimer.unref();
}

worker.start().catch(async (error: unknown) => {
  const errorCode = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
    ? error.message : 'WORKER_STARTUP_FAILED';
  logger.fatal({ event: 'startup_failed', errorCode, executionGate: 'EXTERNAL_QUOTE_BLOCKER' },
    'THETA resident master Paper worker failed to start');
  await worker.stop().catch(() => undefined);
  process.exitCode = 1;
});
