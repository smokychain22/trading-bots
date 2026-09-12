import type { IncomingMessage, ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { loadEnvironment } from '../config/environment.js';
import { matchesOperatorToken } from '../providers/readiness-handler.js';
import { runAutonomousRuntimeCycle } from './autonomous-runtime.js';
import { PostgresWorkerRuntimeStore } from '../worker/postgres-worker-runtime-store.js';

let runtimePool: Pool | null = null;

export interface LocalWorkerIdentity {
  readonly workerId: string;
  readonly hostId: string;
  readonly buildSha: string;
}

export type LocalWorkerIdentityResult =
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'INVALID' }
  | { readonly kind: 'VALID'; readonly identity: LocalWorkerIdentity };

export function parseLocalWorkerIdentity(request: Pick<IncomingMessage, 'headers'>): LocalWorkerIdentityResult {
  const rawWorkerId = request.headers['x-theta-worker-id'];
  const rawHostId = request.headers['x-theta-host-id'];
  const rawBuildSha = request.headers['x-theta-build-sha'];
  const supplied = [rawWorkerId, rawHostId, rawBuildSha].filter((value) => value !== undefined).length;
  if (supplied === 0) return { kind: 'ABSENT' };
  if (supplied !== 3) return { kind: 'INVALID' };

  const workerId = validHeader(rawWorkerId, /^[A-Za-z0-9_.:-]{8,160}$/);
  const hostId = validHeader(rawHostId, /^[A-Za-z0-9_.-]{1,128}$/);
  const buildSha = validHeader(rawBuildSha, /^[0-9a-f]{7,40}$/);
  if (workerId === null || hostId === null || buildSha === null) return { kind: 'INVALID' };
  return { kind: 'VALID', identity: { workerId, hostId, buildSha } };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}

export default async function autonomousRuntimeHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    response.setHeader('Allow', 'POST, DELETE');
    send(response, 405, { error: 'method_not_allowed' });
    return;
  }
  const environment = loadEnvironment();
  const secret = environment.CRON_SECRET ?? '';
  if (secret.length < 32 || !matchesOperatorToken(request.headers.authorization ?? '', secret)) {
    send(response, 401, { error: 'unauthorized' });
    return;
  }
  if (!environment.THETA_AUTONOMOUS_WORKER_ENABLED) {
    send(response, 503, { error: 'worker_disabled', orderSubmission: 'LOCKED' });
    return;
  }
  if (!environment.DATABASE_URL) {
    send(response, 503, { error: 'database_not_configured', orderSubmission: 'LOCKED' });
    return;
  }
  runtimePool ??= new Pool({ connectionString: environment.DATABASE_URL, max: 2, connectionTimeoutMillis: 8_000 });
  const localIdentity = parseLocalWorkerIdentity(request);
  if (localIdentity.kind === 'INVALID') {
    send(response, 400, { error: 'invalid_local_worker_identity', executionGate: 'LOCKED' });
    return;
  }
  const localWorkerId = localIdentity.kind === 'VALID' ? localIdentity.identity.workerId : null;
  const workerStore=new PostgresWorkerRuntimeStore(runtimePool);
  if(request.method==='DELETE'){
    if(localWorkerId===null){send(response,400,{error:'local_worker_identity_required'});return;}
    await workerStore.stop(localWorkerId,new Date().toISOString(),'OFFLINE');
    send(response,200,{state:'OFFLINE',executionGate:'LOCKED'});
    return;
  }
  try {
    if(localIdentity.kind === 'ABSENT'){
      const active=await workerStore.activeLeaseOwner(new Date().toISOString());
      if(active!==null){send(response,409,{error:'local_primary_worker_active',executionGate:'LOCKED'});return;}
    }else{
      const at=new Date();
      const identity = localIdentity.identity;
      const previous=await workerStore.register({
        workerId: identity.workerId,
        hostId: identity.hostId,
        buildSha: identity.buildSha,
        startedAt:at.toISOString(),strategyVersions:['theta-shadow-once-v1']});
      const lease=await workerStore.acquireLease(identity.workerId,at.toISOString(),new Date(at.getTime()+150_000).toISOString());
      if(lease==='HELD_BY_OTHER'){send(response,409,{error:'primary_shadow_worker_lease_held',executionGate:'LOCKED'});return;}
      if(previous!==null&&at.getTime()-Date.parse(previous)>120_000)
        await workerStore.recordResumeGap(identity.workerId,previous,at.toISOString());
      await workerStore.cycleStarted(identity.workerId,at.toISOString());
    }
    const report = await runAutonomousRuntimeCycle(environment, runtimePool);
    if(localWorkerId!==null)await workerStore.cycleCompleted(localWorkerId,report,new Date().toISOString());
    send(response, report.status === 'FAILED' || report.status === 'QUARANTINED' ? 503 : report.status === 'DEGRADED' ? 207 : 200, report);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
      ? error.message : 'AUTONOMOUS_RUNTIME_FAILED';
    if (localWorkerId !== null) {
      await workerStore.stop(localWorkerId, new Date().toISOString(), 'ERROR', code).catch(() => undefined);
    }
    send(response, 503, {
      error: code, executionGate: 'LOCKED', masterPaperOrdersSubmitted: 0,
      followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
    });
  }
}

function validHeader(value: IncomingMessage['headers'][string], pattern: RegExp): string | null {
  return typeof value==='string'&&pattern.test(value)?value:null;
}
