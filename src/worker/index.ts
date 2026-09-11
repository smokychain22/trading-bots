import { Pool } from 'pg';
import pino from 'pino';
import { loadEnvironment } from '../config/environment.js';
import { ResidentThetaWorker } from './resident-worker.js';

const environment = loadEnvironment();
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['*.apiKey', '*.apiSecret', '*.secret', '*.token', '*.authorization'], censor: '[REDACTED]' },
});
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 4, connectionTimeoutMillis: 8_000 });
const worker = new ResidentThetaWorker(environment, pool, undefined, logger);

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  logger.info({ event: 'shutdown_requested', signal }, 'THETA resident worker stopping');
  await worker.stop();
};

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

worker.start().catch(async (error: unknown) => {
  const errorCode = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
    ? error.message : 'WORKER_STARTUP_FAILED';
  logger.fatal({ event: 'startup_failed', errorCode, executionGate: 'LOCKED' }, 'THETA resident worker failed to start');
  await worker.stop().catch(() => undefined);
  process.exitCode = 1;
});
