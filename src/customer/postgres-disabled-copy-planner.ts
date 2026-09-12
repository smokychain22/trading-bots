import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  masterCopyEventSchema,
  directionAwarePriceDeterioration,
  planFollowerCopy,
  type FollowerCopyPlan,
  type FollowerCopyState,
  type MasterCopyEvent,
} from './copy-engine-contract.js';

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const followerCopyEvidenceSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  masterFillTime:z.string().datetime({offset:true}),
  copyEventTime:z.string().datetime({offset:true}),
  followerObservationTime:z.string().datetime({offset:true}),
  quoteTimestamp: z.string().datetime({ offset: true }).nullable(),
  quoteAgeMs: z.number().int().nonnegative().nullable(),
  maximumQuoteAgeMs:z.number().int().positive(),
  bid: z.number().finite().nonnegative().nullable(),
  ask: z.number().finite().nonnegative().nullable(),
  proposedLimit: z.number().finite().nonnegative().nullable(),
  economicDirection:z.enum(['CREDIT','DEBIT']),
  masterExecutionPrice:z.number().finite().nonnegative(),
  followerReferencePrice:z.number().finite().nonnegative().nullable(),
  contractMultiplier:z.number().int().positive().nullable(),
  pricingPolicyVersion:z.string().min(1),
  equity: z.number().finite().nonnegative().nullable(),
  buyingPower: z.number().finite().nonnegative().nullable(),
  optionsBuyingPower: z.number().finite().nonnegative().nullable(),
  assignmentCapacity: z.number().finite().nonnegative().nullable(),
  concentrationRemaining: z.number().finite().nonnegative().nullable(),
  requiredCollateralPerContract: z.number().finite().positive().nullable(),
  expectedExecutionQuality: z.enum(['GOOD', 'DEGRADED', 'UNKNOWN']),
  dataQuality: z.enum(['GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED']),
  providerState: z.string().min(1),
  branchCompatible: z.boolean(),
  reasonCodes: z.array(z.string().regex(/^[A-Z0-9_:-]+$/)),
}).strict().superRefine((evidence, context) => {
  if (evidence.quoteTimestamp !== null && Date.parse(evidence.quoteTimestamp) > Date.parse(evidence.asOf)) {
    context.addIssue({ code: 'custom', message: 'Follower quote cannot be from the future.' });
  }
  if (evidence.bid !== null && evidence.ask !== null && evidence.ask < evidence.bid) {
    context.addIssue({ code: 'custom', message: 'Follower ask cannot be below bid.' });
  }
  if (Date.parse(evidence.copyEventTime)<Date.parse(evidence.masterFillTime) ||
    Date.parse(evidence.followerObservationTime)<Date.parse(evidence.copyEventTime)) {
    context.addIssue({code:'custom',message:'Copy timing must be monotonic from master fill to follower observation.'});
  }
  if (evidence.quoteTimestamp!==null && evidence.quoteAgeMs!==null &&
    Math.abs(Date.parse(evidence.followerObservationTime)-Date.parse(evidence.quoteTimestamp)-evidence.quoteAgeMs)>1) {
    context.addIssue({code:'custom',message:'Follower quote age does not match its timestamps.'});
  }
});

export type FollowerCopyEvidence = z.infer<typeof followerCopyEvidenceSchema>;

export interface ConfirmedMasterCopyInput {
  readonly masterCopyEventId: string;
  readonly masterBotInstanceId: string;
  readonly masterChainId: string | null;
  readonly parentMasterCopyEventId: string | null;
  readonly brokerActivityFactId: string | null;
  readonly payloadHash: string;
  readonly event: MasterCopyEvent;
}

export interface DisabledFollowerEvaluation {
  readonly tenantId:string;
  readonly followerAccountId: string;
  readonly followerPolicyId: string;
  readonly followerBrokerActivityFactId:string|null;
  readonly state: FollowerCopyState;
  readonly evidence: FollowerCopyEvidence;
}

export interface DisabledCopyPlanningReceipt {
  readonly masterCopyEventId: string;
  readonly persistedPlans: number;
  readonly duplicatePlans: number;
  readonly orderIntentsPlanned: number;
  readonly executionAuthorized: false;
}

