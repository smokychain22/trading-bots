import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { AlpacaPaperBrokerAdapter, AlpacaPaperBrokerError } from '../execution/broker.js';
import {
  PostgresBrokerReconciliationStore, runReadOnlyBrokerReconciliation,
  type BrokerReconciliationResult,
} from '../execution/broker-reconciliation-worker.js';
import { PaperOrderCoordinator } from '../execution/paper-order-coordinator.js';
import { PostgresPaperOrderStore } from '../execution/postgres-paper-order-store.js';
import { MasterEncryptedStoreBrokerCredentialProvider } from '../customer/broker-credential-provider.js';
import { customerStore } from '../customer/customer-store.js';
import { dispatchDueJobs, type DueJob } from './scheduler-engine.js';
import type { JobRunResult, JobType } from './scheduler.js';
import { PostgresSchedulerCheckpointRepository } from './postgres-scheduler-checkpoint-repository.js';

export const autonomousRuntimeVersion = 'theta-autonomous-runtime-v1' as const;
export const autonomousPolicyVersion = 'theta-scheduler-policy-v1' as const;
const PAPER_HOST = 'https://paper-api.alpaca.markets' as const;

export interface AutonomousRuntimeReport {
  readonly correlationId: string;
  readonly status: 'DUPLICATE' | 'SUCCEEDED' | 'DEGRADED' | 'FAILED' | 'QUARANTINED';
  readonly runtimeVersion: string;
  readonly policyVersion: string;
  readonly jobsAttempted: number;
  readonly jobsCompleted: number;
  readonly jobResults: readonly {
    readonly jobType: JobType;
    readonly outcome: string;
    readonly status: string | null;
    readonly errorCode: string | null;
  }[];
  readonly reconciliation: BrokerReconciliationResult | null;
  readonly executionGate: 'LOCKED';
  readonly masterPaperOrdersSubmitted: 0;
  readonly followerPaperOrdersSubmitted: 0;
  readonly liveOrdersSubmitted: 0;
}

interface MasterRuntimeContext {
  readonly connectionId: string;
  readonly providerAccountRef: string;
  readonly executionAccountId: string | null;
  readonly broker: AlpacaPaperBrokerAdapter;
}

const minuteBucket = (date: Date): string => date.toISOString().slice(0, 16);
const accountHash = (value: string): string => createHash('sha256').update(value).digest('hex');

function safeFailure(error: unknown): { code: string; detail: string } {
  if (error instanceof AlpacaPaperBrokerError) {
    return { code: `ALPACA_${error.category}`, detail: `Alpaca PAPER reconciliation failed${error.httpStatus === null ? '' : ` with HTTP ${error.httpStatus}`}.` };
  }
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return { code: error.message, detail: error.message };
  return { code: 'RUNTIME_OPERATION_FAILED', detail: 'The runtime operation failed without exposing sensitive error data.' };
}

export class PostgresRuntimeCycleStore {
  constructor(private readonly pool: Pool) {}

