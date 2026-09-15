import { createHash } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import type { BrokerOrderSnapshot } from '../execution/broker.js';
import {
  assertNoSecretShapedKeys,classifyFollowerLifecycleDivergence,classifyFollowerOrderReconciliation,
  followerDivergenceKindSchema,type FollowerPaperActionPlan,
} from './follower-paper-runtime.js';

const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const uuid=z.string().uuid();

export class PostgresFollowerPaperRuntimeStore{
  constructor(private readonly pool:Pool){}

  async persistLockedActionPlan(plan:FollowerPaperActionPlan,createdAt:string):Promise<'INSERTED'|'DUPLICATE'>{
    const at=z.string().datetime({offset:true}).parse(createdAt);
    if(plan.executionAuthorized!==false||plan.executionGate!=='FOLLOWER_EXECUTION_DISABLED')
      throw new Error('FOLLOWER_EXECUTION_GATE_MUST_REMAIN_LOCKED');
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const authority=await client.query(`SELECT fce.workspace_id,fce.follower_account_id,fce.execution_authorized,
        fce.copy_state,foi.follower_order_intent_id,foi.client_order_id,foi.quantity,foi.limit_price,foi.state
        FROM copy.follower_copy_event fce JOIN copy.follower_order_intent foi
          ON foi.follower_copy_event_id=fce.follower_copy_event_id
        WHERE fce.follower_copy_event_id=$1 AND foi.follower_order_intent_id=$2 FOR SHARE OF fce,foi`,
      [plan.followerCopyEventId,plan.followerOrderIntentId]);
      const row=authority.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)throw new Error('FOLLOWER_ORDER_INTENT_AUTHORITY_NOT_FOUND');
      if(String(row.workspace_id)!==plan.workspaceId||String(row.follower_account_id)!==plan.followerAccountId)
        throw new Error('FOLLOWER_ACTION_PLAN_TENANT_BOUNDARY_VIOLATION');
      if(row.execution_authorized!==false||row.copy_state!=='EXECUTION_DISABLED'||row.state!=='PLANNED')
        throw new Error('FOLLOWER_ACTION_PLAN_SOURCE_NOT_LOCKED');
      if(String(row.client_order_id)!==plan.clientOrderId||Number(row.quantity)!==plan.quantity
        ||Number(row.limit_price)!==plan.limitPrice)throw new Error('FOLLOWER_ACTION_PLAN_SOURCE_MISMATCH');
      const contentHash=hash(plan);
      const inserted=await client.query(`INSERT INTO copy.follower_paper_action_plan(
        follower_action_plan_id,follower_order_intent_id,follower_copy_event_id,workspace_id,follower_account_id,
        action,symbol,quantity,side,position_intent,limit_price,client_order_id,quote_json,quote_age_ms,aegis_state,
        aegis_policy_version,decision_expires_at,execution_gate,execution_authorized,content_hash,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,
          'FOLLOWER_EXECUTION_DISABLED',false,$18,$19)
        ON CONFLICT(follower_action_plan_id) DO NOTHING RETURNING follower_action_plan_id`,[
        plan.actionPlanId,plan.followerOrderIntentId,plan.followerCopyEventId,plan.workspaceId,plan.followerAccountId,
        plan.action,plan.symbol,plan.quantity,plan.side,plan.positionIntent,plan.limitPrice,plan.clientOrderId,
        JSON.stringify(plan.quote),plan.quoteAgeMs,plan.aegisState,plan.aegisPolicyVersion,plan.decisionExpiresAt,contentHash,at]);
      if(inserted.rowCount===0){
        const existing=await client.query(`SELECT content_hash FROM copy.follower_paper_action_plan
          WHERE follower_action_plan_id=$1`,[plan.actionPlanId]);
        if(existing.rows[0]?.content_hash!==contentHash)throw new Error('FOLLOWER_ACTION_PLAN_IDEMPOTENCY_CONFLICT');
        await client.query('COMMIT'); return 'DUPLICATE';
      }
      await this.persistPlanEvent(client,plan.actionPlanId,'PLANNED_LOCKED',null,0,false,
        {executionGate:plan.executionGate,executionAuthorized:false},at);
      await client.query(`INSERT INTO copy.follower_runtime_checkpoint(workspace_id,follower_account_id,runtime_state,
        last_follower_action_plan_id,updated_at) VALUES($1,$2,'READY',$3,$4)
        ON CONFLICT(follower_account_id) DO UPDATE SET last_follower_action_plan_id=EXCLUDED.last_follower_action_plan_id,
          updated_at=EXCLUDED.updated_at`,[plan.workspaceId,plan.followerAccountId,plan.actionPlanId,at]);
      await client.query('COMMIT'); return 'INSERTED';
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async recordOrderReconciliation(input:{plan:FollowerPaperActionPlan;brokerOrder:BrokerOrderSnapshot|null;
    observedAt:string}):Promise<ReturnType<typeof classifyFollowerOrderReconciliation>>{
    const observedAt=z.string().datetime({offset:true}).parse(input.observedAt);
    const result=classifyFollowerOrderReconciliation({plan:input.plan,brokerOrder:input.brokerOrder});
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const stored=await client.query(`SELECT workspace_id,follower_account_id,execution_authorized,execution_gate,content_hash
        FROM copy.follower_paper_action_plan WHERE follower_action_plan_id=$1 FOR SHARE`,[input.plan.actionPlanId]);
      const row=stored.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined||String(row.workspace_id)!==input.plan.workspaceId||String(row.follower_account_id)!==input.plan.followerAccountId)
        throw new Error('FOLLOWER_ACTION_PLAN_NOT_FOUND');
      if(row.execution_authorized!==false||row.execution_gate!=='FOLLOWER_EXECUTION_DISABLED')
        throw new Error('FOLLOWER_EXECUTION_GATE_NOT_LOCKED');
      if(String(row.content_hash)!==hash(input.plan))throw new Error('FOLLOWER_ACTION_PLAN_CONTENT_MISMATCH');
      await this.persistPlanEvent(client,input.plan.actionPlanId,result.state,input.brokerOrder?.id??null,
        result.filledQuantity,result.requiresReconciliation,{brokerStatus:input.brokerOrder?.status??null},observedAt);
      const state=result.state==='FILLED'?'FILLED':result.state==='PARTIAL_FILL'?'PARTIAL_FILL':
        result.state==='CANCELED'?'CANCELED':result.state==='REJECTED'?'REJECTED':
          result.state==='UNKNOWN_SUBMISSION'||result.state==='SUBMITTED_EXTERNALLY'?'RECONCILING':'PLANNED';
      await client.query(`UPDATE copy.follower_order_intent SET state=$2,broker_order_id=COALESCE($3,broker_order_id),
        updated_at=$4 WHERE follower_order_intent_id=$1`,[input.plan.followerOrderIntentId,state,input.brokerOrder?.id??null,observedAt]);
      const reconciliationEventKey=hash({actionPlanId:input.plan.actionPlanId,state:result.state,
        brokerOrderId:input.brokerOrder?.id??null,brokerStatus:input.brokerOrder?.status??null,
        filledQuantity:result.filledQuantity,expectedQuantity:input.plan.quantity});
      await client.query(`INSERT INTO copy.follower_reconciliation_event(follower_account_id,follower_copy_event_id,
        follower_order_intent_id,state,broker_quantity,expected_quantity,detail_json,detected_at,event_key)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT(event_key) DO NOTHING`,[input.plan.followerAccountId,input.plan.followerCopyEventId,
        input.plan.followerOrderIntentId,result.state==='FILLED'?'SYNCED':result.state==='PARTIAL_FILL'?'PARTIAL_SYNC':
          result.requiresReconciliation?'RECONCILING':'PENDING_SYNC',result.filledQuantity,input.plan.quantity,
        JSON.stringify({actionPlanId:input.plan.actionPlanId,brokerStatus:input.brokerOrder?.status??null}),observedAt,
        reconciliationEventKey]);
      await client.query(`UPDATE copy.follower_runtime_checkpoint SET runtime_state=$2,last_reconciled_at=$3,updated_at=$3
        WHERE follower_account_id=$1`,[input.plan.followerAccountId,result.requiresReconciliation?'RECONCILING':'READY',observedAt]);
      await client.query('COMMIT'); return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async recordLifecycleDivergence(input:Parameters<typeof classifyFollowerLifecycleDivergence>[0]&{
    workspaceId:string;followerAccountId:string;masterCopyEventId:string;masterChainId:string|null;
    detectedAt:string;detail:Readonly<Record<string,unknown>>;
  }):Promise<ReturnType<typeof classifyFollowerLifecycleDivergence>>{
    const identity={workspaceId:uuid.parse(input.workspaceId),followerAccountId:uuid.parse(input.followerAccountId),
      masterCopyEventId:z.string().min(8).parse(input.masterCopyEventId),masterChainId:input.masterChainId===null?null:uuid.parse(input.masterChainId),
      detectedAt:z.string().datetime({offset:true}).parse(input.detectedAt)};
    const divergence=classifyFollowerLifecycleDivergence(input);
    if(divergence==='NONE')return divergence;
    assertNoSecretShapedKeys(input.detail);
    followerDivergenceKindSchema.exclude(['NONE']).parse(divergence);
    const eventKey=hash({identity,divergence,detail:input.detail});
    await this.pool.query(`INSERT INTO copy.follower_lifecycle_divergence_event(workspace_id,follower_account_id,
      master_copy_event_id,master_chain_id,divergence_kind,detail_json,detected_at,event_key)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(event_key) DO NOTHING`,[
      identity.workspaceId,identity.followerAccountId,identity.masterCopyEventId,identity.masterChainId,divergence,
      JSON.stringify(input.detail),identity.detectedAt,eventKey]);
    return divergence;
  }

  private async persistPlanEvent(client:PoolClient,planId:string,eventKind:string,brokerOrderId:string|null,
    filledQuantity:number,requiresReconciliation:boolean,evidence:Readonly<Record<string,unknown>>,occurredAt:string){
    assertNoSecretShapedKeys(evidence);
    const eventKey=hash({planId,eventKind,brokerOrderId,filledQuantity,requiresReconciliation,evidence});
    await client.query(`INSERT INTO copy.follower_paper_action_plan_event(follower_action_plan_id,event_kind,
      broker_order_id,filled_quantity,requires_reconciliation,evidence_json,occurred_at,event_key)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(event_key) DO NOTHING`,[
      planId,eventKind,brokerOrderId,filledQuantity,requiresReconciliation,JSON.stringify(evidence),occurredAt,eventKey]);
  }
}
