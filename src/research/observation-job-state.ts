import type { ObservationJobState } from './contract-path-observation-runtime.js';

export const observationJobStateMachineVersion = 'theta-observation-job-state-machine-v1' as const;

export interface ObservationJobStateRecord {
  readonly state: ObservationJobState;
  readonly targetAt: string;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly claimExpiresAt: string | null;
  readonly resolvedAt: string | null;
  readonly reasonCode: string | null;
}

const terminal = new Set<ObservationJobState>(['OBSERVED', 'MISSED', 'INVALIDATED', 'CENSORED', 'TERMINAL']);
const CODE = /^[A-Z0-9_:-]{1,128}$/;

function timestamp(value: string, reason: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(reason);
  return parsed;
}

export function observationJobDue(record: ObservationJobStateRecord, asOf: string): ObservationJobStateRecord {
  const asOfMs = timestamp(asOf, 'OBSERVATION_JOB_AS_OF_INVALID');
  const targetMs = timestamp(record.targetAt, 'OBSERVATION_JOB_TARGET_INVALID');
  if (terminal.has(record.state)) return record;
  if (record.state === 'IN_PROGRESS') {
    const expires = record.claimExpiresAt === null ? null : timestamp(record.claimExpiresAt, 'OBSERVATION_JOB_CLAIM_INVALID');
    if (expires !== null && expires <= asOfMs) return {
      ...record, state: 'DUE', claimExpiresAt: null, reasonCode: 'RESTART_RECOVERED_EXPIRED_CLAIM',
    };
    return record;
  }
  if (asOfMs < targetMs) return record.state === 'DUE' ? { ...record, state: 'PENDING' } : record;
  return { ...record, state: 'DUE' };
}

export function claimObservationJob(
  record: ObservationJobStateRecord,
  claimedAt: string,
  claimTtlSeconds: number,
): ObservationJobStateRecord {
  const due = observationJobDue(record, claimedAt);
  if (due.state !== 'DUE') throw new Error(`OBSERVATION_JOB_NOT_DUE:${due.state}`);
  if (!Number.isInteger(claimTtlSeconds) || claimTtlSeconds < 1 || claimTtlSeconds > 900) {
    throw new Error('OBSERVATION_JOB_CLAIM_TTL_INVALID');
  }
  const claimedAtMs = timestamp(claimedAt, 'OBSERVATION_JOB_CLAIMED_AT_INVALID');
  return {
    ...due, state: 'IN_PROGRESS', attempts: due.attempts + 1,
    lastAttemptAt: new Date(claimedAtMs).toISOString(),
    claimExpiresAt: new Date(claimedAtMs + claimTtlSeconds * 1_000).toISOString(),
    reasonCode: null,
  };
}

export function deferObservationJob(
  record: ObservationJobStateRecord,
  state: 'DEFERRED_PROVIDER' | 'DEFERRED_MARKET',
  asOf: string,
  reasonCode: string,
): ObservationJobStateRecord {
  if (record.state !== 'IN_PROGRESS') throw new Error(`OBSERVATION_JOB_NOT_CLAIMED:${record.state}`);
  if (!CODE.test(reasonCode)) throw new Error('OBSERVATION_JOB_REASON_INVALID');
  timestamp(asOf, 'OBSERVATION_JOB_AS_OF_INVALID');
  return { ...record, state, claimExpiresAt: null, resolvedAt: null, reasonCode };
}

export function resolveObservationJob(
  record: ObservationJobStateRecord,
  state: 'OBSERVED' | 'MISSED' | 'INVALIDATED' | 'CENSORED' | 'TERMINAL',
  resolvedAt: string,
  reasonCode: string | null,
): ObservationJobStateRecord {
  if (record.state !== 'IN_PROGRESS') throw new Error(`OBSERVATION_JOB_NOT_CLAIMED:${record.state}`);
  const resolvedAtMs = timestamp(resolvedAt, 'OBSERVATION_JOB_RESOLVED_AT_INVALID');
  const targetAtMs = timestamp(record.targetAt, 'OBSERVATION_JOB_TARGET_INVALID');
  if (resolvedAtMs < targetAtMs) throw new Error('OBSERVATION_JOB_RESOLVED_BEFORE_TARGET');
  if (state === 'OBSERVED' && reasonCode !== null) throw new Error('OBSERVATION_JOB_OBSERVED_REASON_FORBIDDEN');
  if (state !== 'OBSERVED' && (reasonCode === null || !CODE.test(reasonCode))) {
    throw new Error('OBSERVATION_JOB_TERMINAL_REASON_REQUIRED');
  }
  return {
    ...record, state, claimExpiresAt: null, resolvedAt: new Date(resolvedAtMs).toISOString(), reasonCode,
  };
}
