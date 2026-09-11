import type { Pool } from 'pg';
import type { SchedulerCheckpointRecord, SchedulerCheckpointRepository } from './persistence-repositories.js';

const isoOrNull = (value: unknown): string | null => value === null || value === undefined
  ? null
  : value instanceof Date ? value.toISOString() : String(value);

function jobParts(jobId: string): { jobKind: string; correlationKey: string } {
  const separator = jobId.indexOf(':');
  if (separator < 1 || separator === jobId.length - 1) throw new Error('SCHEDULER_JOB_ID_INVALID');
  return { jobKind: jobId.slice(0, separator), correlationKey: jobId.slice(separator + 1) };
}

function record(row: Record<string, unknown>): SchedulerCheckpointRecord {
  return {
    jobId: String(row.job_id), jobKind: String(row.job_kind), correlationId: String(row.correlation_id ?? row.job_id),
    leaseOwner: row.lease_owner == null ? null : String(row.lease_owner),
    leaseAcquiredAt: isoOrNull(row.lease_acquired_at), leaseExpiresAt: isoOrNull(row.lease_expires_at),
    lastHeartbeatAt: isoOrNull(row.last_heartbeat_at),
    attempt: Number(row.attempt), status: String(row.status) as SchedulerCheckpointRecord['status'],
    resultStatus: row.result_status == null ? null : String(row.result_status) as SchedulerCheckpointRecord['resultStatus'],
    startedAt: isoOrNull(row.started_at), completedAt: isoOrNull(row.completed_at),
    nextEligibleAt: isoOrNull(row.next_eligible_at),
    runtimeVersion: row.runtime_version == null ? null : String(row.runtime_version),
    policyVersion: row.policy_version == null ? null : String(row.policy_version),
    lastError: row.last_error_detail === null ? null : String(row.last_error_detail),
    resultMetadata: row.result_metadata_json != null && typeof row.result_metadata_json === 'object'
      ? row.result_metadata_json as Readonly<Record<string, unknown>> : {},
  };
}

export class PostgresSchedulerCheckpointRepository implements SchedulerCheckpointRepository {
  constructor(private readonly pool: Pool, private readonly maxAttempts = 3) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('SCHEDULER_MAX_ATTEMPTS_INVALID');
  }

  async save(value: SchedulerCheckpointRecord): Promise<void> {
    const { correlationKey } = jobParts(value.jobId);
    const result = await this.pool.query(
      `UPDATE ops.scheduler_checkpoint SET status=$2, last_error_detail=$3, last_error_code=$12,
         result_status=$6, completed_at=$7::timestamptz,
         next_run_at=$8::timestamptz, next_eligible_at=$8::timestamptz,
         runtime_version=$9, policy_version=$10, result_metadata_json=$11::jsonb, updated_at=now()
       WHERE job_id=$1 AND lease_owner=$4 AND attempt=$5`,
      [value.jobId, value.status, value.lastError, value.leaseOwner, value.attempt,
        value.resultStatus, value.completedAt, value.nextEligibleAt,
        value.runtimeVersion, value.policyVersion, JSON.stringify(value.resultMetadata),
        typeof value.resultMetadata.errorCode === 'string' ? value.resultMetadata.errorCode : null],
    );
    if (result.rowCount === 1) return;
    if (value.status !== 'PENDING' || value.attempt !== 0) throw new Error('SCHEDULER_LEASE_LOST');
    await this.pool.query(
      `INSERT INTO ops.scheduler_checkpoint(job_id,job_kind,correlation_key,correlation_id,max_attempts,status,
         runtime_version,policy_version,result_metadata_json)
       VALUES($1,$2,$3,$1,$4,'PENDING',$5,$6,$7::jsonb) ON CONFLICT(job_id) DO NOTHING`,
      [value.jobId, value.jobKind, correlationKey, this.maxAttempts, value.runtimeVersion,
        value.policyVersion, JSON.stringify(value.resultMetadata)],
    );
  }

  async findById(jobId: string): Promise<SchedulerCheckpointRecord | null> {
    const result = await this.pool.query('SELECT * FROM ops.scheduler_checkpoint WHERE job_id=$1', [jobId]);
    return result.rows[0] === undefined ? null : record(result.rows[0]);
  }

  async tryAcquireLease(jobId: string, owner: string, leaseExpiresAt: string, runtimeVersion?: string, policyVersion?: string): Promise<boolean> {
    const { jobKind, correlationKey } = jobParts(jobId);
    await this.pool.query(
      `INSERT INTO ops.scheduler_checkpoint(job_id,job_kind,correlation_key,correlation_id,max_attempts,status,runtime_version,policy_version)
       VALUES($1,$2,$3,$1,$4,'PENDING',$5,$6) ON CONFLICT(job_id) DO NOTHING`,
      [jobId, jobKind, correlationKey, this.maxAttempts, runtimeVersion ?? null, policyVersion ?? null],
    );
    const result = await this.pool.query(
      `UPDATE ops.scheduler_checkpoint SET status='LEASED', lease_owner=$2,
         lease_acquired_at=now(), lease_expires_at=$3::timestamptz, last_heartbeat_at=now(),
         started_at=now(), completed_at=NULL, attempt=attempt+1,
         runtime_version=COALESCE($4,runtime_version), policy_version=COALESCE($5,policy_version),
         result_status=NULL, result_metadata_json='{}'::jsonb,
         last_error_code=NULL, last_error_detail=NULL, updated_at=now()
       WHERE job_id=$1 AND attempt < max_attempts
         AND (next_eligible_at IS NULL OR next_eligible_at <= now())
         AND (status IN ('PENDING','FAILED') OR (status='LEASED' AND lease_expires_at <= now()))
       RETURNING job_id`,
      [jobId, owner, leaseExpiresAt, runtimeVersion ?? null, policyVersion ?? null],
    );
    return result.rowCount === 1;
  }

  async heartbeat(jobId: string, owner: string, leaseExpiresAt: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ops.scheduler_checkpoint SET last_heartbeat_at=now(), lease_expires_at=$3::timestamptz, updated_at=now()
       WHERE job_id=$1 AND lease_owner=$2 AND status='LEASED' AND lease_expires_at > now()
       RETURNING job_id`,
      [jobId, owner, leaseExpiresAt],
    );
    return result.rowCount === 1;
  }

  async releaseLease(jobId: string, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE ops.scheduler_checkpoint SET status='COMPLETED', result_status='SUCCEEDED', completed_at=now(), updated_at=now()
       WHERE job_id=$1 AND lease_owner=$2 AND status='LEASED'`,
      [jobId, owner],
    );
  }

  async findExpiredLeases(asOfIso: string): Promise<readonly SchedulerCheckpointRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ops.scheduler_checkpoint
       WHERE status='LEASED' AND lease_expires_at <= $1::timestamptz ORDER BY lease_expires_at`,
      [asOfIso],
    );
    return result.rows.map(record);
  }

  async findRetryableFailures(asOfIso: string): Promise<readonly SchedulerCheckpointRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ops.scheduler_checkpoint
       WHERE status='FAILED' AND attempt < max_attempts
         AND next_eligible_at IS NOT NULL AND next_eligible_at <= $1::timestamptz
       ORDER BY next_eligible_at`,
      [asOfIso],
    );
    return result.rows.map(record);
  }
}
