import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import pino, { type Logger } from 'pino';
import type { Environment } from '../config/environment.js';
import { assertAutonomousWorkerConfiguration } from '../config/environment.js';
import { runAutonomousRuntimeCycle, type AutonomousRuntimeReport } from '../theta/autonomous-runtime.js';

export const externalWorkerHostState = 'EXTERNAL_WORKER_HOST_DEFERRED_UNTIL_PAPER_READINESS' as const;

export interface WorkerCycleRunner {
  (environment: Environment, pool: Pool, now: Date): Promise<AutonomousRuntimeReport>;
}

export interface WorkerHealth {
  readonly status: 'STARTING' | 'READY' | 'DEGRADED' | 'STOPPING' | 'STOPPED';
  readonly runningCycle: boolean;
  readonly pythonReady: boolean;
  readonly databaseConfigured: boolean;
  readonly lastCycleStartedAt: string | null;
  readonly lastCycleCompletedAt: string | null;
  readonly lastCycleStatus: AutonomousRuntimeReport['status'] | null;
  readonly consecutiveFailures: number;
  readonly executionGate: 'LOCKED';
  readonly alwaysOnWorker: 'NOT_YET_DEPLOYED';
  readonly hostState: typeof externalWorkerHostState;
}

type Timer = ReturnType<typeof setTimeout>;

const redactedLogger = (): Logger => pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.apiKey', '*.apiSecret', '*.secret', '*.token', '*.authorization', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
});

export async function verifyPythonRuntime(executable: string, timeoutMs = 5_000): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(executable, ['--version'], { shell: false, stdio: ['ignore', 'ignore', 'ignore'] });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0));
  });
}

export class ResidentThetaWorker {
  private health: WorkerHealth;
  private timer: Timer | null = null;
  private activeCycle: Promise<AutonomousRuntimeReport | null> | null = null;
  private server: Server | null = null;
  private stopping = false;

  constructor(
    private readonly environment: Environment,
    private readonly pool: Pool,
    private readonly runner: WorkerCycleRunner = runAutonomousRuntimeCycle,
    private readonly logger: Logger = redactedLogger(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.health = {
      status: 'STARTING', runningCycle: false, pythonReady: false,
      databaseConfigured: Boolean(environment.DATABASE_URL), lastCycleStartedAt: null,
      lastCycleCompletedAt: null, lastCycleStatus: null, consecutiveFailures: 0,
      executionGate: 'LOCKED', alwaysOnWorker: 'NOT_YET_DEPLOYED', hostState: externalWorkerHostState,
    };
  }

  snapshot(): WorkerHealth { return { ...this.health }; }

  async initialize(): Promise<void> {
    assertAutonomousWorkerConfiguration(this.environment);
    const pythonReady = await verifyPythonRuntime(this.environment.THETA_PYTHON_EXECUTABLE);
    if (!pythonReady) throw new Error('PYTHON_RUNTIME_UNAVAILABLE');
    this.health = { ...this.health, pythonReady: true };
    await this.pool.query('SELECT 1');
  }

  async runOnce(): Promise<AutonomousRuntimeReport | null> {
    if (this.stopping) return null;
    if (this.activeCycle !== null) {
      this.logger.warn({ event: 'cycle_skipped', reason: 'CYCLE_ALREADY_RUNNING' }, 'THETA worker skipped overlapping trigger');
      return null;
    }
    const startedAt = this.now();
    this.health = { ...this.health, runningCycle: true, lastCycleStartedAt: startedAt.toISOString() };
    const cycle = this.runner(this.environment, this.pool, startedAt);
    this.activeCycle = cycle;
    try {
      const report = await cycle;
      const failed = report.status === 'FAILED' || report.status === 'QUARANTINED';
      this.health = {
        ...this.health, status: failed ? 'DEGRADED' : 'READY', runningCycle: false,
        lastCycleCompletedAt: this.now().toISOString(), lastCycleStatus: report.status,
        consecutiveFailures: failed ? this.health.consecutiveFailures + 1 : 0,
      };
      this.logger.info({
        event: 'cycle_complete', status: report.status, correlationId: report.correlationId,
        jobsAttempted: report.jobsAttempted, jobsCompleted: report.jobsCompleted,
        executionGate: report.executionGate,
      }, 'THETA worker cycle completed');
      return report;
    } catch (error) {
      this.health = {
        ...this.health, status: 'DEGRADED', runningCycle: false,
        lastCycleCompletedAt: this.now().toISOString(), lastCycleStatus: 'FAILED',
        consecutiveFailures: this.health.consecutiveFailures + 1,
      };
      this.logger.error({ event: 'cycle_failed', errorCode: safeErrorCode(error) }, 'THETA worker cycle failed');
      return null;
    } finally {
      this.activeCycle = null;
    }
  }

  async start(): Promise<void> {
    await this.initialize();
    await this.listen();
    await this.runOnce();
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.scheduleNext());
    }, this.environment.THETA_WORKER_INTERVAL_MS);
    this.timer.unref();
  }

  private async listen(): Promise<void> {
    this.server = createServer((request, response) => {
      const health = this.snapshot();
      const readiness = health.pythonReady && health.databaseConfigured
        && (health.status === 'READY' || health.status === 'DEGRADED');
      const path = request.url?.split('?')[0];
      if (request.method !== 'GET' || (path !== '/healthz' && path !== '/readyz')) {
        response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      response.writeHead(path === '/readyz' && !readiness ? 503 : 200, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      response.end(JSON.stringify(path === '/healthz' ? { serviceStatus: 'ok', ...health } : { ready: readiness, ...health }));
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.environment.THETA_WORKER_PORT, '0.0.0.0', resolve);
    });
    const address = this.server.address() as AddressInfo | null;
    this.logger.info({ event: 'worker_listening', port: address?.port ?? this.environment.THETA_WORKER_PORT, executionGate: 'LOCKED' }, 'THETA resident worker started');
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.health = { ...this.health, status: 'STOPPING' };
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.activeCycle !== null) await this.activeCycle.catch(() => null);
    if (this.server !== null) await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    await this.pool.end();
    this.health = { ...this.health, status: 'STOPPED', runningCycle: false };
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message;
  return 'WORKER_CYCLE_FAILED';
}
