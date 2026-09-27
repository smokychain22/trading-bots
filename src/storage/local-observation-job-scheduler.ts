import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import {
  claimObservationJob, deferObservationJob, observationJobDue, resolveObservationJob,
  type ObservationJobStateRecord,
} from '../research/observation-job-state.js';
import type { StrategyLearningObservationJob } from '../research/strategy-learning-horizon.js';
import type { ShadowEpisodeContract } from '../research/shadow-episode-contract.js';

export const localObservationJobSchedulerVersion = 'theta-local-observation-job-scheduler-v2' as const;

export interface LocalObservationJobReceipt extends ObservationJobStateRecord {
  readonly observationJobId: string;
  readonly subjectId: string;
  readonly horizonCode: StrategyLearningObservationJob['horizonCode'];
  readonly targetSessionDate: string | null;
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly contentHash: string;
  readonly claimedBy: string | null;
  readonly brokerAuthority: false;
}

export interface LocalObservationSubjectReceipt {
  readonly subjectId: string;
  readonly decisionCycleId: string;
  readonly underlying: string;
  readonly episode: ShadowEpisodeContract;
  readonly sourceSha: string;
  readonly workerSha: string;
  readonly contentHash: string;
  readonly brokerAuthority: false;
}

type JobRow = {
  observation_job_id: string;
  subject_id: string;
  horizon_code: StrategyLearningObservationJob['horizonCode'];
  target_at: string;
  target_session_date: string | null;
  source_sha: string;
  worker_sha: string;
  content_hash: string;
  state: ObservationJobStateRecord['state'];
  attempts: number;
  last_attempt_at: string | null;
  claim_expires_at: string | null;
  resolved_at: string | null;
  reason_code: string | null;
  claimed_by: string | null;
};

type SubjectRow = {
  subject_id: string;
  decision_cycle_id: string;
  underlying: string;
  episode_json: string;
  source_sha: string;
  worker_sha: string;
  content_hash: string;
};

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,512}$/;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,31}$/;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function toReceipt(row: JobRow): LocalObservationJobReceipt {
  return {
    observationJobId: row.observation_job_id,
    subjectId: row.subject_id,
    horizonCode: row.horizon_code,
    targetAt: row.target_at,
    targetSessionDate: row.target_session_date,
    sourceSha: row.source_sha,
    workerSha: row.worker_sha,
    contentHash: row.content_hash,
    state: row.state,
    attempts: Number(row.attempts),
    lastAttemptAt: row.last_attempt_at,
    claimExpiresAt: row.claim_expires_at,
    resolvedAt: row.resolved_at,
    reasonCode: row.reason_code,
    claimedBy: row.claimed_by,
    brokerAuthority: false,
  };
}

function toSubjectReceipt(row: SubjectRow): LocalObservationSubjectReceipt {
  const episode = JSON.parse(row.episode_json) as ShadowEpisodeContract;
  if (episode.subjectId !== row.subject_id || episode.contentHash !== row.content_hash) {
    throw new Error('LOCAL_OBSERVATION_SUBJECT_INTEGRITY_INVALID');
  }
  return {
    subjectId: row.subject_id,
    decisionCycleId: row.decision_cycle_id,
    underlying: row.underlying,
    episode,
    sourceSha: row.source_sha,
    workerSha: row.worker_sha,
    contentHash: row.content_hash,
    brokerAuthority: false,
  };
}

function persistState(database: DatabaseSync, row: JobRow, state: ObservationJobStateRecord,
  claimedBy: string | null): void {
  database.prepare(`UPDATE observation_job SET state=?,attempts=?,last_attempt_at=?,claim_expires_at=?,
    resolved_at=?,reason_code=?,claimed_by=?,updated_at=? WHERE observation_job_id=?`).run(
    state.state, state.attempts, state.lastAttemptAt, state.claimExpiresAt, state.resolvedAt,
    state.reasonCode, claimedBy, new Date().toISOString(), row.observation_job_id,
  );
}

/**
 * Restart-safe, local research-only scheduler. PostgreSQL outages cannot erase
 * future observation jobs, and this database has no Production consumer.
 */
export class LocalObservationJobScheduler {
  private readonly database: DatabaseSync;

