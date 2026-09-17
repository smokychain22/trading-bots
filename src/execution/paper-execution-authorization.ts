import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export const masterPaperAuthorizationConfirmation = 'AUTHORIZE_MASTER_THETA_PAPER_MANAGEMENT_ONLY' as const;

export interface PersistedPaperExecutionControl {
  readonly pauseNewOrders:boolean;
  readonly masterExecutionEnabled:boolean;
  readonly followerExecutionEnabled:boolean;
  readonly authorizationEventId:string|null;
}

export interface EffectivePaperExecutionControl {
  readonly masterEnabled:boolean;
  readonly followerEnabled:false;
  readonly pauseNewOrders:boolean;
  readonly emergencyExecutionLock:boolean;
  readonly managementSubmissionEnabled:boolean;
  readonly newRiskSubmissionEnabled:boolean;
}

export function resolveEffectivePaperExecutionControl(input:{
  readonly environmentMasterEnabled:boolean;
  readonly environmentFollowerEnabled:boolean;
  readonly environmentPauseNewOrders:boolean;
  readonly persisted:PersistedPaperExecutionControl;
  readonly operatorNewEntriesPaused:boolean;
  readonly operatorEmergencyExecutionLock:boolean;
}):EffectivePaperExecutionControl{
  const masterEnabled=input.environmentMasterEnabled&&input.persisted.masterExecutionEnabled
    &&input.persisted.authorizationEventId!==null&&!input.operatorEmergencyExecutionLock;
  const pauseNewOrders=input.environmentPauseNewOrders||input.persisted.pauseNewOrders
    ||input.operatorNewEntriesPaused||input.operatorEmergencyExecutionLock;
  return {masterEnabled,followerEnabled:false,pauseNewOrders,
    emergencyExecutionLock:input.operatorEmergencyExecutionLock,
    managementSubmissionEnabled:masterEnabled,
    newRiskSubmissionEnabled:masterEnabled&&!pauseNewOrders};
}

export class PostgresPaperExecutionAuthorizationStore{
  constructor(private readonly pool:Pool){}

  async current():Promise<PersistedPaperExecutionControl>{
    const result=await this.pool.query(`SELECT pause_new_orders,master_execution_enabled,
      follower_execution_enabled,authorization_event_id
      FROM ops.paper_execution_control WHERE singleton=true`);
    if(result.rowCount!==1)throw new Error('PAPER_EXECUTION_CONTROL_MISSING');
    const row=result.rows[0] as Record<string,unknown>;
    return {pauseNewOrders:row.pause_new_orders===true,masterExecutionEnabled:row.master_execution_enabled===true,
      followerExecutionEnabled:row.follower_execution_enabled===true,
      authorizationEventId:typeof row.authorization_event_id==='string'?row.authorization_event_id:null};
  }

  /** Records the owner's Paper-only authority while leaving new entries paused.
   * Management can be enabled independently once the process environment also
   * opts in. Followers and live money are structurally excluded. */
  async authorizeManagementOnly(input:{confirmation:string;authorizedAt:string;sourceRef:string}):Promise<PersistedPaperExecutionControl>{
    if(input.confirmation!==masterPaperAuthorizationConfirmation)throw new Error('MASTER_PAPER_AUTHORIZATION_CONFIRMATION_REQUIRED');
    const directiveHash=createHash('sha256').update(JSON.stringify({accountRole:'MASTER_THETA_PAPER',environment:'PAPER',
      masterSubmissionAuthorized:true,followerSubmissionAuthorized:false,liveMoneyAuthorized:false,
      sourceRef:input.sourceRef})).digest('hex');
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-master-paper-authorization'))`);
      const existing=await client.query(`SELECT authorization_event_id FROM ops.paper_execution_authorization_event
        WHERE directive_hash=$1`,[directiveHash]);
      const eventId=existing.rowCount===1?String(existing.rows[0]?.authorization_event_id):randomUUID();
      if(existing.rowCount===0)await client.query(`INSERT INTO ops.paper_execution_authorization_event(
        authorization_event_id,account_role,environment,master_submission_authorized,
        follower_submission_authorized,live_money_authorized,authorization_scope_json,directive_hash,authorized_at)
        VALUES($1,'MASTER_THETA_PAPER','PAPER',true,false,false,$2::jsonb,$3,$4)`,[eventId,
        JSON.stringify({actions:['MANAGE_EXISTING_EXPOSURE','PREPARE_NEW_RISK'],newEntriesRemainPaused:true,
          followerExecution:'LOCKED',liveMoneyAuthorized:false}),directiveHash,input.authorizedAt]);
      await client.query(`UPDATE ops.paper_execution_control SET pause_new_orders=true,
        master_execution_enabled=true,follower_execution_enabled=false,authorization_event_id=$1,
        changed_by='OWNER_DIRECTIVE_PAPER_ONLY',changed_at=$2 WHERE singleton=true`,[eventId,input.authorizedAt]);
      await client.query('COMMIT');
      return await this.current();
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
