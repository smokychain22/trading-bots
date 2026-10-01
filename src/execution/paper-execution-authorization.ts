import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import type { FirstCanaryAcceptanceReceipt } from './first-canary-acceptance.js';

export const masterPaperAuthorizationConfirmation = 'AUTHORIZE_MASTER_THETA_PAPER_MANAGEMENT_ONLY' as const;
export const firstPaperCanaryActivationConfirmation = 'ACTIVATE_ONE_MASTER_THETA_PAPER_CANARY' as const;
export const fullPaperExecutionLockConfirmation = 'LOCK_ALL_THETA_PAPER_EXECUTION' as const;
export const ownerMasterPaperAutonomySource = 'OWNER_DIRECTIVE_2026_10_01_MASTER_PAPER_AUTONOMY' as const;
export const autonomousMasterPaperAuditAction = 'ACTIVATE_AUTONOMOUS_MASTER_PAPER' as const;

/** The one durable, restart-safe record that a first Paper canary was fully
 * accepted. It is an immutable audit row written inside the same transaction as
 * the control change, so no later lock/unlock cycle can erase the fact and no
 * `changed_by` text convention is trusted. */
export async function isAutonomousMasterPaperAccepted(pool:Pick<Pool,'query'>):Promise<boolean>{
  const result=await pool.query(`SELECT EXISTS(SELECT 1 FROM copy.operator_audit_event
    WHERE action=$1 AND result='ACCEPTED') AS accepted`,[autonomousMasterPaperAuditAction]);
  return result.rows[0]?.accepted===true;
}

export type TechnicalSessionState = 'PENDING_PHASE7_ACCEPTANCE'|'ACCEPTED';
export type PaperExecutionState = 'LOCKED_WAITING_FOR_TECHNICAL_ACCEPTANCE'|'FIRST_CANARY_ARMED'
  |'FIRST_CANARY_SUBMITTED'|'FIRST_CANARY_RECONCILED'|'AUTONOMOUS_PAPER_ACTIVE';

export function classifyPaperExecutionState(input:{
  readonly ownerPermissionGranted:boolean;
  readonly technicalSessionState:TechnicalSessionState;
  readonly priorBrokerOrderCount:number;
  readonly firstCanaryAccepted:boolean;
  readonly pauseNewOrders:boolean;
}):PaperExecutionState{
  if(!input.ownerPermissionGranted||input.technicalSessionState!=='ACCEPTED')
    return 'LOCKED_WAITING_FOR_TECHNICAL_ACCEPTANCE';
  if(input.priorBrokerOrderCount===0)return input.pauseNewOrders?'LOCKED_WAITING_FOR_TECHNICAL_ACCEPTANCE':'FIRST_CANARY_ARMED';
  if(!input.firstCanaryAccepted)return 'FIRST_CANARY_SUBMITTED';
  return input.pauseNewOrders?'FIRST_CANARY_RECONCILED':'AUTONOMOUS_PAPER_ACTIVE';
}

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

