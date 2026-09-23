import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';

export const masterPaperAuthorizationConfirmation = 'AUTHORIZE_MASTER_THETA_PAPER_MANAGEMENT_ONLY' as const;
export const firstPaperCanaryActivationConfirmation = 'ACTIVATE_ONE_MASTER_THETA_PAPER_CANARY' as const;

export interface FirstPaperCanaryActivationEvidence {
  readonly brokerAccountStatus:string|null;
  readonly brokerPositionCount:number;
  readonly brokerOpenOrderCount:number;
  readonly brokerLocalOnlyIntentCount:number;
  readonly marketOpen:boolean|null;
  readonly calendarSessionConfirmed:boolean;
  readonly optionsCapabilityVerified:boolean;
  readonly environmentMasterEnabled:boolean;
  readonly environmentPauseNewOrders:boolean;
  readonly environmentFollowerEnabled:boolean;
  readonly runtimeMode:string;
}

export interface FirstPaperCanaryActivationReceipt {
  readonly ready:boolean;
  readonly activated:boolean;
  readonly blockers:readonly string[];
  readonly accountRole:'MASTER_THETA_PAPER';
  readonly brokerHost:'https://paper-api.alpaca.markets';
  readonly paperOnly:true;
  readonly followerExecutionLocked:true;
  readonly liveMoneyAuthorized:false;
  readonly priorBrokerOrderCount:number;
  readonly latestCompleteScanAt:string|null;
  readonly migrationHead:string|null;
}

export interface FirstPaperCanaryDatabaseEvidence {
  readonly managementAuthorized:boolean;
  readonly followerExecutionEnabled:boolean;
  readonly priorBrokerOrderCount:number;
  readonly activeIntentCount:number;
  readonly masterCount:number;
  readonly masterSelfCopyCount:number;
  readonly quoteReady:boolean;
  readonly latestCompleteScanAt:string|null;
  readonly migrationHead:string|null;
  readonly requiredSchemaBaselinePresent:boolean;
}

