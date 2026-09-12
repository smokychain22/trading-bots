import type { Pool } from 'pg';
import type { AutonomousRuntimeReport } from '../theta/autonomous-runtime.js';

export const masterShadowLeaseKey = 'THETA_MASTER_SHADOW_COLLECTION' as const;
export type WorkerRuntimeState = 'STARTING'|'RECONCILING'|'SHADOW_RUNNING'|'WAITING_FOR_MARKET'|'DEGRADED'|'OFFLINE'|'STOPPING'|'ERROR';

export interface WorkerRegistration {
  readonly workerId: string;
  readonly hostId: string;
  readonly buildSha: string;
  readonly startedAt: string;
  readonly strategyVersions: readonly string[];
}

export interface WorkerRuntimeStore {
  register(input: WorkerRegistration): Promise<string|null>;
  acquireLease(workerId: string, at: string, expiresAt: string): Promise<'ACQUIRED'|'TAKEN_OVER'|'HELD_BY_OTHER'>;
  heartbeat(workerId: string, at: string, expiresAt: string, state: WorkerRuntimeState): Promise<boolean>;
  cycleStarted(workerId: string, at: string): Promise<void>;
  cycleCompleted(workerId: string, report: AutonomousRuntimeReport, at: string): Promise<void>;
  recordResumeGap(workerId: string, gapStartedAt: string, resumedAt: string): Promise<number>;
  stop(workerId: string, at: string, state: 'STOPPING'|'OFFLINE'|'ERROR', reason?: string): Promise<void>;
}

export function completedCandidateEvidenceScan(report:AutonomousRuntimeReport):boolean {
  return report.jobResults.some((row)=>row.jobType==='OPPORTUNITY_SCAN'&&(
    row.status==='SUCCEEDED'||(row.status==='DEGRADED'&&row.errorCode?.startsWith('SHADOW_SCAN_')===true)
  ));
}

export class PostgresWorkerRuntimeStore implements WorkerRuntimeStore {
  constructor(private readonly pool: Pool) {}

  async register(input: WorkerRegistration): Promise<string|null> {
    const previous=await this.pool.query(`SELECT worker_id,last_heartbeat FROM ops.runtime_worker_status
      WHERE host_id=$1 ORDER BY last_heartbeat DESC LIMIT 1`,[input.hostId]);
    await this.pool.query(`INSERT INTO ops.runtime_worker_status(
      worker_id,lease_key,host_id,host_type,runtime_mode,build_sha,runtime_version,policy_version,
      strategy_versions_json,started_at,last_heartbeat,execution_gate,state,database_health)
      VALUES($1,$2,$3,'LOCAL_LAPTOP','THETA_LOCAL_SHADOW',$4,'theta-autonomous-runtime-v1',
        'theta-scheduler-policy-v1',$5::jsonb,$6,$6,'LOCKED','STARTING','GOOD')
      ON CONFLICT(worker_id) DO UPDATE SET build_sha=EXCLUDED.build_sha,runtime_version=EXCLUDED.runtime_version,
        policy_version=EXCLUDED.policy_version,strategy_versions_json=EXCLUDED.strategy_versions_json,
        stopped_at=NULL,last_heartbeat=EXCLUDED.last_heartbeat,state='STARTING',failure_reason=NULL,
        database_health='GOOD',updated_at=EXCLUDED.last_heartbeat`,
    [input.workerId,masterShadowLeaseKey,input.hostId,input.buildSha,JSON.stringify(input.strategyVersions),input.startedAt]);
    if(previous.rows[0]?.worker_id!==input.workerId)
      await this.event(input.workerId,'STARTED',input.startedAt,{buildSha:input.buildSha,runtimeMode:'THETA_LOCAL_SHADOW'});
    const value=previous.rows[0]?.last_heartbeat;
    return value instanceof Date?value.toISOString():value==null?null:String(value);
  }

  async acquireLease(workerId:string,at:string,expiresAt:string):Promise<'ACQUIRED'|'TAKEN_OVER'|'HELD_BY_OTHER'>{
    const previous=await this.pool.query(`SELECT worker_id,expires_at <= $2::timestamptz AS expired
      FROM ops.runtime_worker_lease WHERE lease_key=$1`,[masterShadowLeaseKey,at]);
    const result=await this.pool.query(`INSERT INTO ops.runtime_worker_lease(lease_key,worker_id,acquired_at,heartbeat_at,expires_at)
      VALUES($1,$2,$3,$3,$4)
      ON CONFLICT(lease_key) DO UPDATE SET worker_id=EXCLUDED.worker_id,
        acquired_at=CASE WHEN ops.runtime_worker_lease.worker_id=EXCLUDED.worker_id THEN ops.runtime_worker_lease.acquired_at ELSE EXCLUDED.acquired_at END,
        heartbeat_at=EXCLUDED.heartbeat_at,expires_at=EXCLUDED.expires_at
      WHERE ops.runtime_worker_lease.worker_id=EXCLUDED.worker_id OR ops.runtime_worker_lease.expires_at <= EXCLUDED.heartbeat_at
      RETURNING worker_id`,[masterShadowLeaseKey,workerId,at,expiresAt]);
    if(result.rowCount!==1)return 'HELD_BY_OTHER';
    const takenOver=previous.rowCount===1&&String(previous.rows[0].worker_id)!==workerId&&previous.rows[0].expired===true;
    if(previous.rowCount===0||takenOver)await this.event(workerId,takenOver?'LEASE_TAKEN_OVER':'LEASE_ACQUIRED',at,{});
    return takenOver?'TAKEN_OVER':'ACQUIRED';
  }

