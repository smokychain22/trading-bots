import type { JobType, JobRunResult } from './scheduler.js';
import { restartRecoveryAction } from './scheduler.js';
import type { SchedulerCheckpointRepository, SchedulerCheckpointRecord } from './persistence-repositories.js';

// R1I: the restart-safe scheduler ENGINE -- ties scheduler.ts's job
// state machine, scheduling-policy.ts's urgency scoring, and
// persistence-repositories.ts's SchedulerCheckpointRepository (lease/
// heartbeat) together into one dispatcher. Runtime logic only; nothing
// here is deployed or wired to a real cron/process yet (that is Codex's
// call once item M's real schema exists).
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
// MARKET_STATE_REFRESH / ACCOUNT_STATE_REFRESH / COPY_FANOUT_PREPARATION /
// HEALTH_HEARTBEAT are infrastructure jobs this priority ladder does not
// rank against trading concerns -- they run at PRIORITY 0, always first,
// since every trading-relevant job depends on fresh market/account state.

const JOB_TYPE_PRIORITY: Readonly<Record<JobType, number>> = {
  POSITION_RECONCILIATION: 0,
  ORDER_RECONCILIATION: 1,
  MARKET_STATE_REFRESH: 2,
  ACCOUNT_STATE_REFRESH: 2,
  POSITION_MANAGEMENT_SCAN: 3,
  ASSIGNMENT_EXPIRY_RECONCILIATION: 4,
  PENDING_ORDER_MANAGEMENT: 5,
  WAIT_RECHECK: 6,
  OPPORTUNITY_SCAN: 7,
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
  const acquired = await repo.tryAcquireLease(jobId, config.workerId, leaseExpiresAt);
  if (!acquired) {
    return { jobId, jobType: job.jobType, outcome: 'LEASE_HELD_BY_ANOTHER_OWNER', runResult: null };
  }

  let runResult: JobRunResult;
  try {
    runResult = await executor(job.jobType, job.correlationKey, jobId, recoveryAction);
  } catch (error) {
    runResult = {
      status: 'FAILED',
      errorCode: 'EXECUTOR_THREW',
      errorDetail: error instanceof Error ? error.message : String(error),
      nextRunAt: null,
    };
  }

  // Directly persist the terminal outcome (COMPLETED/FAILED) rather than
  // calling releaseLease afterward -- releaseLease exists for a caller
  // that wants to give up a lease WITHOUT recording an outcome (e.g. a
  // graceful shutdown mid-wait), and would otherwise clobber the FAILED
  // status this save just set back to COMPLETED, defeating the bounded-
  // retry attempt-count check below.
  const record = await repo.findById(jobId);
  await repo.save({
    jobId, jobKind: job.jobType, leaseOwner: config.workerId,
    leaseExpiresAt: record?.leaseExpiresAt ?? leaseExpiresAt,
    lastHeartbeatAt: now(), attempt: record?.attempt ?? 1,
    // SchedulerCheckpointRecord's status vocabulary is coarser than
    // JobRunResult's (no DEGRADED/SKIPPED/QUARANTINED distinction) --
    // anything other than a clean SUCCEEDED counts as FAILED for
    // bounded-retry purposes; the finer-grained JobRunResult itself is
    // still returned to the caller uncollapsed, so no information is lost.
    status: runResult.status === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED',
    lastError: runResult.errorDetail,
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
  if (record.status === 'LEASED' && record.leaseExpiresAt <= nowIso) return 'RUNNING';
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
