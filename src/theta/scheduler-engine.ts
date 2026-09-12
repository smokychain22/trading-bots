import type { JobType, JobRunResult } from './scheduler.js';
import { restartRecoveryAction } from './scheduler.js';
import type { SchedulerCheckpointRepository, SchedulerCheckpointRecord } from './persistence-repositories.js';

// R1I: the restart-safe scheduler ENGINE -- ties scheduler.ts's job
// state machine, scheduling-policy.ts's urgency scoring, and
// persistence-repositories.ts's SchedulerCheckpointRepository (lease/
// heartbeat) together into one dispatcher. The production serverless
// entry point invokes this engine through autonomous-runtime.ts.
//
// PRIORITY ORDER (fixed, per the R1 roadmap's explicit instruction --
// never re-ordered by urgency scoring, which only affects INTERVAL
// within a job type, not cross-type precedence):
//   1. broker reconciliation (POSITION_RECONCILIATION)
//   2. ambiguous previous order-state reconciliation (ORDER_RECONCILIATION)
//   3. open-position management (POSITION_MANAGEMENT_SCAN)
//   4. expiration/assignment-sensitive management (ASSIGNMENT_EXPIRY_RECONCILIATION)
//   5. pending-order management (already covered by ORDER_RECONCILIATION,
//      kept as a single reconciliation family rather than a duplicate
//      concept -- see note below)
//   6. WAIT rechecks (WAIT_RECHECK)
//   7. new opportunity scanning (OPPORTUNITY_SCAN)
// MARKET_STATE_REFRESH / ACCOUNT_STATE_REFRESH are supporting observations.
// Executors refresh prerequisites inline when needed, so these standalone
// jobs never jump ahead of reconciliation or management.

const JOB_TYPE_PRIORITY: Readonly<Record<JobType, number>> = {
  POSITION_RECONCILIATION: 0,
  ORDER_RECONCILIATION: 1,
  ASSIGNMENT_EXPIRY_RECONCILIATION: 2,
  POSITION_MANAGEMENT_SCAN: 3,
  PENDING_ORDER_MANAGEMENT: 4,
  WAIT_RECHECK: 5,
  OPPORTUNITY_SCAN: 6,
  ACCOUNT_STATE_REFRESH: 7,
  MARKET_STATE_REFRESH: 7,
  COPY_FANOUT_PREPARATION: 8,
  HEALTH_HEARTBEAT: 9,
};

export function comparePriority(a: JobType, b: JobType): number {
  return JOB_TYPE_PRIORITY[a] - JOB_TYPE_PRIORITY[b];
}

/**
 * Deterministic job identity: the SAME (jobType, correlationKey) always
 * produces the SAME job id -- this is what makes lease acquisition
 * duplicate-work-safe (two dispatcher instances racing to schedule the
 * same logical job collide on the same row, one wins the lease, never
 * two rows for the same real-world work item) and idempotent across a
 * restart (a job re-discovered after a crash is recognized as the same
 * job, not scheduled fresh). correlationKey should be the narrowest
 * identity that makes the job unique -- a chain id for a per-chain scan,
 * a broker order id for a reconciliation, or a fixed literal for a
 * singleton job like MARKET_STATE_REFRESH.
 */
export function deterministicJobId(jobType: JobType, correlationKey: string): string {
  return `${jobType}:${correlationKey}`;
}

export interface SchedulerEngineConfig {
  readonly workerId: string;
  readonly workerVersion: string;
  readonly policyVersion: string;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
}

export interface DueJob {
  readonly jobType: JobType;
  readonly correlationKey: string;
}

export interface DispatchOutcome {
  readonly jobId: string;
  readonly jobType: JobType;
  readonly outcome: 'RAN' | 'RECOVERY_RECONCILIATION_RAN' | 'LEASE_HELD_BY_ANOTHER_OWNER' | 'MAX_ATTEMPTS_EXCEEDED';
  readonly runResult: JobRunResult | null;
}

export type JobExecutor = (jobType: JobType, correlationKey: string, jobId: string, recoveryAction: 'SAFE_TO_RESCHEDULE' | 'RECONCILE_BEFORE_RETRY') => Promise<JobRunResult>;

/**
 * Sorts due jobs by the fixed priority ladder (stable within a priority
 * tier -- ties keep their original relative order, never re-shuffled).
 */
export function prioritizeDueJobs(jobs: readonly DueJob[]): readonly DueJob[] {
  return [...jobs]
    .map((job, index) => ({ job, index }))
    .sort((a, b) => comparePriority(a.job.jobType, b.job.jobType) || a.index - b.index)
    .map(({ job }) => job);
}

/**
 * Dispatches one due job: acquires its deterministic lease (never runs
 * without one, so two dispatcher instances can never both execute the
 * same logical job), checks for a crash-recovered RUNNING checkpoint
 * (which must reconcile before any retry -- never blindly re-run, per
 * scheduler.ts's own restartRecoveryAction discipline), enforces the
 * bounded-retry cap, runs the caller-supplied executor, and persists the
 * outcome. Never retries an ambiguous broker mutation itself -- that
 * judgment belongs to the executor (e.g. ORDER_RECONCILIATION's own
 * logic), this engine only enforces that reconciliation is attempted
 * before any other retry of the same job id.
 */