  async activeLeaseOwner(at:string):Promise<string|null>{
    const result=await this.pool.query(`SELECT worker_id FROM ops.runtime_worker_lease
      WHERE lease_key=$1 AND expires_at>$2::timestamptz`,[masterShadowLeaseKey,at]);
    return result.rows[0]?.worker_id==null?null:String(result.rows[0].worker_id);
  }

  async heartbeat(workerId:string,at:string,expiresAt:string,state:WorkerRuntimeState):Promise<boolean>{
    const lease=await this.pool.query(`UPDATE ops.runtime_worker_lease SET heartbeat_at=$3,expires_at=$4
      WHERE lease_key=$1 AND worker_id=$2 AND expires_at > $3::timestamptz RETURNING worker_id`,
    [masterShadowLeaseKey,workerId,at,expiresAt]);
    if(lease.rowCount!==1)return false;
    await this.pool.query(`UPDATE ops.runtime_worker_status SET last_heartbeat=$2,state=$3,updated_at=$2,
      failure_reason=CASE WHEN $3 IN ('ERROR','DEGRADED') THEN failure_reason ELSE NULL END WHERE worker_id=$1`,
    [workerId,at,state]);
    return true;
  }

  async cycleStarted(workerId:string,at:string):Promise<void>{
    await this.pool.query(`UPDATE ops.runtime_worker_status SET state='RECONCILING',last_cycle_started=$2,
      last_heartbeat=$2,updated_at=$2 WHERE worker_id=$1`,[workerId,at]);
  }

  async cycleCompleted(workerId:string,report:AutonomousRuntimeReport,at:string):Promise<void>{
    const market=report.reconciliation?.marketOpen===true?'OPEN':report.reconciliation?.marketOpen===false?'CLOSED':'UNKNOWN';
    const failed=report.status==='FAILED'||report.status==='QUARANTINED';
    const degraded=failed||report.status==='DEGRADED';
    const state:WorkerRuntimeState=degraded?'DEGRADED':market==='OPEN'?'SHADOW_RUNNING':market==='CLOSED'?'WAITING_FOR_MARKET':'DEGRADED';
    const candidateScan=completedCandidateEvidenceScan(report);
    await this.pool.query(`UPDATE ops.runtime_worker_status SET state=$3,last_cycle_completed=$2,last_heartbeat=$2,
      last_reconciliation=CASE WHEN $4 THEN $2 ELSE last_reconciliation END,
      last_candidate_scan=CASE WHEN $5 THEN $2 ELSE last_candidate_scan END,
      last_provider_success=CASE WHEN $6 THEN $2 ELSE last_provider_success END,
      market_session=$7,alpaca_health=$8,database_health='GOOD',cycle_count=cycle_count+1,
      consecutive_failures=CASE WHEN $6 THEN 0 ELSE consecutive_failures+1 END,
      failure_reason=$9,updated_at=$2 WHERE worker_id=$1`,
    [workerId,at,state,report.reconciliation!==null,candidateScan,!degraded,market,
      report.reconciliation===null?'DEGRADED':report.reconciliation.dataQuality==='GOOD'?'GOOD':'DEGRADED',
      degraded?report.jobResults.find((row)=>row.status==='FAILED'||row.status==='QUARANTINED'||row.status==='DEGRADED')?.errorCode??report.status:null]);
  }

  async recordResumeGap(workerId:string,gapStartedAt:string,resumedAt:string):Promise<number>{
    const missed=await this.pool.query(`UPDATE research.theta_execution_observation_job SET status='MISSED',
      resolved_at=$2,missing_reason='HOST_OFFLINE' WHERE status='PENDING' AND target_at > $1 AND target_at <= $2`,
    [gapStartedAt,resumedAt]);
    await this.pool.query(`UPDATE ops.runtime_worker_status SET last_sleep_gap_started=$2,last_sleep_gap_ended=$3,
      updated_at=$3 WHERE worker_id=$1`,[workerId,gapStartedAt,resumedAt]);
    await this.event(workerId,'RESUME_GAP',resumedAt,{gapStartedAt,resumedAt,missedObservations:missed.rowCount??0});
    return missed.rowCount??0;
  }

  async stop(workerId:string,at:string,state:'STOPPING'|'OFFLINE'|'ERROR',reason?:string):Promise<void>{
    await this.pool.query(`UPDATE ops.runtime_worker_status SET state=$3,stopped_at=CASE WHEN $3='OFFLINE' THEN $2 ELSE stopped_at END,
      last_heartbeat=$2,failure_reason=$4,updated_at=$2 WHERE worker_id=$1`,[workerId,at,state,reason??null]);
    if(state==='OFFLINE'||state==='ERROR'){
      await this.pool.query(`DELETE FROM ops.runtime_worker_lease WHERE lease_key=$1 AND worker_id=$2`,[masterShadowLeaseKey,workerId]);
    }
    const eventType=state==='OFFLINE'?'STOPPED':state;
    await this.event(workerId,eventType,at,{reason:reason??null});
  }

  private async event(workerId:string,eventType:string,occurredAt:string,detail:Record<string,unknown>):Promise<void>{
    await this.pool.query(`INSERT INTO ops.runtime_worker_event(worker_id,event_type,occurred_at,detail_json)
      VALUES($1,$2,$3,$4::jsonb)`,[workerId,eventType,occurredAt,JSON.stringify(detail)]);
  }
}
