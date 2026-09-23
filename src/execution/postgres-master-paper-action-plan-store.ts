import { createHash, randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { managementOrderActions, type ManagementDecisionDraft } from './management-paper-plan-assembly.js';
import { masterPaperActionPlanSchema, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';

export type MasterPaperActionPlanState='READY'|'CLAIMED'|'WAITING_GATE'|'SUBMITTED'|'TERMINAL'|'QUARANTINED';

const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');

export class PostgresMasterPaperActionPlanStore {
  constructor(private readonly pool:Pool){}

  async enqueue(raw:ApprovedMasterPaperActionPlan,createdAt:string,chain?:{
    readonly botInstanceId:string;readonly underlyingId:string;
  }):Promise<boolean>{
    const plan=masterPaperActionPlanSchema.parse(raw) as ApprovedMasterPaperActionPlan;
    const contentHash=hash(plan);
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
      const evidence=await client.query(`SELECT d.decision_id,d.decision_kind,d.selected_candidate_id::text AS candidate_id,
        d.runtime_selected_candidate_ref,d.quantity::numeric AS quantity,d.aegis_action::text AS aegis_action,
        d.receipt_json->>'aegisInputOrigin' AS aegis_input_origin,
        ea.account_kind::text AS account_kind,ea.account_ready
        FROM trade.decision d JOIN trade.execution_account ea ON ea.execution_account_id=$2
        WHERE d.decision_id=$1 FOR SHARE OF d,ea`,[plan.decisionId,plan.executionAccountId]);
      const row=evidence.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)throw new Error('ACTION_PLAN_DECISION_OR_ACCOUNT_NOT_FOUND');
      if(row.account_kind!=='MASTER_API_KEY'||row.account_ready!==true)throw new Error('ACTION_PLAN_MASTER_ACCOUNT_NOT_READY');
      if(plan.decisionAuthority!=='NEW_RISK')throw new Error('MANAGEMENT_PLAN_REQUIRES_ATOMIC_PUBLISH');
      if(row.decision_kind!=='NEW_RISK'||String(row.candidate_id??'')!==plan.candidateId)
        throw new Error('ACTION_PLAN_SELECTED_CANDIDATE_MISMATCH');
      if(Number(row.quantity)!==plan.canonicalQuantity)throw new Error('ACTION_PLAN_CANONICAL_QUANTITY_MISMATCH');
      if(String(row.aegis_action)!==plan.aegisState)throw new Error('ACTION_PLAN_AEGIS_MISMATCH');
      if(row.aegis_input_origin!=='DERIVED_FROM_REAL')throw new Error('ACTION_PLAN_AEGIS_REAL_INPUT_LINEAGE_MISSING');
      if(chain!==undefined){
        if(chain.underlyingId!==plan.underlyingId)throw new Error('ACTION_PLAN_CHAIN_UNDERLYING_MISMATCH');
        await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at)
          VALUES($1,$2,$3,'WAIT',$4) ON CONFLICT(chain_id) DO NOTHING`,
        [plan.chainId,chain.botInstanceId,chain.underlyingId,createdAt]);
      }
      const inserted=await this.insertPlan(client,plan,contentHash,createdAt);
      if(inserted)await this.event(plan.actionPlanId,'READY',createdAt,null,client);
      return inserted;
    },{verifyCommitted:async(pool)=>this.verifyPlanGroup(pool,[{plan,contentHash}])});
  }

  /** Persist a selected management decision and all execution legs atomically.
   * A dependent roll-open plan exists only when its close plan exists. */
  async publishManagementPlans(decision:ManagementDecisionDraft,rawPlans:readonly ApprovedMasterPaperActionPlan[],createdAt:string):Promise<number>{
    if(rawPlans.length===0)throw new Error('MANAGEMENT_ACTION_PLANS_REQUIRED');
    const plans=rawPlans.map((plan)=>masterPaperActionPlanSchema.parse(plan) as ApprovedMasterPaperActionPlan);
    const first=plans[0] as ApprovedMasterPaperActionPlan;
    const expectedActions=managementOrderActions[decision.actionCode]??[];
    if(expectedActions.length!==plans.length)throw new Error('MANAGEMENT_ACTION_PLAN_COUNT_INVALID');
    for(const [index,plan] of plans.entries()){
      if(plan.decisionAuthority!=='MANAGEMENT'||plan.decisionId!==decision.decisionId
        ||plan.managementActionFrontierId!==first.managementActionFrontierId
        ||plan.managementInputSnapshotId!==first.managementInputSnapshotId
        ||plan.actionGroupId!==first.actionGroupId||plan.legSequence!==index+1
        ||plan.executionAccountId!==first.executionAccountId||plan.chainId!==first.chainId
        ||plan.underlyingId!==first.underlyingId||plan.candidateId!==decision.authorityRef
        ||plan.strategyVersion!==decision.strategyVersion||plan.aegisState!==decision.aegisAction
        ||plan.action!==expectedActions[index]
        ||(index===0?plan.dependsOnActionPlanId!==null:plan.dependsOnActionPlanId!==plans[index-1]?.actionPlanId)){
        throw new Error('MANAGEMENT_ACTION_PLAN_GROUP_INVALID');
      }
    }
    if(decision.quantity!==first.canonicalQuantity)throw new Error('MANAGEMENT_DECISION_QUANTITY_MISMATCH');
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
      const authority=await client.query(`SELECT maf.management_action_frontier_id,maf.selected_action,maf.decision_state,
        maf.policy_version,maf.policy_evidence_hash,
        mis.management_input_snapshot_id,mis.fusion_snapshot_id,mis.chain_id,mis.input_json,
        ea.account_kind::text AS account_kind,ea.account_ready
        FROM trade.management_action_frontier maf
        JOIN trade.management_input_snapshot mis ON mis.management_input_snapshot_id=maf.management_input_snapshot_id
        JOIN trade.execution_account ea ON ea.execution_account_id=$3
        WHERE maf.management_action_frontier_id=$1 AND mis.management_input_snapshot_id=$2
        FOR SHARE OF maf,mis,ea`,[first.managementActionFrontierId,first.managementInputSnapshotId,first.executionAccountId]);
      const row=authority.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)throw new Error('MANAGEMENT_ACTION_AUTHORITY_NOT_FOUND');
      if(row.account_kind!=='MASTER_API_KEY'||row.account_ready!==true)throw new Error('ACTION_PLAN_MASTER_ACCOUNT_NOT_READY');
      if(row.decision_state!=='ACTION_SELECTED'||String(row.selected_action)!==decision.actionCode)
        throw new Error('MANAGEMENT_ACTION_SELECTION_MISMATCH');
      if(row.policy_version!==decision.managementPolicyVersion
        ||row.policy_evidence_hash!==decision.managementPolicyEvidenceHash){
        throw new Error('MANAGEMENT_POLICY_LINEAGE_MISMATCH');
      }
      if(String(row.chain_id)!==first.chainId)throw new Error('MANAGEMENT_ACTION_CHAIN_MISMATCH');
      if(row.fusion_snapshot_id===null)throw new Error('MANAGEMENT_FUSION_SNAPSHOT_MISSING');
      const inputJson=row.input_json as Record<string,unknown>|null;
      if(inputJson===null||typeof inputJson!=='object'||String(inputJson.underlyingId??'')!==first.underlyingId)
        throw new Error('MANAGEMENT_ACTION_UNDERLYING_MISMATCH');
      const expectedAuthorityRef=`management:${first.managementActionFrontierId}:${decision.actionCode}`;
      if(decision.authorityRef!==expectedAuthorityRef)throw new Error('MANAGEMENT_DECISION_AUTHORITY_REF_INVALID');
      const insertedDecision=await client.query(`INSERT INTO trade.decision(
        decision_id,fusion_snapshot_id,candidate_set_id,selected_candidate_id,decision_kind,action_code,quantity,
        confidence,expected_ev,expected_utility,aegis_action,strategy_branch,decided_at,status,explanation_text,
        explanation_hash,runtime_selected_candidate_ref,policy_version,model_versions_json,fail_closed_reason,
        receipt_json,decision_authority_version)
        VALUES($1,$2,NULL,NULL,'MANAGEMENT',$3,$4,NULL,NULL,NULL,$5,NULL,$6,'READY',NULL,NULL,$7,$8,'{}'::jsonb,
          NULL,$9::jsonb,'theta-management-action-authority-v1')
        ON CONFLICT(decision_id) DO NOTHING RETURNING decision_id`,
      [decision.decisionId,row.fusion_snapshot_id,decision.actionCode,decision.quantity,decision.aegisAction,
        decision.decidedAt,decision.authorityRef,decision.managementPolicyVersion,JSON.stringify({
          managementActionFrontierId:first.managementActionFrontierId,
          managementInputSnapshotId:first.managementInputSnapshotId,
          actionGroupId:first.actionGroupId,
          strategyVersion:decision.strategyVersion,
          managementPolicyEvidenceHash:decision.managementPolicyEvidenceHash,
          planIds:plans.map((plan)=>plan.actionPlanId),
        })]);
      if((insertedDecision.rowCount??0)>0){
        for(const [index,reasonCode] of decision.reasonCodes.entries())await client.query(`INSERT INTO trade.decision_reason(
          decision_id,reason_family,reason_code,polarity,importance_rank,evidence_state)
          VALUES($1,'MANAGEMENT',$2,0,$3,'KNOWN')`,[decision.decisionId,reasonCode,index+1]);
      }else{
        const replay=await client.query(`SELECT decision_kind,action_code,runtime_selected_candidate_ref
          FROM trade.decision WHERE decision_id=$1 FOR SHARE`,[decision.decisionId]);
        const existing=replay.rows[0] as Record<string,unknown>|undefined;
        if(existing===undefined||existing.decision_kind!=='MANAGEMENT'||existing.action_code!==decision.actionCode
          ||existing.runtime_selected_candidate_ref!==decision.authorityRef)throw new Error('MANAGEMENT_DECISION_IDEMPOTENCY_COLLISION');
      }
      let inserted=0;
      for(const plan of plans){
        const created=await this.insertPlan(client,plan,hash(plan),createdAt);
        if(created){await this.event(plan.actionPlanId,'READY',createdAt,null,client);inserted+=1;}
      }
      return inserted;
    },{verifyCommitted:async(pool)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT d.action_code,
        d.runtime_selected_candidate_ref,d.policy_version,d.receipt_json,
        p.action_plan_id,p.content_hash,p.leg_sequence,p.depends_on_action_plan_id
        FROM trade.decision d LEFT JOIN trade.master_paper_action_plan p ON p.decision_id=d.decision_id
        WHERE d.decision_id=$1 ORDER BY p.leg_sequence`,[decision.decisionId]));
      if(receipt.value.rows.length!==plans.length) return false;
      const expected=new Map(plans.map((plan)=>[plan.legSequence,{plan,contentHash:hash(plan)}]));
      for(const raw of receipt.value.rows){
        const row=raw as Record<string,unknown>;
        const item=expected.get(Number(row.leg_sequence));
        if(item===undefined)throw new Error('MANAGEMENT_PLAN_COMMIT_RECONCILIATION_CONFLICT');
        const persistedReceipt=row.receipt_json as Record<string,unknown>|null;
        if(row.action_code!==decision.actionCode||row.runtime_selected_candidate_ref!==decision.authorityRef
          ||row.policy_version!==decision.managementPolicyVersion
          ||persistedReceipt?.managementPolicyEvidenceHash!==decision.managementPolicyEvidenceHash
          ||String(row.action_plan_id)!==item.plan.actionPlanId||String(row.content_hash)!==item.contentHash
          ||Number(row.leg_sequence)!==item.plan.legSequence
          ||String(row.depends_on_action_plan_id??'')!==String(item.plan.dependsOnActionPlanId??''))
          throw new Error('MANAGEMENT_PLAN_COMMIT_RECONCILIATION_CONFLICT');
      }
      return true;
    }});
  }

  private async insertPlan(client:PoolClient,plan:ApprovedMasterPaperActionPlan,contentHash:string,createdAt:string):Promise<boolean>{
    const result=await client.query(`INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,
      plan_version,status,plan_json,content_hash,not_before,created_at,updated_at,execution_tier,canonical_quantity,
      paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev,authority_kind,
      management_input_snapshot_id,management_action_frontier_id,action_group_id,leg_sequence,depends_on_action_plan_id)
      VALUES($1,$2,$3,$4,'READY',$5::jsonb,$6,$7,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(decision_id,action_group_id,leg_sequence) DO NOTHING RETURNING action_plan_id`,
    [plan.actionPlanId,plan.decisionId,plan.executionAccountId,plan.contractVersion,JSON.stringify(plan),contentHash,createdAt,
      plan.executionTier,plan.canonicalQuantity,plan.paperEvidenceQuantity,plan.empiricalEconomicsReady,plan.expectedAfterCostEv,
      plan.decisionAuthority,plan.managementInputSnapshotId,plan.managementActionFrontierId,plan.actionGroupId,
      plan.legSequence,plan.dependsOnActionPlanId]);
    if((result.rowCount??0)>0)return true;
    const replay=await client.query(`SELECT action_plan_id,content_hash FROM trade.master_paper_action_plan
      WHERE decision_id=$1 AND action_group_id=$2 AND leg_sequence=$3 FOR SHARE`,
    [plan.decisionId,plan.actionGroupId,plan.legSequence]);
    const existing=replay.rows[0] as {action_plan_id?:unknown;content_hash?:unknown}|undefined;
    if(existing===undefined||String(existing.action_plan_id)!==plan.actionPlanId||String(existing.content_hash)!==contentHash)
      throw new Error('ACTION_PLAN_IDEMPOTENCY_COLLISION');
    return false;
  }

  async claimNext(executionAccountId:string,workerId:string,now:string,
    options:{readonly allowNewRisk:boolean}={allowNewRisk:true}):Promise<ApprovedMasterPaperActionPlan|null>{
    const claimed=await withRuntimePostgresTransaction(this.pool,async(client)=>{
      const expired=await client.query(`UPDATE trade.master_paper_action_plan SET status='QUARANTINED',
        last_blockers_json='["DECISION_EXPIRED"]'::jsonb,claimed_by=NULL,claimed_at=NULL,claim_expires_at=NULL,updated_at=$2
        WHERE execution_account_id=$1 AND status IN ('READY','WAITING_GATE','CLAIMED')
          AND (plan_json->>'decisionExpiresAt')::timestamptz <= $2
        RETURNING action_plan_id`,[executionAccountId,now]);
      if((expired.rowCount??0)>0)await client.query(`INSERT INTO trade.master_paper_action_plan_event(
        action_plan_event_id,action_plan_id,state,event_time,detail_json)
        SELECT gen_random_uuid(),action_plan_id,'QUARANTINED',$2,'{"blockers":["DECISION_EXPIRED"]}'::jsonb
        FROM unnest($1::uuid[]) AS expired_id(action_plan_id)`,[expired.rows.map((row)=>String(row.action_plan_id)),now]);
      const result=await client.query(`SELECT p.action_plan_id,p.plan_json FROM trade.master_paper_action_plan p
        WHERE p.execution_account_id=$1 AND p.not_before<=$2 AND p.plan_version=$3 AND
          ($4::boolean OR p.authority_kind='MANAGEMENT') AND
          (p.status IN ('READY','WAITING_GATE') OR (p.status='CLAIMED' AND p.claim_expires_at<=$2))
          AND (p.depends_on_action_plan_id IS NULL OR EXISTS(
            SELECT 1 FROM trade.master_paper_action_plan parent
            JOIN trade.order_intent oi ON oi.order_intent_id=parent.execution_order_intent_id
            WHERE parent.action_plan_id=p.depends_on_action_plan_id AND oi.status='FILLED'))
        ORDER BY p.created_at,p.action_group_id,p.leg_sequence,p.action_plan_id
        FOR UPDATE OF p SKIP LOCKED LIMIT 1`,[executionAccountId,now,'theta-master-paper-action-plan-v3',options.allowNewRisk]);
      const row=result.rows[0] as {action_plan_id:string;plan_json:unknown}|undefined;
      if(row===undefined)return {plan:null,actionPlanId:null,claimExpiresAt:null};
      const claimExpiresAt=new Date(Date.parse(now)+120_000).toISOString();
      const updated=await client.query(`UPDATE trade.master_paper_action_plan SET status='CLAIMED',claimed_by=$2,claimed_at=$3,
        claim_expires_at=$4,updated_at=$3 WHERE action_plan_id=$1 AND
        (status IN ('READY','WAITING_GATE') OR (status='CLAIMED' AND claim_expires_at<=$3)) RETURNING action_plan_id`,
      [row.action_plan_id,workerId,now,claimExpiresAt]);
      if(updated.rowCount!==1)throw new Error('ACTION_PLAN_CLAIM_RACE');
      await client.query(`INSERT INTO trade.master_paper_action_plan_event(action_plan_event_id,action_plan_id,state,event_time,detail_json)
        VALUES($1,$2,'CLAIMED',$3,$4::jsonb)`,[randomUUID(),row.action_plan_id,now,JSON.stringify({workerId})]);
      return {plan:masterPaperActionPlanSchema.parse(row.plan_json) as ApprovedMasterPaperActionPlan,
        actionPlanId:row.action_plan_id,claimExpiresAt};
    },{verifyCommitted:async(pool,outcome)=>{
      if(outcome.actionPlanId===null)return true;
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT status,claimed_by,
        claimed_at::text,claim_expires_at::text FROM trade.master_paper_action_plan WHERE action_plan_id=$1`,
      [outcome.actionPlanId]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.status==='CLAIMED'&&row.claimed_by===workerId
        &&Date.parse(String(row.claimed_at))===Date.parse(now)
        &&Date.parse(String(row.claim_expires_at))===Date.parse(outcome.claimExpiresAt??''))return true;
      if(row.status==='READY'||row.status==='WAITING_GATE')return false;
      throw new Error('ACTION_PLAN_CLAIM_COMMIT_RECONCILIATION_CONFLICT');
    }});
    return claimed.plan;
  }

  async wait(actionPlanId:string,blockers:readonly string[],retryAt:string,at:string):Promise<void>{
    await this.transition(actionPlanId,'WAITING_GATE',at,blockers,retryAt);
  }

  async submitted(actionPlanId:string,orderIntentId:string,at:string):Promise<void>{
    await this.transition(actionPlanId,'SUBMITTED',at,[],null,{orderIntentId});
  }

  async terminal(actionPlanId:string,orderIntentId:string,at:string):Promise<void>{
    await this.transition(actionPlanId,'TERMINAL',at,[],null,{orderIntentId});
  }

  async quarantine(actionPlanId:string,blockers:readonly string[],at:string):Promise<void>{
    await this.transition(actionPlanId,'QUARANTINED',at,blockers,null);
  }

  private async transition(actionPlanId:string,state:MasterPaperActionPlanState,at:string,blockers:readonly string[],notBefore:string|null,
    extra:Record<string,unknown>={}):Promise<void>{
    await withRuntimePostgresTransaction(this.pool,async(client)=>{
      const result=await client.query(`UPDATE trade.master_paper_action_plan SET status=$2,last_blockers_json=$3::jsonb,
        not_before=COALESCE($4::timestamptz,not_before),claimed_by=NULL,claimed_at=NULL,claim_expires_at=NULL,updated_at=$5,
        execution_order_intent_id=COALESCE($6::uuid,execution_order_intent_id)
        WHERE action_plan_id=$1 AND status='CLAIMED' RETURNING action_plan_id`,
      [actionPlanId,state,JSON.stringify(blockers),notBefore,at,typeof extra.orderIntentId==='string'?extra.orderIntentId:null]);
      if(result.rowCount!==1)throw new Error('ACTION_PLAN_TRANSITION_RACE');
      await this.event(actionPlanId,state,at,{blockers,...extra},client);
    },{verifyCommitted:async(pool)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT status,last_blockers_json,
        not_before::text,execution_order_intent_id::text FROM trade.master_paper_action_plan WHERE action_plan_id=$1`,
      [actionPlanId]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.status!==state){
        if(row.status==='CLAIMED')return false;
        throw new Error('ACTION_PLAN_TRANSITION_COMMIT_RECONCILIATION_CONFLICT');
      }
      const persistedBlockers=Array.isArray(row.last_blockers_json)?row.last_blockers_json.map(String):[];
      if(canonicalJson(persistedBlockers)!==canonicalJson([...blockers])
        ||(typeof extra.orderIntentId==='string'&&String(row.execution_order_intent_id)!==extra.orderIntentId))
        throw new Error('ACTION_PLAN_TRANSITION_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }

  private async verifyPlanGroup(pool:Pool,expected:readonly {readonly plan:ApprovedMasterPaperActionPlan;
    readonly contentHash:string}[]):Promise<boolean>{
    const first=expected[0];
    if(first===undefined)return false;
    const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT action_plan_id,decision_id,
      action_group_id,leg_sequence,content_hash FROM trade.master_paper_action_plan
      WHERE decision_id=$1 AND action_group_id=$2 ORDER BY leg_sequence`,
    [first.plan.decisionId,first.plan.actionGroupId]));
    if(receipt.value.rows.length===0)return false;
    if(receipt.value.rows.length!==expected.length)throw new Error('ACTION_PLAN_COMMIT_RECONCILIATION_CONFLICT');
    for(const item of expected){
      const row=receipt.value.rows.find((value)=>Number(value.leg_sequence)===item.plan.legSequence) as Record<string,unknown>|undefined;
      if(row===undefined||String(row.action_plan_id)!==item.plan.actionPlanId
        ||String(row.decision_id)!==item.plan.decisionId||String(row.action_group_id)!==item.plan.actionGroupId
        ||String(row.content_hash)!==item.contentHash)throw new Error('ACTION_PLAN_COMMIT_RECONCILIATION_CONFLICT');
    }
    return true;
  }

  private async event(actionPlanId:string,state:MasterPaperActionPlanState,at:string,detail:Record<string,unknown>|null,db:Pool|PoolClient=this.pool):Promise<void>{
    await db.query(`INSERT INTO trade.master_paper_action_plan_event(action_plan_event_id,action_plan_id,state,event_time,detail_json)
      VALUES($1,$2,$3,$4,$5::jsonb)`,[randomUUID(),actionPlanId,state,at,JSON.stringify(detail??{})]);
  }
}