  async begin(correlationId: string, workerInstance: string, at: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO ops.runtime_worker_cycle(
        correlation_id,worker_role,worker_instance,runtime_version,policy_version,invoked_at,heartbeat_at,status)
       VALUES($1,'THETA_PAPER_RUNTIME',$2,$3,$4,$5,$5,'RUNNING')
       ON CONFLICT(correlation_id) DO NOTHING RETURNING worker_cycle_id`,
      [correlationId, workerInstance, autonomousRuntimeVersion, autonomousPolicyVersion, at],
    );
    return result.rowCount === 1;
  }

  async finish(correlationId: string, report: AutonomousRuntimeReport, at: string): Promise<void> {
    const error = report.jobResults.find((result) => result.status === 'FAILED' || result.status === 'QUARANTINED');
    await this.pool.query(
      `UPDATE ops.runtime_worker_cycle SET completed_at=$2,heartbeat_at=$2,status=$3,
         jobs_attempted=$4,jobs_completed=$5,error_code=$6,error_detail=$7,result_json=$8::jsonb
       WHERE correlation_id=$1 AND status='RUNNING'`,
      [correlationId, at, report.status, report.jobsAttempted, report.jobsCompleted,
        error?.errorCode ?? null, error?.errorCode ?? null,
        JSON.stringify({ executionGate: 'LOCKED', jobResults: report.jobResults, reconciliation: report.reconciliation })],
    );
  }

  async resolveMasterContext(environment: Environment): Promise<MasterRuntimeContext> {
    const resolved = await new MasterEncryptedStoreBrokerCredentialProvider(
      customerStore(environment.DATABASE_URL), environment,
    ).getAuthentication();
    if (resolved === null) throw new Error('MASTER_CREDENTIAL_NOT_FOUND');
    const connection = await this.pool.query(
      `SELECT follower_account_id FROM copy.follower_account
       WHERE customer_id=$1 AND provider_account_ref=$2 AND account_role='MASTER_THETA_PAPER'
         AND environment='PAPER' AND connection_status='CONNECTED' AND disconnected_at IS NULL`,
      [resolved.customerId, resolved.providerAccountRef],
    );
    if (connection.rowCount !== 1) throw new Error('MASTER_CONNECTION_ROLE_INVALID');
    const execution = await this.pool.query(
      `SELECT execution_account_id FROM trade.execution_account
       WHERE provider_account_ref_hash=$1 AND environment='PAPER'`,
      [accountHash(resolved.providerAccountRef)],
    );
    return {
      connectionId: String(connection.rows[0].follower_account_id),
      providerAccountRef: resolved.providerAccountRef,
      executionAccountId: execution.rows[0]?.execution_account_id == null ? null : String(execution.rows[0].execution_account_id),
      broker: new AlpacaPaperBrokerAdapter({ baseUrl: PAPER_HOST, authentication: resolved.authentication }),
    };
  }

  async openChainCount(): Promise<number> {
    const result = await this.pool.query(`SELECT count(*)::int AS count FROM trade.economic_chain WHERE closed_at IS NULL`);
    return Number(result.rows[0]?.count ?? 0);
  }

  async dueWaitCount(): Promise<number> {
    const result = await this.pool.query(
      `SELECT count(*)::int AS count FROM trade.shadow_opportunity
       WHERE outcome='WAIT' AND observed_at >= now() - interval '7 days'`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}

function scheduledJobs(bucket: string): readonly DueJob[] {
  return [
    'POSITION_RECONCILIATION', 'ORDER_RECONCILIATION', 'POSITION_MANAGEMENT_SCAN',
    'ASSIGNMENT_EXPIRY_RECONCILIATION', 'PENDING_ORDER_MANAGEMENT', 'WAIT_RECHECK',
    'OPPORTUNITY_SCAN', 'ACCOUNT_STATE_REFRESH', 'MARKET_STATE_REFRESH',
    'COPY_FANOUT_PREPARATION', 'HEALTH_HEARTBEAT',
  ].map((jobType) => ({ jobType: jobType as JobType, correlationKey: bucket }));
}

const succeeded = (): JobRunResult => ({ status: 'SUCCEEDED', errorCode: null, errorDetail: null, nextRunAt: null });
const skipped = (code: string): JobRunResult => ({ status: 'SKIPPED', errorCode: code, errorDetail: code, nextRunAt: null });
const degraded = (code: string, nextRunAt: string): JobRunResult => ({ status: 'DEGRADED', errorCode: code, errorDetail: code, nextRunAt });

/**
 * Runs one bounded, restart-safe, read-only production cycle. This module
 * cannot submit, replace, or cancel an order. Its only broker calls are GETs.
 */
export async function runAutonomousRuntimeCycle(
  environment: Environment,
  pool: Pool,
  now = new Date(),
): Promise<AutonomousRuntimeReport> {
  if (!environment.THETA_AUTONOMOUS_WORKER_ENABLED) throw new Error('THETA_AUTONOMOUS_WORKER_DISABLED');
  if (!environment.DATABASE_URL) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
  if (!environment.PAPER_PAUSE_NEW_ORDERS || environment.MASTER_PAPER_EXECUTION_ENABLED || environment.FOLLOWER_PAPER_EXECUTION_ENABLED) {
    throw new Error('FIRST_PAPER_ORDER_BOUNDARY_NOT_LOCKED');
  }
  const bucket = minuteBucket(now);
  const correlationId = `theta-runtime:${bucket}`;
  const workerInstance = `${process.env.VERCEL_REGION ?? 'local'}:${randomUUID()}`;
  const cycleStore = new PostgresRuntimeCycleStore(pool);
  if (!await cycleStore.begin(correlationId, workerInstance, now.toISOString())) {
    return {
      correlationId, status: 'DUPLICATE', runtimeVersion: autonomousRuntimeVersion,
      policyVersion: autonomousPolicyVersion, jobsAttempted: 0, jobsCompleted: 0,
      jobResults: [], reconciliation: null, executionGate: 'LOCKED',
      masterPaperOrdersSubmitted: 0, followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
    };
  }
  try {
  const master = await cycleStore.resolveMasterContext(environment);
  const checkpointStore = new PostgresSchedulerCheckpointRepository(pool, 3);
  const [expired, retryable] = await Promise.all([
    checkpointStore.findExpiredLeases(now.toISOString()),
    checkpointStore.findRetryableFailures(now.toISOString()),
  ]);
  const recoveredJobs: DueJob[] = [...expired, ...retryable].flatMap((record) => {
    const separator = record.jobId.indexOf(':');
    const kind = record.jobKind as JobType;
    return separator > 0 ? [{ jobType: kind, correlationKey: record.jobId.slice(separator + 1) }] : [];
  });
  const jobs = [...recoveredJobs, ...scheduledJobs(bucket)].filter((job, index, all) =>
    all.findIndex((candidate) => candidate.jobType === job.jobType && candidate.correlationKey === job.correlationKey) === index);
  let reconciliation: BrokerReconciliationResult | null = null;
  const retryAt = new Date(now.getTime() + 60_000).toISOString();

  const executor = async (jobType: JobType, _key: string, jobId: string): Promise<JobRunResult> => {
    try {
      if (jobType === 'POSITION_RECONCILIATION') {
        reconciliation = await runReadOnlyBrokerReconciliation({
          broker: master.broker, store: new PostgresBrokerReconciliationStore(pool),
          connectionId: master.connectionId, expectedProviderAccountRef: master.providerAccountRef,
          correlationId: jobId, now: () => new Date().toISOString(),
        });
        if (reconciliation.accountStatus !== 'ACTIVE') return degraded('MASTER_ACCOUNT_NOT_ACTIVE', retryAt);
        return reconciliation.dataQuality === 'GOOD'
          ? succeeded() : degraded('BROKER_SESSION_STATE_UNKNOWN', retryAt);
      }
      if (jobType === 'ORDER_RECONCILIATION') {
        if (master.executionAccountId === null) return skipped('MASTER_EXECUTION_ACCOUNT_NOT_CREATED');
        const coordinator = new PaperOrderCoordinator(
          master.broker, new PostgresPaperOrderStore(pool, master.executionAccountId),
          { pauseNewOrders: true, masterEnabled: false, followerEnabled: false },
        );
        await coordinator.recoverAfterRestart();
        return succeeded();
      }
      if (jobType === 'POSITION_MANAGEMENT_SCAN') {
        const count = await cycleStore.openChainCount();
        return count === 0 ? skipped('NO_OPEN_THETA_CHAINS') : degraded('MANAGEMENT_INPUT_ASSEMBLY_INCOMPLETE', retryAt);
      }
      if (jobType === 'ASSIGNMENT_EXPIRY_RECONCILIATION') {
        return reconciliation === null ? degraded('BROKER_RECONCILIATION_REQUIRED', retryAt) : succeeded();
      }
      if (jobType === 'PENDING_ORDER_MANAGEMENT') {
        return reconciliation === null ? degraded('BROKER_RECONCILIATION_REQUIRED', retryAt) : succeeded();
      }
      if (jobType === 'WAIT_RECHECK') {
        return await cycleStore.dueWaitCount() === 0
          ? skipped('NO_DUE_WAIT_DECISIONS') : degraded('WAIT_REEVALUATION_INPUT_ASSEMBLY_INCOMPLETE', retryAt);
      }
      if (jobType === 'OPPORTUNITY_SCAN') {
        return degraded('PRODUCTION_QUANT_RUNTIME_NOT_DEPLOYABLE_ON_CURRENT_VERCEL_NODE_FUNCTION', retryAt);
      }
      if (jobType === 'COPY_FANOUT_PREPARATION') return skipped('FOLLOWER_SUBMISSION_LOCKED');
      if (jobType === 'ACCOUNT_STATE_REFRESH' || jobType === 'MARKET_STATE_REFRESH') {
        return reconciliation === null || reconciliation.dataQuality !== 'GOOD'
          ? degraded('BROKER_RECONCILIATION_REQUIRED', retryAt) : succeeded();
      }
      return succeeded();
    } catch (error) {
      const failure = safeFailure(error);
      return { status: 'FAILED', errorCode: failure.code, errorDetail: failure.detail, nextRunAt: retryAt };
    }
  };

  const outcomes = await dispatchDueJobs(checkpointStore, {
    workerId: workerInstance, workerVersion: autonomousRuntimeVersion, policyVersion: autonomousPolicyVersion,
    leaseDurationMs: 45_000, maxAttempts: 3,
  }, jobs, () => new Date().toISOString(), executor);
  const jobResults = outcomes.map((outcome) => ({
    jobType: outcome.jobType, outcome: outcome.outcome, status: outcome.runResult?.status ?? null,
    errorCode: outcome.runResult?.errorCode ?? null,
  }));
  const statuses = outcomes.flatMap((outcome) => outcome.runResult?.status ?? []);
  const status: AutonomousRuntimeReport['status'] = statuses.includes('QUARANTINED') ? 'QUARANTINED'
    : statuses.includes('FAILED') ? 'FAILED'
      : statuses.includes('DEGRADED') ? 'DEGRADED' : 'SUCCEEDED';
  const report: AutonomousRuntimeReport = {
    correlationId, status, runtimeVersion: autonomousRuntimeVersion, policyVersion: autonomousPolicyVersion,
    jobsAttempted: outcomes.length,
    jobsCompleted: outcomes.filter((outcome) => outcome.runResult !== null).length,
    jobResults, reconciliation, executionGate: 'LOCKED',
    masterPaperOrdersSubmitted: 0, followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
  };
  await cycleStore.finish(correlationId, report, new Date().toISOString());
  return report;
  } catch (error) {
    const failure = safeFailure(error);
    const report: AutonomousRuntimeReport = {
      correlationId, status: 'FAILED', runtimeVersion: autonomousRuntimeVersion,
      policyVersion: autonomousPolicyVersion, jobsAttempted: 0, jobsCompleted: 0,
      jobResults: [{ jobType: 'HEALTH_HEARTBEAT', outcome: 'STARTUP_FAILED', status: 'FAILED', errorCode: failure.code }],
      reconciliation: null, executionGate: 'LOCKED', masterPaperOrdersSubmitted: 0,
      followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0,
    };
    await cycleStore.finish(correlationId, report, new Date().toISOString());
    return report;
  }
}
