import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { Pool } from 'pg';
import pino, { type Logger } from 'pino';
import type { Environment } from '../config/environment.js';
import { assertAutonomousWorkerConfiguration } from '../config/environment.js';
import { runAutonomousRuntimeCycle, type AutonomousRuntimeReport } from '../theta/autonomous-runtime.js';
import type { WorkerRuntimeState, WorkerRuntimeStore } from './postgres-worker-runtime-store.js';

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
  readonly runtimeState: WorkerRuntimeState;
  readonly workerId: string;
  readonly hostId: string;
  readonly buildSha: string;
  readonly leaseOwned: boolean;
  readonly currentDelayMs: number;
  readonly lastResumeGap: { readonly startedAt:string;readonly resumedAt:string;readonly missedObservations:number }|null;
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
  private heartbeatTimer: Timer | null = null;
  private stopping = false;
  private leaseOwned = false;
  private scheduledForAt: number | null = null;
  private readonly workerId: string;
  private readonly hostId: string;
  private readonly buildSha: string;

  constructor(
    private readonly environment: Environment,
    private readonly pool: Pool,
    private readonly runner: WorkerCycleRunner = runAutonomousRuntimeCycle,
    private readonly logger: Logger = redactedLogger(),
    private readonly now: () => Date = () => new Date(),
    private readonly runtimeStore: WorkerRuntimeStore | null = null,
    identity?: {readonly workerId?:string;readonly hostId?:string;readonly buildSha?:string},
  ) {
    this.hostId=identity?.hostId??hostname();
    this.workerId=identity?.workerId??`${this.hostId}:${randomUUID()}`;
    this.buildSha=identity?.buildSha??environment.THETA_BUILD_SHA??'unknown-build';
    this.health = {
      status: 'STARTING', runningCycle: false, pythonReady: false,
      databaseConfigured: Boolean(environment.DATABASE_URL), lastCycleStartedAt: null,
      lastCycleCompletedAt: null, lastCycleStatus: null, consecutiveFailures: 0,
      executionGate: 'LOCKED', alwaysOnWorker: 'NOT_YET_DEPLOYED', hostState: externalWorkerHostState,
      runtimeState:'STARTING',workerId:this.workerId,hostId:this.hostId,buildSha:this.buildSha,
      leaseOwned:false,currentDelayMs:environment.THETA_WORKER_INTERVAL_MS,lastResumeGap:null,
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
    this.health = { ...this.health, runningCycle: true, runtimeState:'RECONCILING',lastCycleStartedAt: startedAt.toISOString() };
    const cycle = (async()=>{
      await this.runtimeStore?.cycleStarted(this.workerId,startedAt.toISOString());
      return this.runner(this.environment,this.pool,startedAt);
    })();
    this.activeCycle = cycle;
    try {
      const report = await cycle;
      const failed = report.status === 'FAILED' || report.status === 'QUARANTINED';
      this.health = {
        ...this.health, status: failed ? 'DEGRADED' : 'READY', runningCycle: false,
        lastCycleCompletedAt: this.now().toISOString(), lastCycleStatus: report.status,
        consecutiveFailures: failed ? this.health.consecutiveFailures + 1 : 0,
        runtimeState:failed?'DEGRADED':report.reconciliation?.marketOpen===true?'SHADOW_RUNNING'
          :report.reconciliation?.marketOpen===false?'WAITING_FOR_MARKET':'DEGRADED',
      };
      this.health={...this.health,currentDelayMs:this.nextDelayMs()};
      await this.runtimeStore?.cycleCompleted(this.workerId,report,this.health.lastCycleCompletedAt??this.now().toISOString());
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
        runtimeState:'DEGRADED',
      };
      this.health={...this.health,currentDelayMs:this.nextDelayMs()};
      this.logger.error({ event: 'cycle_failed', errorCode: safeErrorCode(error) }, 'THETA worker cycle failed');
      return null;
    } finally {
      this.activeCycle = null;
    }
  }

  async start(): Promise<void> {
    await this.initialize();
    if(this.runtimeStore!==null){
      if(this.environment.THETA_WORKER_HEARTBEAT_MS*2>=this.environment.THETA_WORKER_LEASE_MS)
        throw new Error('WORKER_HEARTBEAT_MUST_BE_LESS_THAN_HALF_LEASE');
      const startedAt=this.now();
      const previousHeartbeat=await this.runtimeStore.register({workerId:this.workerId,hostId:this.hostId,
        buildSha:this.buildSha,startedAt:startedAt.toISOString(),strategyVersions:['theta-shadow-once-v1']});
      const expiry=new Date(startedAt.getTime()+this.environment.THETA_WORKER_LEASE_MS).toISOString();
      const acquired=await this.runtimeStore.acquireLease(this.workerId,startedAt.toISOString(),expiry);
      if(acquired==='HELD_BY_OTHER')throw new Error('PRIMARY_SHADOW_WORKER_LEASE_HELD');
      this.leaseOwned=true;
      this.health={...this.health,leaseOwned:true};
      if(previousHeartbeat!==null){
        const gapMs=startedAt.getTime()-Date.parse(previousHeartbeat);
        if(Number.isFinite(gapMs)&&gapMs>this.environment.THETA_WORKER_INTERVAL_MS*2){
          const missed=await this.runtimeStore.recordResumeGap(this.workerId,previousHeartbeat,startedAt.toISOString());
          this.health={...this.health,lastResumeGap:{startedAt:previousHeartbeat,resumedAt:startedAt.toISOString(),missedObservations:missed}};
        }
      }
      this.startHeartbeat();
    }
    await this.listen();
    await this.runOnce();
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.stopping) return;
    const delay=this.nextDelayMs();
    this.scheduledForAt=Date.now()+delay;
    this.health={...this.health,currentDelayMs:delay};
    this.timer = setTimeout(() => {
      const firedAt=Date.now();
      if(this.scheduledForAt!==null&&firedAt-this.scheduledForAt>this.environment.THETA_WORKER_INTERVAL_MS){
        this.logger.warn({event:'resume_gap_detected'},'THETA worker detected a timer gap and will reconcile before continuing');
      }
      void this.runOnce().finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref();
  }

  private nextDelayMs():number{
    const exponent=Math.min(this.health.consecutiveFailures,4);
    return Math.min(900_000,this.environment.THETA_WORKER_INTERVAL_MS*(2**exponent));
  }

  private startHeartbeat():void{
    this.heartbeatTimer=setInterval(()=>{
      if(this.stopping||!this.leaseOwned||this.runtimeStore===null)return;
      const at=this.now();
      const expiry=new Date(at.getTime()+this.environment.THETA_WORKER_LEASE_MS).toISOString();
      void this.runtimeStore.heartbeat(this.workerId,at.toISOString(),expiry,this.health.runtimeState).then((owned)=>{
        if(owned)return;
        this.leaseOwned=false;
        this.health={...this.health,leaseOwned:false,status:'DEGRADED',runtimeState:'ERROR'};
        this.logger.error({event:'primary_lease_lost'},'THETA worker lost the primary shadow lease');
        void this.stop('PRIMARY_SHADOW_WORKER_LEASE_LOST');
      }).catch(()=>{
        this.health={...this.health,status:'DEGRADED',runtimeState:'DEGRADED'};
      });
    },this.environment.THETA_WORKER_HEARTBEAT_MS);
    this.heartbeatTimer.unref();
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

  async stop(reason?:string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.health = { ...this.health, status: 'STOPPING',runtimeState:'STOPPING' };
    await this.runtimeStore?.stop(this.workerId,this.now().toISOString(),'STOPPING',reason).catch(()=>undefined);
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    if (this.activeCycle !== null) await this.activeCycle.catch(() => null);
    if (this.server !== null) await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    await this.runtimeStore?.stop(this.workerId,this.now().toISOString(),reason?'ERROR':'OFFLINE',reason).catch(()=>undefined);
    await this.pool.end();
    this.leaseOwned=false;
    this.health = { ...this.health, status: 'STOPPED', runtimeState:reason?'ERROR':'OFFLINE',runningCycle: false,leaseOwned:false };
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message;
  return 'WORKER_CYCLE_FAILED';
}