  constructor(path = '.theta-local-worker/research-spool/theta-observation-jobs.sqlite') {
    const databasePath = resolve(path);
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.database.exec(`CREATE TABLE IF NOT EXISTS observation_job(
      observation_job_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      horizon_code TEXT NOT NULL,
      target_at TEXT NOT NULL,
      target_session_date TEXT,
      source_sha TEXT NOT NULL,
      worker_sha TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL CHECK(attempts >= 0),
      last_attempt_at TEXT,
      claim_expires_at TEXT,
      resolved_at TEXT,
      reason_code TEXT,
      claimed_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_observation_job_due
        ON observation_job(state,target_at,observation_job_id);
      CREATE TABLE IF NOT EXISTS observation_subject(
        subject_id TEXT PRIMARY KEY,
        decision_cycle_id TEXT NOT NULL,
        underlying TEXT NOT NULL,
        episode_json TEXT NOT NULL,
        source_sha TEXT NOT NULL,
        worker_sha TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_observation_subject_cycle
        ON observation_subject(decision_cycle_id,subject_id);`);
  }

  close(): void { this.database.close(); }

  registerSubject(input: {
    readonly decisionCycleId: string;
    readonly underlying: string;
    readonly episode: ShadowEpisodeContract;
  }): LocalObservationSubjectReceipt {
    if (!SAFE_ID.test(input.decisionCycleId) || !SYMBOL.test(input.underlying)
      || !SHA256.test(input.episode.subjectId) || !SHA40.test(input.episode.sourceSha)
      || !SHA40.test(input.episode.workerSha) || !SHA256.test(input.episode.contentHash)
      || input.episode.brokerAuthority !== false || input.episode.shadowOnly !== true
      || input.episode.orderSubmitted !== false || input.episode.brokerFill !== false) {
      throw new Error('LOCAL_OBSERVATION_SUBJECT_INVALID');
    }
    const episodeJson = canonicalJson(input.episode);
    const existing = this.database.prepare('SELECT * FROM observation_subject WHERE subject_id=?')
      .get(input.episode.subjectId) as SubjectRow | undefined;
    if (existing !== undefined) {
      if (existing.decision_cycle_id !== input.decisionCycleId || existing.underlying !== input.underlying
        || existing.episode_json !== episodeJson || existing.source_sha !== input.episode.sourceSha
        || existing.worker_sha !== input.episode.workerSha || existing.content_hash !== input.episode.contentHash) {
        throw new Error('LOCAL_OBSERVATION_SUBJECT_IDENTITY_CONFLICT');
      }
      return toSubjectReceipt(existing);
    }
    this.database.prepare(`INSERT INTO observation_subject(subject_id,decision_cycle_id,underlying,episode_json,
      source_sha,worker_sha,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
      input.episode.subjectId, input.decisionCycleId, input.underlying, episodeJson,
      input.episode.sourceSha, input.episode.workerSha, input.episode.contentHash, new Date().toISOString(),
    );
    return this.getSubject(input.episode.subjectId);
  }

  getSubject(subjectId: string): LocalObservationSubjectReceipt {
    const row = this.database.prepare('SELECT * FROM observation_subject WHERE subject_id=?')
      .get(subjectId) as SubjectRow | undefined;
    if (row === undefined) throw new Error('LOCAL_OBSERVATION_SUBJECT_NOT_FOUND');
    return toSubjectReceipt(row);
  }

  subjectCount(): number {
    const row = this.database.prepare('SELECT count(*) AS count FROM observation_subject').get() as { count: number };
    return Number(row.count);
  }

  schedule(input: {
    readonly job: StrategyLearningObservationJob;
    readonly sourceSha: string;
    readonly workerSha: string;
  }): LocalObservationJobReceipt {
    if (input.job.targetState !== 'SCHEDULED' || input.job.targetAt === null
      || !SAFE_ID.test(input.job.observationJobId) || !SAFE_ID.test(input.job.subjectId)
      || !SHA40.test(input.sourceSha) || !SHA40.test(input.workerSha)) {
      throw new Error('LOCAL_OBSERVATION_JOB_SCHEDULE_INVALID');
    }
    const targetAt = new Date(input.job.targetAt);
    if (!Number.isFinite(targetAt.getTime())) throw new Error('LOCAL_OBSERVATION_JOB_TARGET_INVALID');
    const immutable = {
      observationJobId: input.job.observationJobId,
      subjectId: input.job.subjectId,
      horizonCode: input.job.horizonCode,
      targetAt: targetAt.toISOString(),
      targetSessionDate: input.job.targetSessionDate,
      sourceSha: input.sourceSha,
      workerSha: input.workerSha,
    };
    const contentHash = hash(canonicalJson(immutable));
    const existing = this.database.prepare('SELECT * FROM observation_job WHERE observation_job_id=?')
      .get(input.job.observationJobId) as JobRow | undefined;
    if (existing !== undefined) {
      if (existing.content_hash !== contentHash) throw new Error('LOCAL_OBSERVATION_JOB_IDENTITY_CONFLICT');
      return toReceipt(existing);
    }
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO observation_job(observation_job_id,subject_id,horizon_code,target_at,
      target_session_date,source_sha,worker_sha,content_hash,state,attempts,last_attempt_at,claim_expires_at,
      resolved_at,reason_code,claimed_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'PENDING',0,NULL,NULL,NULL,NULL,NULL,?,?)`).run(
      input.job.observationJobId, input.job.subjectId, input.job.horizonCode, targetAt.toISOString(),
      input.job.targetSessionDate, input.sourceSha, input.workerSha, contentHash, now, now,
    );
    return this.get(input.job.observationJobId);
  }

