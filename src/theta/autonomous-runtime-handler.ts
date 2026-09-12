import type { IncomingMessage, ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { loadEnvironment } from '../config/environment.js';
import { matchesOperatorToken } from '../providers/readiness-handler.js';
import { runAutonomousRuntimeCycle } from './autonomous-runtime.js';

let runtimePool: Pool | null = null;

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
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
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
  try {
    const report = await runAutonomousRuntimeCycle(environment, runtimePool);
    send(response, report.status === 'FAILED' || report.status === 'QUARANTINED' ? 503 : report.status === 'DEGRADED' ? 207 : 200, report);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
      ? error.message : 'AUTONOMOUS_RUNTIME_FAILED';
    send(response, 503, {
      error: code, executionGate: 'LOCKED', masterPaperOrdersSubmitted: 0,
      followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
    });
  }
}