export class PostgresDisabledCopyPlanner {
  constructor(private readonly pool: Pool) {}

  async persistConfirmedEvent(
    masterInput: ConfirmedMasterCopyInput,
    followerEvaluations: readonly DisabledFollowerEvaluation[],
  ): Promise<DisabledCopyPlanningReceipt> {
    const event = masterCopyEventSchema.parse(masterInput.event);
    const input = validateMasterInput(masterInput, event);
    const followers = followerEvaluations.map(validateFollowerEvaluation);
    const uniqueFollowers = new Set(followers.map((item) => item.followerAccountId));
    if (uniqueFollowers.size !== followers.length) throw new Error('DUPLICATE_FOLLOWER_EVALUATION');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.requireBrokerConfirmation(client, input, event);
      await this.persistMasterEvent(client, input, event);
      let persistedPlans = 0;
      let duplicatePlans = 0;
      let orderIntentsPlanned = 0;
      for (const follower of followers) {
        await this.requireFollowerBoundary(client, follower);
        const chainEntryParticipated=await this.chainEntryParticipated(client,input.masterChainId,follower.followerAccountId,event.action);
        await this.requireFollowerLifecycleTruth(client,follower,event);
        const deterioration=follower.evidence.followerReferencePrice===null?null:directionAwarePriceDeterioration({
          direction:follower.evidence.economicDirection,masterPrice:follower.evidence.masterExecutionPrice,
          followerPrice:follower.evidence.followerReferencePrice});
        const quoteFresh=follower.evidence.quoteTimestamp!==null&&follower.evidence.quoteAgeMs!==null&&
          follower.evidence.quoteAgeMs<=follower.evidence.maximumQuoteAgeMs&&
          ['GOOD','DEGRADED'].includes(follower.evidence.dataQuality);
        const expectedSlippage=deterioration===null||follower.evidence.contractMultiplier===null?null:
          Math.max(0,deterioration.amount)*follower.evidence.contractMultiplier;
        const plan = planFollowerCopy(event, { ...follower.state,chainEntryParticipated,
          freshFollowerQuote:quoteFresh,expectedSlippagePerContract:expectedSlippage,
          contractMultiplier:follower.evidence.contractMultiplier,
          followerBrokerLifecycleConfirmed:follower.followerBrokerActivityFactId!==null });
        const inserted = await this.persistFollowerPlan(client, input.masterCopyEventId, event, follower, plan);
        if (!inserted) {
          duplicatePlans += 1;
          continue;
        }
        persistedPlans += 1;
        await this.persistParticipation(client,input,event,follower,plan);
        const orderActions:readonly MasterCopyEvent['action'][]=['OPEN_CSP','REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE',
          'ROLL_CSP_OPEN','SELL_STOCK','OPEN_CC','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN'];
        if (plan.nextAction === 'PERSIST_PLAN' && plan.intendedQuantity > 0 && orderActions.includes(event.action)) {
          await client.query(`INSERT INTO copy.follower_order_intent(
            follower_order_intent_id,follower_copy_event_id,client_order_id,state,quantity,limit_price,attempt)
            VALUES($1,$2,$3,'PLANNED',$4,$5,1) ON CONFLICT(follower_order_intent_id) DO NOTHING`,
          [plan.followerOrderIntentId,plan.copyEventId,plan.clientOrderId,plan.intendedQuantity,follower.evidence.proposedLimit]);
          orderIntentsPlanned += 1;
        }
      }
      await client.query('COMMIT');
      return { masterCopyEventId: input.masterCopyEventId, persistedPlans, duplicatePlans,
        orderIntentsPlanned, executionAuthorized: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmFollowerEntryFromOwnBroker(input:{tenantId:string;followerAccountId:string;masterChainId:string;
    followerChainId:string;followerOrderIntentId:string;confirmedAt:string}):Promise<'CONFIRMED'|'DUPLICATE'> {
    const value=z.object({tenantId:uuid,followerAccountId:uuid,masterChainId:uuid,followerChainId:uuid,
      followerOrderIntentId:z.string().min(8),confirmedAt:z.string().datetime({offset:true})}).parse(input);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const proof=await client.query(`SELECT fce.workspace_id,sum(ff.quantity)::numeric AS filled_quantity,
        max(fce.master_copy_event_id) AS master_copy_event_id
        FROM copy.follower_order_intent foi JOIN copy.follower_copy_event fce
          ON fce.follower_copy_event_id=foi.follower_copy_event_id
        JOIN copy.follower_fill ff ON ff.follower_order_intent_id=foi.follower_order_intent_id
        JOIN copy.master_copy_event mce ON mce.master_copy_event_id=fce.master_copy_event_id
        WHERE foi.follower_order_intent_id=$1 AND fce.follower_account_id=$2 AND mce.master_chain_id=$3
          AND mce.action='OPEN_CSP' GROUP BY fce.workspace_id`,
      [value.followerOrderIntentId,value.followerAccountId,value.masterChainId]);
      const row=proof.rows[0];
      if(!row||String(row.workspace_id)!==value.tenantId||Number(row.filled_quantity)<=0)
        throw new Error('FOLLOWER_ENTRY_BROKER_FILL_REQUIRED');
      const updated=await client.query(`UPDATE copy.follower_chain_participation SET entry_state='CONFIRMED',
        entry_participated=true,follower_chain_id=$4,current_lifecycle_state='CSP_OPEN',skip_reason=NULL,updated_at=$5
        WHERE workspace_id=$1 AND follower_account_id=$2 AND master_chain_id=$3 AND entry_state='PLANNED'
        RETURNING follower_account_id`,[value.tenantId,value.followerAccountId,value.masterChainId,value.followerChainId,value.confirmedAt]);
      if(updated.rowCount===0){
        const current=await client.query(`SELECT entry_state,follower_chain_id FROM copy.follower_chain_participation
          WHERE workspace_id=$1 AND follower_account_id=$2 AND master_chain_id=$3`,
        [value.tenantId,value.followerAccountId,value.masterChainId]);
        if(current.rows[0]?.entry_state==='CONFIRMED'&&String(current.rows[0].follower_chain_id)===value.followerChainId){
          await client.query('COMMIT'); return 'DUPLICATE';
        }
        throw new Error('FOLLOWER_ENTRY_PARTICIPATION_STATE_INVALID');
      }
      await client.query(`INSERT INTO copy.follower_chain_participation_event(workspace_id,follower_account_id,master_chain_id,
        event_kind,master_copy_event_id,detail_json,occurred_at) VALUES($1,$2,$3,'ENTRY_CONFIRMED',$4,$5::jsonb,$6)`,
      [value.tenantId,value.followerAccountId,value.masterChainId,String(row.master_copy_event_id),
        JSON.stringify({followerChainId:value.followerChainId,followerOrderIntentId:value.followerOrderIntentId}),value.confirmedAt]);
      await client.query('COMMIT'); return 'CONFIRMED';
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  private async requireBrokerConfirmation(
    client: PoolClient,
    input: ReturnType<typeof validateMasterInput>,
    event: MasterCopyEvent,
  ): Promise<void> {
    if (event.action === 'ROLL_CSP' || event.action === 'ROLL_CC') {
      throw new Error('ROLL_REQUIRES_EXPLICIT_CLOSE_AND_OPEN_EVENTS');
    }
    const fillRequired = ['OPEN_CSP','REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','SELL_STOCK',
      'OPEN_CC','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN']
      .includes(event.action);
    if (fillRequired && (event.masterFillId === null || event.masterFilledQuantity <= 0)) {
      throw new Error('MASTER_FILL_REQUIRED_BEFORE_COPY');
    }
    if (event.masterFillId !== null) {
      const result = await client.query(`SELECT 1 FROM trade.fill f
        JOIN trade.broker_order bo ON bo.broker_order_id=f.broker_order_id
        JOIN trade.order_intent oi ON oi.order_intent_id=bo.order_intent_id
        WHERE f.fill_id=$1 AND ($2::uuid IS NULL OR oi.decision_id=$2::uuid)
          AND ($3::uuid IS NULL OR oi.chain_id=$3::uuid)`,
      [event.masterFillId,event.masterDecisionId,input.masterChainId]);
      if (result.rowCount !== 1) throw new Error('MASTER_FILL_NOT_CONFIRMED');
      return;
    }
    if (input.brokerActivityFactId === null) throw new Error('MASTER_BROKER_CONFIRMATION_REQUIRED');
    const result = await client.query(`SELECT 1 FROM trade.broker_activity_fact a
      JOIN copy.follower_account f ON f.follower_account_id=a.connection_id
      WHERE a.broker_activity_fact_id=$1 AND f.account_role='MASTER_THETA_PAPER'
        AND f.environment='PAPER'`, [input.brokerActivityFactId]);
    if (result.rowCount !== 1) throw new Error('MASTER_LIFECYCLE_ACTIVITY_NOT_CONFIRMED');
  }

  private async persistMasterEvent(
    client: PoolClient,
    input: ReturnType<typeof validateMasterInput>,
    event: MasterCopyEvent,
  ): Promise<void> {
    const kind = event.masterFillId === null ? 'LIFECYCLE_ACTIVITY' : 'FILL';
    await client.query(`INSERT INTO copy.master_copy_event(
      master_copy_event_id,master_bot_instance_id,master_decision_id,master_chain_id,master_order_intent_id,
      master_fill_id,source_broker_activity_fact_id,action,symbol,contract_id,master_quantity,
      master_filled_quantity,occurred_at,payload_hash,parent_master_copy_event_id,broker_confirmation_kind)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(master_copy_event_id) DO NOTHING`,
    [input.masterCopyEventId,input.masterBotInstanceId,event.masterDecisionId,input.masterChainId,event.masterOrderId,
      event.masterFillId,input.brokerActivityFactId,event.action,event.symbol,event.contractId,event.masterQuantity,
      event.masterFilledQuantity,event.occurredAt,input.payloadHash,input.parentMasterCopyEventId,kind]);
    const stored = await client.query(`SELECT payload_hash FROM copy.master_copy_event WHERE master_copy_event_id=$1`,
      [input.masterCopyEventId]);
    if (stored.rows[0]?.payload_hash !== input.payloadHash) throw new Error('MASTER_COPY_EVENT_IDEMPOTENCY_CONFLICT');
  }

  private async requireFollowerBoundary(client: PoolClient, follower: ReturnType<typeof validateFollowerEvaluation>): Promise<void> {
    const result = await client.query(`SELECT f.workspace_id,f.account_role,f.account_ready,f.options_approved,f.participation,
      p.follower_policy_id,p.policy_version FROM copy.follower_account f
      JOIN copy.follower_policy p ON p.follower_account_id=f.follower_account_id AND p.superseded_at IS NULL
      WHERE f.follower_account_id=$1 AND f.disconnected_at IS NULL FOR UPDATE`, [follower.followerAccountId]);
    const row = result.rows[0];
    if (!row || row.account_role !== 'FOLLOWER_THETA_PAPER') throw new Error('FOLLOWER_ACCOUNT_BOUNDARY_VIOLATION');
    if (String(row.workspace_id)!==follower.tenantId) throw new Error('FOLLOWER_TENANT_BOUNDARY_VIOLATION');
    if (row.follower_policy_id !== follower.followerPolicyId || row.policy_version !== follower.state.policyVersion) {
      throw new Error('FOLLOWER_POLICY_VERSION_MISMATCH');
    }
    if (follower.state.followerId !== follower.followerAccountId) throw new Error('FOLLOWER_IDENTITY_MISMATCH');
    if (row.account_ready !== follower.state.accountReady || row.options_approved !== follower.state.optionsApproved ||
      row.participation !== follower.state.participation) throw new Error('FOLLOWER_STATE_STALE');
  }

  private async chainEntryParticipated(client:PoolClient,masterChainId:string|null,followerAccountId:string,
    action:MasterCopyEvent['action']):Promise<boolean>{
    if(action==='OPEN_CSP') return false;
    if(masterChainId===null) return false;
    const result=await client.query(`SELECT entry_participated FROM copy.follower_chain_participation
      WHERE follower_account_id=$1 AND master_chain_id=$2 FOR UPDATE`,[followerAccountId,masterChainId]);
    return result.rows[0]?.entry_participated===true;
  }

  private async requireFollowerLifecycleTruth(client:PoolClient,follower:ReturnType<typeof validateFollowerEvaluation>,
    event:MasterCopyEvent):Promise<void>{
    if(!['EXPIRE_CSP','ASSIGN_STOCK','EXPIRE_CC','CALL_AWAY'].includes(event.action)) return;
    if(follower.followerBrokerActivityFactId===null) return;
    const result=await client.query(`SELECT 1 FROM trade.broker_activity_fact
      WHERE broker_activity_fact_id=$1 AND connection_id=$2`,[follower.followerBrokerActivityFactId,follower.followerAccountId]);
    if(result.rowCount!==1) throw new Error('FOLLOWER_LIFECYCLE_REQUIRES_OWN_BROKER_TRUTH');
  }

  private async persistParticipation(client:PoolClient,input:ReturnType<typeof validateMasterInput>,event:MasterCopyEvent,
    follower:ReturnType<typeof validateFollowerEvaluation>,plan:FollowerCopyPlan):Promise<void>{
    if(input.masterChainId===null) return;
    if(event.action==='OPEN_CSP'){
      const entryState=plan.nextAction==='PERSIST_PLAN'?'PLANNED':'SKIPPED';
      await client.query(`INSERT INTO copy.follower_chain_participation(workspace_id,follower_account_id,master_chain_id,
        entry_state,entry_participated,current_lifecycle_state,skip_reason,last_master_copy_event_id,policy_version,
        version_lineage_json,updated_at) VALUES($1,$2,$3,$4,false,$5,$6,$7,$8,$9::jsonb,$10)
        ON CONFLICT(follower_account_id,master_chain_id) DO NOTHING`,[follower.tenantId,follower.followerAccountId,
        input.masterChainId,entryState,entryState==='PLANNED'?'ENTRY_PLANNED':'ENTRY_SKIPPED',
        entryState==='SKIPPED'?plan.reason:null,input.masterCopyEventId,follower.state.policyVersion,
        JSON.stringify({copyContractVersion:plan.contractVersion,pricingPolicyVersion:follower.evidence.pricingPolicyVersion}),
        follower.evidence.asOf]);
      await client.query(`INSERT INTO copy.follower_chain_participation_event(workspace_id,follower_account_id,master_chain_id,
        event_kind,master_copy_event_id,detail_json,occurred_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[
        follower.tenantId,follower.followerAccountId,input.masterChainId,entryState==='PLANNED'?'ENTRY_PLANNED':'ENTRY_SKIPPED',
        input.masterCopyEventId,JSON.stringify({reason:plan.reason,executionAuthorized:false}),follower.evidence.asOf]);
      return;
    }
    if(plan.nextAction==='PERSIST_PLAN'||follower.followerBrokerActivityFactId!==null){
      await client.query(`UPDATE copy.follower_chain_participation SET current_lifecycle_state=$3,
        last_master_copy_event_id=$4,last_follower_broker_activity_fact_id=COALESCE($5,last_follower_broker_activity_fact_id),
        updated_at=$6 WHERE follower_account_id=$1 AND master_chain_id=$2`,[follower.followerAccountId,input.masterChainId,
        event.action,input.masterCopyEventId,follower.followerBrokerActivityFactId,follower.evidence.asOf]);
      await client.query(`INSERT INTO copy.follower_chain_participation_event(workspace_id,follower_account_id,master_chain_id,
        event_kind,master_copy_event_id,follower_broker_activity_fact_id,detail_json,occurred_at)
        VALUES($1,$2,$3,'LIFECYCLE_REVIEW',$4,$5,$6::jsonb,$7)`,[follower.tenantId,follower.followerAccountId,
        input.masterChainId,input.masterCopyEventId,follower.followerBrokerActivityFactId,
        JSON.stringify({action:event.action,reason:plan.reason}),follower.evidence.asOf]);
    }
  }

  private async persistFollowerPlan(
    client: PoolClient,
    masterCopyEventId: string,
    event:MasterCopyEvent,
    follower: ReturnType<typeof validateFollowerEvaluation>,
    plan: FollowerCopyPlan,
  ): Promise<boolean> {
    const result = await client.query(`INSERT INTO copy.follower_copy_event(
      follower_copy_event_id,master_copy_event_id,workspace_id,follower_account_id,follower_policy_id,outcome,sync_state,
      intended_quantity,close_quantity,open_quantity,reason,execution_authorized,evaluated_at,risk_execution_evidence_json,
      copy_state,follower_broker_activity_fact_id,economic_direction,master_execution_price,follower_observed_price,
      price_deterioration_per_share,master_fill_time,copy_event_time,follower_observation_time,follower_quote_time,
      quote_age_ms,planned_contract_id,pricing_policy_version,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13::jsonb,'EXECUTION_DISABLED',$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26)
      ON CONFLICT(master_copy_event_id,follower_account_id) DO NOTHING RETURNING follower_copy_event_id`,
    [plan.copyEventId,masterCopyEventId,follower.tenantId,follower.followerAccountId,follower.followerPolicyId,plan.outcome,
      plan.syncState,plan.intendedQuantity,plan.closeQuantity,plan.openQuantity,plan.reason,follower.evidence.asOf,
      JSON.stringify(follower.evidence),follower.followerBrokerActivityFactId,follower.evidence.economicDirection,
      follower.evidence.masterExecutionPrice,follower.evidence.followerReferencePrice,
      follower.evidence.followerReferencePrice===null?null:directionAwarePriceDeterioration({direction:follower.evidence.economicDirection,
        masterPrice:follower.evidence.masterExecutionPrice,followerPrice:follower.evidence.followerReferencePrice}).amount,
      follower.evidence.masterFillTime,follower.evidence.copyEventTime,follower.evidence.followerObservationTime,
      follower.evidence.quoteTimestamp,follower.evidence.quoteAgeMs,event.contractId,
      follower.evidence.pricingPolicyVersion,plan.copyEventId]);
    return result.rowCount === 1;
  }
}

function validateMasterInput(input: ConfirmedMasterCopyInput, event: MasterCopyEvent) {
  const parsed = z.object({
    masterCopyEventId: z.string().regex(/^[A-Za-z0-9_.:-]{8,160}$/),
    masterBotInstanceId: uuid,
    masterChainId: uuid.nullable(),
    parentMasterCopyEventId: z.string().regex(/^[A-Za-z0-9_.:-]{8,160}$/).nullable(),
    brokerActivityFactId: uuid.nullable(),
    payloadHash: sha256,
  }).parse(input);
  if (event.masterFillId === null && parsed.brokerActivityFactId === null) {
    throw new Error('MASTER_BROKER_CONFIRMATION_REQUIRED');
  }
  if(event.masterDecisionId!==null) uuid.parse(event.masterDecisionId);
  uuid.parse(event.masterLifecycleId);
  if (event.masterOrderId !== null) uuid.parse(event.masterOrderId);
  if (event.masterFillId !== null) uuid.parse(event.masterFillId);
  if (parsed.masterChainId !== event.masterLifecycleId) throw new Error('MASTER_CHAIN_IDENTITY_MISMATCH');
  return parsed;
}

function validateFollowerEvaluation(input: DisabledFollowerEvaluation) {
  const parsed = { followerAccountId: uuid.parse(input.followerAccountId),
    tenantId:uuid.parse(input.tenantId),followerPolicyId: uuid.parse(input.followerPolicyId),
    followerBrokerActivityFactId:input.followerBrokerActivityFactId===null?null:uuid.parse(input.followerBrokerActivityFactId),state: input.state,
    evidence: followerCopyEvidenceSchema.parse(input.evidence) };
  rejectSecretShapedKeys(parsed.evidence);
  return parsed;
}

function rejectSecretShapedKeys(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rejectSecretShapedKeys); return; }
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/(secret|token|authorization|apikey|credential)/.test(normalized)) throw new Error('SECRET_FIELD_IN_COPY_EVIDENCE');
    rejectSecretShapedKeys(nested);
  }
}

export function confirmedMasterCopyEventId(event: MasterCopyEvent): string {
  const parsed = masterCopyEventSchema.parse(event);
  return `master_copy_${createHash('sha256').update(JSON.stringify(parsed)).digest('hex').slice(0, 32)}`;
}