  get(observationJobId: string): LocalObservationJobReceipt {
    const row = this.database.prepare('SELECT * FROM observation_job WHERE observation_job_id=?')
      .get(observationJobId) as JobRow | undefined;
    if (row === undefined) throw new Error('LOCAL_OBSERVATION_JOB_NOT_FOUND');
    return toReceipt(row);
  }

  claimDue(input: {
    readonly asOf: string;
    readonly claimedBy: string;
    readonly claimTtlSeconds: number;
    readonly limit?: number;
  }): readonly LocalObservationJobReceipt[] {
    if (!SAFE_ID.test(input.claimedBy)) throw new Error('LOCAL_OBSERVATION_JOB_CLAIMER_INVALID');
    const asOfMs = Date.parse(input.asOf);
    if (!Number.isFinite(asOfMs)) throw new Error('LOCAL_OBSERVATION_JOB_AS_OF_INVALID');
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 128)) {
      throw new Error('LOCAL_OBSERVATION_JOB_LIMIT_INVALID');
    }
    const limit = input.limit ?? 16;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const rows = this.database.prepare(`SELECT * FROM observation_job
        WHERE state IN ('PENDING','DUE','DEFERRED_PROVIDER','DEFERRED_MARKET','IN_PROGRESS')
        ORDER BY target_at,observation_job_id LIMIT ?`).all(limit * 4) as unknown as JobRow[];
      const claimed: LocalObservationJobReceipt[] = [];
      for (const row of rows) {
        if (claimed.length >= limit) break;
        const due = observationJobDue(toReceipt(row), input.asOf);
        if (due.state !== 'DUE') continue;
        const next = claimObservationJob(due, input.asOf, input.claimTtlSeconds);
        persistState(this.database, row, next, input.claimedBy);
        claimed.push(this.get(row.observation_job_id));
      }
      this.database.exec('COMMIT');
      return claimed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  defer(input: {
    readonly observationJobId: string;
    readonly claimedBy: string;
    readonly state: 'DEFERRED_PROVIDER' | 'DEFERRED_MARKET';
    readonly asOf: string;
    readonly reasonCode: string;
  }): LocalObservationJobReceipt {
    const row = this.database.prepare('SELECT * FROM observation_job WHERE observation_job_id=?')
      .get(input.observationJobId) as JobRow | undefined;
    if (row === undefined) throw new Error('LOCAL_OBSERVATION_JOB_NOT_FOUND');
    if (row.claimed_by !== input.claimedBy) throw new Error('LOCAL_OBSERVATION_JOB_CLAIM_OWNER_MISMATCH');
    const next = deferObservationJob(toReceipt(row), input.state, input.asOf, input.reasonCode);
    persistState(this.database, row, next, null);
    return this.get(input.observationJobId);
  }

  resolve(input: {
    readonly observationJobId: string;
    readonly claimedBy: string;
    readonly state: 'OBSERVED' | 'MISSED' | 'INVALIDATED' | 'CENSORED' | 'TERMINAL';
    readonly resolvedAt: string;
    readonly reasonCode: string | null;
  }): LocalObservationJobReceipt {
    const row = this.database.prepare('SELECT * FROM observation_job WHERE observation_job_id=?')
      .get(input.observationJobId) as JobRow | undefined;
    if (row === undefined) throw new Error('LOCAL_OBSERVATION_JOB_NOT_FOUND');
    if (row.claimed_by !== input.claimedBy) throw new Error('LOCAL_OBSERVATION_JOB_CLAIM_OWNER_MISMATCH');
    const next = resolveObservationJob(toReceipt(row), input.state, input.resolvedAt, input.reasonCode);
    persistState(this.database, row, next, null);
    return this.get(input.observationJobId);
  }

  counts(): Readonly<Record<string, number>> {
    const rows = this.database.prepare('SELECT state,count(*) AS count FROM observation_job GROUP BY state')
      .all() as unknown as Array<{ state: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]));
  }
}
