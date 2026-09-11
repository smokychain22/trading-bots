// THETA scheduler/worker job model (R1C). Named jobs, not one uncontrolled
// loop -- each job type below corresponds to a distinct runtime concern so
// restart recovery and observability can reason about them independently.

export type JobType =
  | 'MARKET_STATE_REFRESH'
  | 'ACCOUNT_STATE_REFRESH'
  | 'POSITION_RECONCILIATION'
  | 'OPPORTUNITY_SCAN'
  | 'POSITION_MANAGEMENT_SCAN'
  | 'PENDING_ORDER_MANAGEMENT'
  | 'WAIT_RECHECK'
  | 'ORDER_RECONCILIATION'
  | 'ASSIGNMENT_EXPIRY_RECONCILIATION'
  | 'COPY_FANOUT_PREPARATION'
  | 'HEALTH_HEARTBEAT';

export type JobStatus = 'SCHEDULED' | 'RUNNING' | 'SUCCEEDED' | 'DEGRADED' | 'FAILED' | 'SKIPPED' | 'QUARANTINED';

export interface JobRecord {
  readonly jobId: string;
  readonly jobType: JobType;
  readonly scheduledAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly status: JobStatus;
  readonly attemptCount: number;
  readonly policyVersion: string;
  readonly workerVersion: string;
  readonly correlationId: string;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly nextRunAt: string | null;
}

// A RUNNING or FAILED job may only return to SCHEDULED (a bounded retry,
// per the caller's own attempt-count policy) -- never straight back to
// RUNNING, mirroring order-intent-state.ts's UNKNOWN_SUBMISSION discipline:
// a job's actual completion state after an interruption must be checked,
// not assumed either way.
export const JOB_STATUS_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  SCHEDULED: ['RUNNING', 'SKIPPED'],
  RUNNING: ['SUCCEEDED', 'DEGRADED', 'FAILED', 'QUARANTINED'],
  SUCCEEDED: [],
  DEGRADED: ['SCHEDULED'],
  FAILED: ['SCHEDULED'],
  SKIPPED: [],
  // QUARANTINED requires operator intervention -- no automatic transition
  // out, mirroring AEGIS's own KILL/QUARANTINE semantics.
  QUARANTINED: [],
};

export class InvalidJobTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid job status transition: ${from} -> ${to}`);
    this.name = 'InvalidJobTransitionError';
  }
}

export function isValidJobTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

export function assertValidJobTransition(from: JobStatus, to: JobStatus): void {
  if (!isValidJobTransition(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}

export type RestartRecoveryAction = 'RECONCILE_BEFORE_RETRY' | 'SAFE_TO_RESCHEDULE';

/**
 * What to do with a job found in a given status after a process restart.
 * A job discovered RUNNING means the previous process died mid-execution --
 * its actual outcome is unknown until checked (e.g. did it submit an order
 * before dying?), so it must reconcile before any retry, never be silently
 * re-run as if it never started. Every other status is safe to reschedule
 * directly (SUCCEEDED/SKIPPED/QUARANTINED simply aren't rescheduled at all
 * by definition of those terminal/held states).
 */
export function restartRecoveryAction(status: JobStatus): RestartRecoveryAction {
  return status === 'RUNNING' ? 'RECONCILE_BEFORE_RETRY' : 'SAFE_TO_RESCHEDULE';
}

export interface JobRunResult {
  readonly status: Exclude<JobStatus, 'SCHEDULED' | 'RUNNING'>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly nextRunAt: string | null;
}

/**
 * Applies a job's run outcome, validating the transition. Never silently
 * accepts an invalid outcome (e.g. reporting SUCCEEDED from SCHEDULED
 * without ever having recorded RUNNING).
 */
export function completeJob(job: JobRecord, result: JobRunResult, finishedAt: string): JobRecord {
  assertValidJobTransition(job.status, result.status);
  return {
    ...job,
    status: result.status,
    finishedAt,
    errorCode: result.errorCode,
    errorDetail: result.errorDetail,
    nextRunAt: result.nextRunAt,
  };
}