export function firstPaperCanaryActivationBlockers(input:{readonly activatedAt:string;
  readonly runtime:FirstPaperCanaryActivationEvidence;readonly database:FirstPaperCanaryDatabaseEvidence}):readonly string[]{
  const {runtime,database}=input,blockers:string[]=[];
  if(!database.managementAuthorized)blockers.push('MASTER_MANAGEMENT_AUTHORIZATION_MISSING');
  if(database.followerExecutionEnabled||runtime.environmentFollowerEnabled)blockers.push('FOLLOWER_EXECUTION_NOT_LOCKED');
  if(!runtime.environmentMasterEnabled)blockers.push('MASTER_EXECUTION_ENVIRONMENT_DISABLED');
  if(runtime.environmentPauseNewOrders)blockers.push('ENVIRONMENT_NEW_ENTRY_PAUSE_ACTIVE');
  if(runtime.runtimeMode!=='MASTER_THETA_PAPER')blockers.push('MASTER_THETA_PAPER_RUNTIME_REQUIRED');
  if(runtime.brokerAccountStatus!=='ACTIVE')blockers.push('MASTER_ACCOUNT_NOT_ACTIVE');
  if(!runtime.optionsCapabilityVerified)blockers.push('OPTIONS_CAPABILITY_NOT_VERIFIED');
  if(runtime.marketOpen!==true)blockers.push('MARKET_NOT_OPEN');
  if(!runtime.calendarSessionConfirmed)blockers.push('MARKET_SESSION_NOT_CONFIRMED');
  if(runtime.brokerPositionCount!==0)blockers.push('FIRST_CANARY_REQUIRES_ZERO_BROKER_POSITIONS');
  if(runtime.brokerOpenOrderCount!==0)blockers.push('FIRST_CANARY_REQUIRES_ZERO_OPEN_ORDERS');
  if(runtime.brokerLocalOnlyIntentCount!==0)blockers.push('UNRECONCILED_LOCAL_ORDER_INTENT');
  if(database.priorBrokerOrderCount!==0)blockers.push('FIRST_CANARY_ALREADY_USED');
  if(database.activeIntentCount!==0)blockers.push('ACTIVE_ORDER_INTENT_PRESENT');
  if(database.masterCount!==1)blockers.push('MASTER_ACCOUNT_ROLE_INVALID');
  if(database.masterSelfCopyCount!==0)blockers.push('MASTER_SELF_COPY_INVARIANT_FAILED');
  if(!database.quoteReady)blockers.push('EXECUTION_QUOTE_AUTHORITY_NOT_READY');
  if(database.latestCompleteScanAt===null||Date.parse(input.activatedAt)-Date.parse(database.latestCompleteScanAt)>15*60_000)
    blockers.push('RECENT_COMPLETE_STRATEGY_SCAN_MISSING');
  if(!database.requiredSchemaBaselinePresent)blockers.push('PRODUCTION_SCHEMA_BASELINE_061_MISSING');
  return [...new Set(blockers)];
}

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
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
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
      return {pauseNewOrders:true,masterExecutionEnabled:true,followerExecutionEnabled:false,
        authorizationEventId:eventId};
    },{verifyCommitted:async(pool,outcome)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT pause_new_orders,
        master_execution_enabled,follower_execution_enabled,authorization_event_id::text
        FROM ops.paper_execution_control WHERE singleton=true`));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.pause_new_orders!==true||row.master_execution_enabled!==true||row.follower_execution_enabled!==false
        ||row.authorization_event_id!==outcome.authorizationEventId)
        throw new Error('PAPER_MANAGEMENT_AUTHORIZATION_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }

  /** Activates only the single bounded master Paper canary lane. The caller
   * must provide a fresh read-only broker reconciliation. Database gates are
   * rechecked under one advisory-locked transaction before control changes. */
  async activateFirstPaperCanary(input:{confirmation:string;activatedAt:string;sourceRef:string;
    evidence:FirstPaperCanaryActivationEvidence}):Promise<FirstPaperCanaryActivationReceipt>{
    if(input.confirmation!==firstPaperCanaryActivationConfirmation)
      throw new Error('FIRST_PAPER_CANARY_ACTIVATION_CONFIRMATION_REQUIRED');
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-master-paper-authorization'))`);
      const state=await client.query(`SELECT
        pec.pause_new_orders,pec.master_execution_enabled,pec.follower_execution_enabled,pec.authorization_event_id,
        (SELECT count(*)::int FROM trade.broker_order) AS broker_order_count,
        (SELECT count(*)::int FROM trade.order_intent WHERE status NOT IN
          ('FILLED','CANCELED','REJECTED','EXPIRED')) AS active_intent_count,
        (SELECT count(*)::int FROM copy.follower_account WHERE account_role='MASTER_THETA_PAPER'
          AND environment='PAPER' AND connection_status='CONNECTED' AND disconnected_at IS NULL) AS master_count,
        (SELECT count(*)::int FROM copy.follower_account WHERE account_role='MASTER_THETA_PAPER'
          AND participation='COPY_NEW_AND_MANAGE') AS master_self_copy_count,
        (SELECT max(finished_at)::text FROM research.theta_shadow_scan_run WHERE completeness_state='COMPLETE') AS latest_complete_scan_at,
        (SELECT version FROM core.schema_migration ORDER BY applied_at DESC,version DESC LIMIT 1) AS migration_head,
        EXISTS(SELECT 1 FROM core.schema_migration
          WHERE version='061_paper_execution_control_normalization') AS required_schema_baseline_present,
        (EXISTS(SELECT 1 FROM core.provider_capability pc JOIN core.provider_connection cn
          ON cn.provider_connection_id=pc.provider_connection_id WHERE cn.provider_code='ALPACA'
          AND pc.capability_code IN ('OPTIONS_MARKET_DATA_OPRA','OPTIONS_MARKET_DATA_INDICATIVE','CURRENT_OPTION_SNAPSHOTS_INDICATIVE')
          AND pc.status='GOOD' AND pc.entitlement IN ('AVAILABLE','AVAILABLE_WITH_LIMITS'))
         OR EXISTS(SELECT 1 FROM research.quote_provider_qualification_receipt WHERE provider='ALPACA'
          AND semantics='PAPER_INDICATIVE_REFERENCE' AND qualified=true AND entitlement_state='QUALIFIED'
          AND attempted_at>now()-interval '1 hour')
         OR EXISTS(SELECT 1 FROM research.optionomics_quote_qualification_run WHERE ready=true
          AND readiness_state='READY' AND semantic_authority='ORDER_PRICING_DOCUMENTED')) AS quote_ready
        FROM ops.paper_execution_control pec WHERE pec.singleton=true FOR UPDATE`);
      if(state.rowCount!==1)throw new Error('PAPER_EXECUTION_CONTROL_MISSING');
      const row=state.rows[0] as Record<string,unknown>;
      const priorBrokerOrderCount=Number(row.broker_order_count??0);
      const latestCompleteScanAt=typeof row.latest_complete_scan_at==='string'?row.latest_complete_scan_at:null;
      const migrationHead=typeof row.migration_head==='string'?row.migration_head:null;
      const blockers=firstPaperCanaryActivationBlockers({activatedAt:input.activatedAt,runtime:input.evidence,database:{
        managementAuthorized:row.master_execution_enabled===true&&row.authorization_event_id!=null,
        followerExecutionEnabled:row.follower_execution_enabled===true,priorBrokerOrderCount,
        activeIntentCount:Number(row.active_intent_count??0),masterCount:Number(row.master_count??0),
        masterSelfCopyCount:Number(row.master_self_copy_count??0),quoteReady:row.quote_ready===true,
        latestCompleteScanAt,migrationHead,requiredSchemaBaselinePresent:row.required_schema_baseline_present===true,
      }});
      const common={accountRole:'MASTER_THETA_PAPER' as const,brokerHost:'https://paper-api.alpaca.markets' as const,
        paperOnly:true as const,followerExecutionLocked:true as const,liveMoneyAuthorized:false as const,
        priorBrokerOrderCount,latestCompleteScanAt,migrationHead};
      if(blockers.length>0)return {ready:false,activated:false,blockers:[...new Set(blockers)],...common};
      const directiveHash=createHash('sha256').update(JSON.stringify({accountRole:'MASTER_THETA_PAPER',environment:'PAPER',
        scope:'ONE_FIRST_CANARY_THEN_AUTOMATIC_NEW_RISK_LOCK',sourceRef:input.sourceRef})).digest('hex');
      const existing=await client.query(`SELECT authorization_event_id FROM ops.paper_execution_authorization_event
        WHERE directive_hash=$1`,[directiveHash]);
      const eventId=existing.rowCount===1?String(existing.rows[0]?.authorization_event_id):randomUUID();
      if(existing.rowCount===0)await client.query(`INSERT INTO ops.paper_execution_authorization_event(
        authorization_event_id,account_role,environment,master_submission_authorized,follower_submission_authorized,
        live_money_authorized,authorization_scope_json,directive_hash,authorized_at)
        VALUES($1,'MASTER_THETA_PAPER','PAPER',true,false,false,$2::jsonb,$3,$4)`,[eventId,
        JSON.stringify({actions:['ONE_FIRST_CANARY','MANAGE_EXISTING_EXPOSURE'],newEntriesRemainPaused:false,
          automaticLockAfterFirstBrokerOrder:true,followerExecution:'LOCKED',liveMoneyAuthorized:false}),
        directiveHash,input.activatedAt]);
      await client.query(`UPDATE ops.paper_execution_control SET pause_new_orders=false,master_execution_enabled=true,
        follower_execution_enabled=false,authorization_event_id=$1,changed_by='OWNER_DIRECTIVE_FIRST_PAPER_CANARY',changed_at=$2
        WHERE singleton=true`,[eventId,input.activatedAt]);
      return {ready:true,activated:true,blockers:[],...common};
    },{verifyCommitted:async(pool,outcome)=>{
      if(!outcome.activated)return true;
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT pause_new_orders,
        master_execution_enabled,follower_execution_enabled,authorization_event_id::text
        FROM ops.paper_execution_control WHERE singleton=true`));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.pause_new_orders!==false||row.master_execution_enabled!==true||row.follower_execution_enabled!==false
        ||typeof row.authorization_event_id!=='string')
        throw new Error('FIRST_CANARY_AUTHORIZATION_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }

  /** Persists the one-canary new-risk lock after the broker order has been
   * recorded. Runtime order-count gating remains the fail-safe if this
   * observability update is temporarily unavailable. Management stays on. */
  async lockNewRiskAfterFirstCanary(lockedAt:string):Promise<boolean>{
    const result=await this.pool.query(`UPDATE ops.paper_execution_control pec
      SET pause_new_orders=true,changed_by='AUTOMATIC_FIRST_CANARY_LOCK',changed_at=$1
      WHERE pec.singleton=true AND pec.pause_new_orders=false
        AND EXISTS(SELECT 1 FROM trade.broker_order)
        AND EXISTS(SELECT 1 FROM ops.paper_execution_authorization_event pae
          WHERE pae.authorization_event_id=pec.authorization_event_id
            AND pae.authorization_scope_json @> '{"automaticLockAfterFirstBrokerOrder":true}'::jsonb)
      RETURNING pec.singleton`,[lockedAt]);
    return (result.rowCount??0)===1;
  }
}