export function fullyLockedPaperExecutionControl(
  current: PersistedPaperExecutionControl,
): PersistedPaperExecutionControl {
  return {
    pauseNewOrders: true,
    masterExecutionEnabled: false,
    followerExecutionEnabled: false,
    authorizationEventId: current.authorizationEventId,
  };
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

  /** Revokes every broker-submission lane without deleting immutable owner
   * authorization history. This operation is idempotent and only tightens
   * authority. Re-enabling any lane still requires its separate governed
   * authorization path. */
  async lockAllExecution(input:{confirmation:string;lockedAt:string;sourceRef:string}):Promise<PersistedPaperExecutionControl>{
    if(input.confirmation!==fullPaperExecutionLockConfirmation)
      throw new Error('FULL_PAPER_EXECUTION_LOCK_CONFIRMATION_REQUIRED');
    if(input.sourceRef.trim().length<12)throw new Error('FULL_PAPER_EXECUTION_LOCK_SOURCE_REQUIRED');
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-master-paper-authorization'))`);
      const currentResult=await client.query(`SELECT pause_new_orders,master_execution_enabled,
        follower_execution_enabled,authorization_event_id::text
        FROM ops.paper_execution_control WHERE singleton=true FOR UPDATE`);
      if(currentResult.rowCount!==1)throw new Error('PAPER_EXECUTION_CONTROL_MISSING');
      const currentRow=currentResult.rows[0] as Record<string,unknown>;
      const current:PersistedPaperExecutionControl={
        pauseNewOrders:currentRow.pause_new_orders===true,
        masterExecutionEnabled:currentRow.master_execution_enabled===true,
        followerExecutionEnabled:currentRow.follower_execution_enabled===true,
        authorizationEventId:typeof currentRow.authorization_event_id==='string'?currentRow.authorization_event_id:null,
      };
      const locked=fullyLockedPaperExecutionControl(current);
      await client.query(`UPDATE ops.paper_execution_control SET pause_new_orders=true,
        master_execution_enabled=false,follower_execution_enabled=false,
        changed_by=$1,changed_at=$2 WHERE singleton=true`,[input.sourceRef,input.lockedAt]);
      return locked;
    },{verifyCommitted:async(pool,outcome)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT pause_new_orders,
        master_execution_enabled,follower_execution_enabled,authorization_event_id::text
        FROM ops.paper_execution_control WHERE singleton=true`));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.pause_new_orders!==true||row.master_execution_enabled!==false||row.follower_execution_enabled!==false
        ||(typeof row.authorization_event_id==='string'?row.authorization_event_id:null)!==outcome.authorizationEventId)
        throw new Error('FULL_PAPER_EXECUTION_LOCK_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
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
        JSON.stringify({actions:['OPEN','CLOSE','MANAGE','ROLL','LET_EXPIRE','ACCEPT_ASSIGNMENT','RECOVERY',
          'SELL_STOCK','SELL_CC','CLOSE_CC','ROLL_CC','CALL_AWAY','CANCEL_REPLACE','RECONCILE'],
          newEntriesRemainPaused:true,firstCanaryMaximumQuantity:1,
          autonomousPaperAfterAcceptedCanaryAuthorized:true,followerExecution:'LOCKED',liveMoneyAuthorized:false}),
        directiveHash,input.authorizedAt]);
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
          AND cn.environment='PAPER' AND pc.checked_at>now()-interval '1 hour'
          AND pc.capability_code IN ('OPTIONS_MARKET_DATA_OPRA','OPTIONS_MARKET_DATA_INDICATIVE','CURRENT_OPTION_SNAPSHOTS_INDICATIVE')
          AND pc.status='GOOD' AND pc.entitlement IN ('AVAILABLE','AVAILABLE_WITH_LIMITS'))
         OR EXISTS(SELECT 1 FROM research.quote_provider_qualification_receipt WHERE provider='ALPACA'
          AND semantics='PAPER_INDICATIVE_REFERENCE' AND qualified=true AND entitlement_state='QUALIFIED'
          AND attempted_at>now()-interval '1 hour')
         ) AS quote_ready
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
          firstCanaryMaximumQuantity:1,automaticLockAfterFirstBrokerOrder:true,
          autonomousPaperAfterAcceptedCanaryAuthorized:true,followerExecution:'LOCKED',liveMoneyAuthorized:false}),
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
        AND NOT EXISTS(SELECT 1 FROM copy.operator_audit_event
          WHERE action='ACTIVATE_AUTONOMOUS_MASTER_PAPER' AND result='ACCEPTED')
        AND EXISTS(SELECT 1 FROM ops.paper_execution_authorization_event pae
          WHERE pae.authorization_event_id=pec.authorization_event_id
            AND pae.authorization_scope_json @> '{"automaticLockAfterFirstBrokerOrder":true}'::jsonb)
      RETURNING pec.singleton`,[lockedAt]);
    return (result.rowCount??0)===1;
  }

  /** Removes only the temporary first-canary new-risk pause. The immutable
   * owner scope and a complete accepted canary receipt are both required.
   * Normal sizing, AEGIS, quote, reconciliation, idempotency, follower, and
   * live-money gates remain unchanged. */
  async activateAutonomousPaperAfterAcceptedCanary(input:{
    readonly acceptance:FirstCanaryAcceptanceReceipt;readonly activatedAt:string;
  }):Promise<PersistedPaperExecutionControl>{
    const receipt=input.acceptance;
    if(receipt.status!=='ACCEPTED'||receipt.blockers.length!==0||receipt.pending.length!==0
      ||receipt.expected.quantity!==1||receipt.broker.filledQuantity.state!=='GOOD'
      ||receipt.broker.filledQuantity.value!==1)
      throw new Error('FIRST_CANARY_ACCEPTANCE_REQUIRED');
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('theta-master-paper-authorization'))`);
      const state=await client.query(`SELECT pec.pause_new_orders,pec.master_execution_enabled,
        pec.follower_execution_enabled,pec.authorization_event_id::text,
        pae.authorization_scope_json,
        (SELECT count(DISTINCT p.execution_order_intent_id)::int FROM trade.master_paper_action_plan p
          WHERE p.authority_kind='NEW_RISK' AND p.execution_order_intent_id IS NOT NULL) AS broker_order_count,
        EXISTS(SELECT 1 FROM trade.order_intent oi JOIN trade.broker_order bo USING(order_intent_id)
          WHERE oi.order_intent_id=$1 AND oi.execution_account_id=$2 AND oi.client_order_id=$3
            AND oi.quantity=1 AND oi.status='FILLED') AS accepted_order_exists
        FROM ops.paper_execution_control pec
        JOIN ops.paper_execution_authorization_event pae
          ON pae.authorization_event_id=pec.authorization_event_id
        WHERE pec.singleton=true FOR UPDATE OF pec`,[
        receipt.expected.orderIntentId,
        receipt.expected.executionAccountId,receipt.expected.clientOrderId,
      ]);
      if(state.rowCount!==1)throw new Error('PAPER_EXECUTION_CONTROL_MISSING');
      const row=state.rows[0] as Record<string,unknown>;
      const scope=row.authorization_scope_json as Record<string,unknown>|null;
      if(row.pause_new_orders!==true||row.master_execution_enabled!==true||row.follower_execution_enabled!==false)
        throw new Error('FIRST_CANARY_RELOCKED_CONTROL_REQUIRED');
      if(scope?.autonomousPaperAfterAcceptedCanaryAuthorized!==true)
        throw new Error('AUTONOMOUS_PAPER_OWNER_AUTHORIZATION_MISSING');
      if(Number(row.broker_order_count)!==1||row.accepted_order_exists!==true)
        throw new Error('FIRST_CANARY_DATABASE_IDENTITY_MISMATCH');
      await client.query(`INSERT INTO copy.operator_audit_event(operator_subject,action,target_type,target_id,
        request_id,result,metadata_json,occurred_at)
        SELECT 'THETA_RUNTIME','ACTIVATE_AUTONOMOUS_MASTER_PAPER','ORDER_INTENT',$1,$2,'ACCEPTED',$3::jsonb,$4
        WHERE NOT EXISTS(SELECT 1 FROM copy.operator_audit_event WHERE request_id=$2)`,[
        receipt.expected.orderIntentId,receipt.contentHash,JSON.stringify({
          receiptVersion:receipt.receiptVersion,receiptHash:receipt.contentHash,status:receipt.status,
          paperOnly:true,firstCanaryQuantity:receipt.expected.quantity,followerMutationCount:0,liveMutationCount:0,
          normalSizingPreserved:true,
        }),input.activatedAt]);
      await client.query(`UPDATE ops.paper_execution_control SET pause_new_orders=false,
        master_execution_enabled=true,follower_execution_enabled=false,
        changed_by='AUTOMATIC_ACCEPTED_FIRST_CANARY',changed_at=$1 WHERE singleton=true`,[input.activatedAt]);
      return {pauseNewOrders:false,masterExecutionEnabled:true,followerExecutionEnabled:false,
        authorizationEventId:String(row.authorization_event_id)};
    },{verifyCommitted:async(pool,outcome)=>{
      const verified=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT pause_new_orders,
        master_execution_enabled,follower_execution_enabled,authorization_event_id::text
        FROM ops.paper_execution_control WHERE singleton=true`));
      const row=verified.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.pause_new_orders!==false||row.master_execution_enabled!==true||row.follower_execution_enabled!==false
        ||row.authorization_event_id!==outcome.authorizationEventId)
        throw new Error('AUTONOMOUS_PAPER_ACTIVATION_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }
}
