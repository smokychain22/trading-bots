import type { Pool } from 'pg';
import type { SchedulerCheckpointRecord, SchedulerCheckpointRepository } from './persistence-repositories.js';

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);

function jobParts(jobId: string): { jobKind: string; correlationKey: string } {
  const separator = jobId.indexOf(':');
  if (separator < 1 || separator === jobId.length - 1) throw new Error('SCHEDULER_JOB_ID_INVALID');
  return { jobKind: jobId.slice(0, separator), correlationKey: jobId.slice(separator + 1) };
}

function record(row: Record<string, unknown>): SchedulerCheckpointRecord {
  return {
    jobId: String(row.job_id), jobKind: String(row.job_kind), leaseOwner: String(row.lease_owner),
    leaseExpiresAt: iso(row.lease_expires_at), lastHeartbeatAt: iso(row.last_heartbeat_at),
    attempt: Number(row.attempt), status: String(row.status) as SchedulerCheckpointRecord['status'],
    lastError: row.last_error_detail === null ? null : String(row.last_error_detail),
  };
}

export class PostgresSchedulerCheckpointRepository implements SchedulerCheckpointRepository {
  constructor(private readonly pool: Pool, private readonly maxAttempts = 3) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('SCHEDULER_MAX_ATTEMPTS_INVALID');
  }

  async save(value: SchedulerCheckpointRecord): Promise<void> {
    const { correlationKey } = jobParts(value.jobId);
    const result = await this.pool.query(
      `UPDATE ops.scheduler_checkpoint SET status=$2, last_error_detail=$3,
         next_run_at=NULL, updated_at=now()
       WHERE job_id=$1 AND lease_owner=$4 AND attempt=$5`,
      [value.jobId, value.status, value.lastError, value.leaseOwner, value.attempt],
    );
    if (result.rowCount === 1) return;
    if (value.status !== 'PENDING' || value.attempt !== 0) throw new Error('SCHEDULER_LEASE_LOST');
    await this.pool.query(
      `INSERT INTO ops.scheduler_checkpoint(job_id,job_kind,correlation_key,max_attempts,status)
       VALUES($1,$2,$3,$4,'PENDING') ON CONFLICT(job_id) DO NOTHING`,
      [value.jobId, value.jobKind, correlationKey, this.maxAttempts],
    );
  }

  async findById(jobId: string): Promise<SchedulerCheckpointRecord | null> {
    const result = await this.pool.query('SELECT * FROM ops.scheduler_checkpoint WHERE job_id=$1', [jobId]);
    return result.rows[0] === undefined ? null : record(result.rows[0]);
  }

  async tryAcquireLease(jobId: string, owner: string, leaseExpiresAt: string): Promise<boolean> {
    const { jobKind, correlationKey } = jobParts(jobId);
    await this.pool.query(
      `INSERT INTO ops.scheduler_checkpoint(job_id,job_kind,correlation_key,max_attempts,status)
       VALUES($1,$2,$3,$4,'PENDING') ON CONFLICT(job_id) DO NOTHING`,
      [jobId, jobKind, correlationKey, this.maxAttempts],
    );
    const result = await this.pool.query(
      `UPDATE ops.scheduler_checkpoint SET status='LEASED', lease_owner=$2,
         lease_expires_at=$3::timestamptz, last_heartbeat_at=now(), attempt=attempt+1,
         last_error_code=NULL, last_error_detail=NULL, updated_at=now()
       WHERE job_id=$1 AND attempt < max_attempts
         AND (status IN ('PENDING','FAILED') OR (status='LEASED' AND lease_expires_at <= now()))
       RETURNING job_id`,
      [jobId, owner, leaseExpiresAt],
    );
    return result.rowCount === 1;
  }

  async releaseLease(jobId: string, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE ops.scheduler_checkpoint SET status='COMPLETED', updated_at=now()
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
}
