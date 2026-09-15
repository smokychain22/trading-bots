import { createHash,randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export type OperatorControlCommand='PAUSE_NEW_ENTRIES'|'RESUME_NEW_ENTRIES'|'EMERGENCY_EXECUTION_LOCK';
export interface OperatorControlState {readonly newEntriesPaused:boolean;readonly emergencyExecutionLock:boolean;
  readonly brokerSubmissionBlocked:boolean;readonly reconciliationEnabled:true;readonly managementEnabled:true;
  readonly source:'DEFAULT'|'OPERATOR_EVENT';readonly asOf:string|null;}
const base=(paused:boolean):OperatorControlState=>({newEntriesPaused:paused,emergencyExecutionLock:false,
  brokerSubmissionBlocked:paused,reconciliationEnabled:true,managementEnabled:true,source:'DEFAULT',asOf:null});
export function applyOperatorControl(previous:OperatorControlState,command:OperatorControlCommand,at:string):OperatorControlState{
  if(command==='PAUSE_NEW_ENTRIES')return {...previous,newEntriesPaused:true,brokerSubmissionBlocked:true,source:'OPERATOR_EVENT',asOf:at};
  if(command==='EMERGENCY_EXECUTION_LOCK')return {...previous,newEntriesPaused:true,emergencyExecutionLock:true,
    brokerSubmissionBlocked:true,source:'OPERATOR_EVENT',asOf:at};
  return {...previous,newEntriesPaused:false,brokerSubmissionBlocked:previous.emergencyExecutionLock,source:'OPERATOR_EVENT',asOf:at};
}
export class PostgresOperatorControlStore{
  private readonly pool:Pool;
  constructor(databaseUrl:string){this.pool=new Pool({connectionString:databaseUrl,max:2,connectionTimeoutMillis:5_000});}
  async close():Promise<void>{await this.pool.end();}
  async current(defaultPaused:boolean):Promise<OperatorControlState>{
    const result=await this.pool.query(`SELECT resulting_state_json,requested_at FROM ops.theta_operator_control_event
      ORDER BY requested_at DESC,created_at DESC LIMIT 1`);
    if(result.rowCount!==1)return base(defaultPaused);
    const raw=result.rows[0]?.resulting_state_json as Partial<OperatorControlState>|undefined;
    return {newEntriesPaused:raw?.newEntriesPaused===true,emergencyExecutionLock:raw?.emergencyExecutionLock===true,
      brokerSubmissionBlocked:raw?.brokerSubmissionBlocked!==false,reconciliationEnabled:true,managementEnabled:true,
      source:'OPERATOR_EVENT',asOf:String(result.rows[0]?.requested_at)};
  }
  async apply(input:{actorRef:string;command:OperatorControlCommand;idempotencyKey:string;confirmed:boolean;
    requestedAt:string;defaultPaused:boolean}):Promise<OperatorControlState>{
    if(!input.confirmed)throw new Error('OPERATOR_CONFIRMATION_REQUIRED');
    if(!/^[A-Za-z0-9._:-]{12,128}$/.test(input.idempotencyKey))throw new Error('IDEMPOTENCY_KEY_INVALID');
    const previous=await this.current(input.defaultPaused);
    const resulting=applyOperatorControl(previous,input.command,input.requestedAt);
    const actorHash=createHash('sha256').update(input.actorRef).digest('hex');
    const payload={command:input.command,previous,resulting,requestedAt:input.requestedAt};
    const contentHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const result=await this.pool.query(`INSERT INTO ops.theta_operator_control_event(operator_control_event_id,
      actor_ref_hash,command,idempotency_key,requested_at,confirmed,previous_state_json,resulting_state_json,audit_json,content_hash)
      VALUES($1,$2,$3,$4,$5,true,$6::jsonb,$7::jsonb,$8::jsonb,$9)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING resulting_state_json`,[randomUUID(),actorHash,input.command,
      input.idempotencyKey,input.requestedAt,JSON.stringify(previous),JSON.stringify(resulting),
      JSON.stringify({sameOriginRequired:true,role:'OWNER_OPERATOR',executionAuthorized:false}),contentHash]);
    if(result.rowCount===0){
      const existing=await this.pool.query(`SELECT resulting_state_json FROM ops.theta_operator_control_event WHERE idempotency_key=$1`,[input.idempotencyKey]);
      return existing.rows[0]?.resulting_state_json as OperatorControlState;
    }
    return result.rows[0]?.resulting_state_json as OperatorControlState;
  }
}
