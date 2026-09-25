import { createHash,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { createRuntimePostgresPool } from '../theta/runtime-postgres-pool.js';

export type OperatorControlCommand='PAUSE_NEW_ENTRIES'|'RESUME_NEW_ENTRIES'|'EMERGENCY_EXECUTION_LOCK'|'CLEAR_EMERGENCY_LOCK';
export interface OperatorControlState {readonly newEntriesPaused:boolean;readonly emergencyExecutionLock:boolean;
  readonly brokerSubmissionBlocked:boolean;readonly reconciliationEnabled:true;readonly managementEnabled:true;
  readonly source:'DEFAULT'|'OPERATOR_EVENT';readonly asOf:string|null;readonly stateVersion:number;}
const base=(paused:boolean):OperatorControlState=>({newEntriesPaused:paused,emergencyExecutionLock:false,
  brokerSubmissionBlocked:paused,reconciliationEnabled:true,managementEnabled:true,source:'DEFAULT',asOf:null,stateVersion:0});
export function applyOperatorControl(previous:OperatorControlState,command:OperatorControlCommand,at:string):OperatorControlState{
  const nextVersion=previous.stateVersion+1;
  if(command==='PAUSE_NEW_ENTRIES')return {...previous,newEntriesPaused:true,brokerSubmissionBlocked:true,source:'OPERATOR_EVENT',asOf:at,stateVersion:nextVersion};
  if(command==='EMERGENCY_EXECUTION_LOCK')return {...previous,newEntriesPaused:true,emergencyExecutionLock:true,
    brokerSubmissionBlocked:true,source:'OPERATOR_EVENT',asOf:at,stateVersion:nextVersion};
  if(command==='CLEAR_EMERGENCY_LOCK')return {...previous,newEntriesPaused:true,emergencyExecutionLock:false,
    brokerSubmissionBlocked:true,source:'OPERATOR_EVENT',asOf:at,stateVersion:nextVersion};
  return {...previous,newEntriesPaused:false,brokerSubmissionBlocked:previous.emergencyExecutionLock,source:'OPERATOR_EVENT',asOf:at,stateVersion:nextVersion};
}
export class PostgresOperatorControlStore{
  private readonly pool:Pool;
  private readonly ownsPool:boolean;
  constructor(databaseUrlOrPool:string|Pool){
    this.ownsPool=typeof databaseUrlOrPool==='string';
    this.pool=typeof databaseUrlOrPool==='string'
      ?createRuntimePostgresPool(databaseUrlOrPool,undefined,{maximumConnections:1,applicationName:'theta-operator-control'})
      :databaseUrlOrPool;
  }
  async close():Promise<void>{if(this.ownsPool)await this.pool.end();}
  async current(defaultPaused:boolean):Promise<OperatorControlState>{
    const {value:result}=await withRuntimePostgresReadRetry(this.pool,(client)=>client.query(
      `SELECT resulting_state_json,requested_at,state_version FROM ops.theta_operator_control_event
      ORDER BY state_version DESC,created_at DESC LIMIT 1`));
    if(result.rowCount!==1)return base(defaultPaused);
    const raw=result.rows[0]?.resulting_state_json as Partial<OperatorControlState>|undefined;
    return {newEntriesPaused:raw?.newEntriesPaused===true,emergencyExecutionLock:raw?.emergencyExecutionLock===true,
      brokerSubmissionBlocked:raw?.brokerSubmissionBlocked!==false,reconciliationEnabled:true,managementEnabled:true,
      source:'OPERATOR_EVENT',asOf:String(result.rows[0]?.requested_at),stateVersion:Number(result.rows[0]?.state_version??0)};
  }
  async apply(input:{actorRef:string;command:OperatorControlCommand;idempotencyKey:string;confirmed:boolean;
    requestedAt:string;defaultPaused:boolean;observedStateVersion:number;reason:string|null}):Promise<OperatorControlState>{
    if(!input.confirmed)throw new Error('OPERATOR_CONFIRMATION_REQUIRED');
    if(!/^[A-Za-z0-9._:-]{12,128}$/.test(input.idempotencyKey))throw new Error('IDEMPOTENCY_KEY_INVALID');
    if(!Number.isInteger(input.observedStateVersion)||input.observedStateVersion<0)throw new Error('OBSERVED_STATE_VERSION_INVALID');
    if(input.command==='CLEAR_EMERGENCY_LOCK'&&(input.reason??'').trim().length<12)throw new Error('EMERGENCY_CLEAR_REASON_REQUIRED');
    return withRuntimePostgresTransaction(this.pool,async(client)=>{await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-operator-control'))`);
    const replay=await client.query(`SELECT resulting_state_json FROM ops.theta_operator_control_event WHERE idempotency_key=$1`,[input.idempotencyKey]);
    if(replay.rowCount===1)return replay.rows[0]?.resulting_state_json as OperatorControlState;
    const currentResult=await client.query(`SELECT resulting_state_json,requested_at,state_version FROM ops.theta_operator_control_event
      ORDER BY state_version DESC,created_at DESC LIMIT 1`);
    const raw=currentResult.rows[0]?.resulting_state_json as Partial<OperatorControlState>|undefined;
    const previous=currentResult.rowCount===1?{newEntriesPaused:raw?.newEntriesPaused===true,emergencyExecutionLock:raw?.emergencyExecutionLock===true,
      brokerSubmissionBlocked:raw?.brokerSubmissionBlocked!==false,reconciliationEnabled:true as const,managementEnabled:true as const,
      source:'OPERATOR_EVENT' as const,asOf:String(currentResult.rows[0]?.requested_at),stateVersion:Number(currentResult.rows[0]?.state_version??0)}:base(input.defaultPaused);
    if(previous.stateVersion!==input.observedStateVersion)throw new Error('OPERATOR_STATE_VERSION_STALE');
    if(input.command==='CLEAR_EMERGENCY_LOCK'&&!previous.emergencyExecutionLock)throw new Error('EMERGENCY_LOCK_NOT_SET');
    const resulting=applyOperatorControl(previous,input.command,input.requestedAt);
    const actorHash=createHash('sha256').update(input.actorRef).digest('hex');
    const payload={command:input.command,previous,resulting,requestedAt:input.requestedAt};
    const contentHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const result=await client.query(`INSERT INTO ops.theta_operator_control_event(operator_control_event_id,
      actor_ref_hash,command,idempotency_key,requested_at,confirmed,previous_state_json,resulting_state_json,audit_json,content_hash,
      observed_state_version,state_version,reason,correlation_id,result)
      VALUES($1,$2,$3,$4,$5,true,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,'APPLIED')
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING resulting_state_json`,[randomUUID(),actorHash,input.command,
      input.idempotencyKey,input.requestedAt,JSON.stringify(previous),JSON.stringify(resulting),
      JSON.stringify({sameOriginRequired:true,role:'OWNER_OPERATOR',executionAuthorized:false}),contentHash,
      input.observedStateVersion,resulting.stateVersion,input.reason,randomUUID()]);
    if(result.rowCount===0){
      const existing=await client.query(`SELECT resulting_state_json FROM ops.theta_operator_control_event WHERE idempotency_key=$1`,[input.idempotencyKey]);
      return existing.rows[0]?.resulting_state_json as OperatorControlState;
    }
    return result.rows[0]?.resulting_state_json as OperatorControlState;
    },{verifyCommitted:async(pool,outcome)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT resulting_state_json,
        state_version FROM ops.theta_operator_control_event WHERE idempotency_key=$1`,[input.idempotencyKey]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      const state=row.resulting_state_json as Partial<OperatorControlState>|null;
      if(state===null||Number(row.state_version)!==outcome.stateVersion
        ||state.newEntriesPaused!==outcome.newEntriesPaused
        ||state.emergencyExecutionLock!==outcome.emergencyExecutionLock
        ||state.brokerSubmissionBlocked!==outcome.brokerSubmissionBlocked)
        throw new Error('OPERATOR_CONTROL_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }
}