export async function dispatchOneJob(
  repo: SchedulerCheckpointRepository,
  config: SchedulerEngineConfig,
  job: DueJob,
  now: () => string,
  executor: JobExecutor,
): Promise<DispatchOutcome> {
  const jobId = deterministicJobId(job.jobType, job.correlationKey);
  const existing = await repo.findById(jobId);

  const recoveryAction = existing === null
    ? 'SAFE_TO_RESCHEDULE' as const
    : restartRecoveryAction(jobStatusFromCheckpoint(existing, now()));

  if (existing !== null && existing.attempt >= config.maxAttempts && existing.status !== 'COMPLETED') {
    return { jobId, jobType: job.jobType, outcome: 'MAX_ATTEMPTS_EXCEEDED', runResult: null };
  }

  const leaseExpiresAt = new Date(Date.parse(now()) + config.leaseDurationMs).toISOString();
  const acquired = await repo.tryAcquireLease(
    jobId, config.workerId, leaseExpiresAt, config.workerVersion, config.policyVersion,
  );
  if (!acquired) {
    return { jobId, jobType: job.jobType, outcome: 'LEASE_HELD_BY_ANOTHER_OWNER', runResult: null };
  }

  let runResult: JobRunResult;
  let heartbeatFailed = false;
  const heartbeatIntervalMs = Math.max(1_000, Math.min(15_000, Math.floor(config.leaseDurationMs / 3)));
  const heartbeat = setInterval(() => {
    const extendedLease = new Date(Date.now() + config.leaseDurationMs).toISOString();
    void repo.heartbeat(jobId, config.workerId, extendedLease).then((renewed) => {
      if (!renewed) heartbeatFailed = true;
    }).catch(() => { heartbeatFailed = true; });
  }, heartbeatIntervalMs);
  try {
    runResult = await executor(job.jobType, job.correlationKey, jobId, recoveryAction);
  } catch (error) {
    runResult = {
      status: 'FAILED',
      errorCode: 'EXECUTOR_THREW',
      errorDetail: error instanceof Error ? error.message : String(error),
      nextRunAt: null,
    };
  } finally {
    clearInterval(heartbeat);
  }
  if (heartbeatFailed && runResult.status === 'SUCCEEDED') {
    runResult = {
      status: 'DEGRADED', errorCode: 'LEASE_HEARTBEAT_FAILED',
      errorDetail: 'The job completed, but its lease heartbeat could not be confirmed.',
      nextRunAt: runResult.nextRunAt,
    };
  }

  // Directly persist the terminal outcome (COMPLETED/FAILED) rather than
  // calling releaseLease afterward -- releaseLease exists for a caller
  // that wants to give up a lease WITHOUT recording an outcome (e.g. a
  // graceful shutdown mid-wait), and would otherwise clobber the FAILED
  // status this save just set back to COMPLETED, defeating the bounded-
  // retry attempt-count check below.
  const record = await repo.findById(jobId);
  const finishedAt = now();
  const terminalStatus: SchedulerCheckpointRecord['status'] = runResult.status === 'QUARANTINED'
    ? 'ABANDONED'
    : runResult.status === 'SUCCEEDED' || runResult.status === 'SKIPPED' ? 'COMPLETED' : 'FAILED';
  await repo.save({
    jobId, jobKind: job.jobType, leaseOwner: config.workerId,
    correlationId: jobId,
    leaseAcquiredAt: record?.leaseAcquiredAt ?? null,
    leaseExpiresAt: record?.leaseExpiresAt ?? leaseExpiresAt,
    lastHeartbeatAt: record?.lastHeartbeatAt ?? finishedAt, attempt: record?.attempt ?? 1,
    status: terminalStatus, resultStatus: runResult.status,
    startedAt: record?.startedAt ?? null, completedAt: finishedAt,
    nextEligibleAt: runResult.nextRunAt,
    runtimeVersion: config.workerVersion, policyVersion: config.policyVersion,
    lastError: runResult.errorDetail,
    resultMetadata: { errorCode: runResult.errorCode },
  });

  return { jobId, jobType: job.jobType,
    outcome: recoveryAction === 'RECONCILE_BEFORE_RETRY' ? 'RECOVERY_RECONCILIATION_RAN' : 'RAN', runResult };
}

/**
 * Maps a persisted SchedulerCheckpointRecord back to the coarse
 * RUNNING/other distinction restartRecoveryAction needs: a checkpoint
 * whose lease has NOT yet expired and is still LEASED is, from this
 * process's perspective, indistinguishable from "still running
 * somewhere" -- and per this engine's crash-recovery discipline, an
 * EXPIRED lease found still marked LEASED is exactly the "process died
 * mid-execution" case restartRecoveryAction exists to catch.
 */
function jobStatusFromCheckpoint(record: SchedulerCheckpointRecord, nowIso: string): 'RUNNING' | 'SCHEDULED' {
  if (record.status === 'LEASED' && record.leaseExpiresAt !== null && record.leaseExpiresAt <= nowIso) return 'RUNNING';
  return 'SCHEDULED';
}

export async function dispatchDueJobs(
  repo: SchedulerCheckpointRepository,
  config: SchedulerEngineConfig,
  jobs: readonly DueJob[],
  now: () => string,
  executor: JobExecutor,
): Promise<readonly DispatchOutcome[]> {
  const prioritized = prioritizeDueJobs(jobs);
  const outcomes: DispatchOutcome[] = [];
  for (const job of prioritized) {
    outcomes.push(await dispatchOneJob(repo, config, job, now, executor));
  }
  return outcomes;
}
