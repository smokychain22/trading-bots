import { createHash, randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { managementOrderActions, type ManagementDecisionDraft } from './management-paper-plan-assembly.js';
import { masterPaperActionPlanSchema, masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { verifyAegisAssessmentIdentity } from '../theta/aegis-assessment-identity.js';
import { actionPlanContentHash, managementDecisionIsCurrent, planIntegrityMismatch, planIntegrityRowFromAliases, planIntegritySelectColumns, verifyActionPlanRow } from './action-plan-integrity.js';

export const planNoLongerCurrent='PLAN_NO_LONGER_CURRENT' as const;
const integrityColumns=planIntegritySelectColumns;
const integrityRow=planIntegrityRowFromAliases;

export type MasterPaperActionPlanState='READY'|'CLAIMED'|'WAITING_GATE'|'SUBMITTED'|'TERMINAL'|'QUARANTINED';

const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');

function assertNewRiskAegisLineage(row:Record<string,unknown>,plan:ApprovedMasterPaperActionPlan):void{
  const planIdentity=verifyAegisAssessmentIdentity(plan.aegisAssessmentIdentity);
  const persistedIdentity=verifyAegisAssessmentIdentity(row.aegis_assessment_identity);
  if(planIdentity===null||persistedIdentity===null
    ||canonicalJson(planIdentity)!==canonicalJson(persistedIdentity)
    ||planIdentity.fusionSnapshotId!==String(row.fusion_snapshot_id)
    ||planIdentity.fusionSnapshotHash!==String(row.fusion_snapshot_hash)
    ||Date.parse(planIdentity.decisionAsOf)!==Date.parse(String(row.decision_time))
    ||Date.parse(planIdentity.decisionAsOf)!==Date.parse(String(row.decision_decided_at))
    ||planIdentity.runtimeCandidateRef!==String(row.runtime_selected_candidate_ref)
    ||plan.decisionId!==String(row.decision_id)
    ||planIdentity.persistedCandidateId!==String(row.candidate_id)
    ||planIdentity.underlying!==String(row.underlying_symbol)
    ||planIdentity.optionSymbol!==String(row.contract_symbol)
    // Q is assessed per contract symbol; H/D are assessed as their own canonical candidate (strategy-bound, never Q's verdict for the same contract)
    ||planIdentity.assessmentCandidateId!==((planIdentity.strategyBranch??'THETA_CONVENTIONAL')==='THETA_CONVENTIONAL'?String(row.contract_symbol):String(row.runtime_selected_candidate_ref))
    ||planIdentity.newRiskState!==String(row.aegis_action)
    ||plan.optionContractId!==String(row.option_contract_id)){
    throw new Error('ACTION_PLAN_AEGIS_ASSESSMENT_LINEAGE_INVALID');
  }
}

/**
 * NEW-RISK ENTRY pending-exposure guard (exported for tests). Ids of any OTHER entry plan for the same contract that is still
 * READY / CLAIMED / WAITING_GATE inside its decision window, or any entry order intent for it that is not terminal.
 */
export async function readEquivalentEntryInFlight(client:{query:(text:string,values?:unknown[])=>Promise<{rows:unknown[]}>},
  input:{readonly executionAccountId:string;readonly decisionId:string;readonly optionContractId:string;readonly at:string}):Promise<readonly string[]>{
  const result=await client.query(`SELECT id FROM (
    SELECT p.action_plan_id::text AS id FROM trade.master_paper_action_plan p
     WHERE p.execution_account_id=$1 AND p.decision_id<>$2 AND p.status IN ('READY','CLAIMED','WAITING_GATE')
       AND p.plan_json->>'action'='OPEN_CSP' AND p.plan_json->>'optionContractId'=$3
       AND (p.plan_json->>'decisionExpiresAt')::timestamptz > $5::timestamptz
    UNION ALL
    SELECT oi.order_intent_id::text AS id FROM trade.order_intent oi
     WHERE oi.execution_account_id=$1 AND oi.decision_id<>$2 AND oi.theta_action='OPEN_CSP'
       AND oi.option_contract_id::text=$3 AND oi.status::text <> ALL($4::text[])) conflicts LIMIT 5`,
  [input.executionAccountId,input.decisionId,input.optionContractId,['FILLED','CANCELED','REJECTED','EXPIRED'],input.at]);
  return (result.rows as Record<string,unknown>[]).map((row)=>String(row.id));
}

export class PostgresMasterPaperActionPlanStore {
  constructor(private readonly pool:Pool){}

  async enqueue(raw:ApprovedMasterPaperActionPlan,createdAt:string,chain?:{
    readonly botInstanceId:string;readonly underlyingId:string;
  }):Promise<boolean>{
    return (await this.enqueueWithDisposition(raw,createdAt,chain)).inserted;
  }

  /**
   * NEW-RISK ENTRY duplicate guard (resting-order pending exposure). A DAY entry order that has not filled yet is exactly what the
   * next scan sees again: a new decision id (so a new plan row) for the SAME contract. While another entry plan for the same
   * contract is READY / CLAIMED / WAITING_GATE, or an entry order intent for it is still non-terminal (including one the broker
   * snapshot used by the scan cannot show yet), a second economically identical entry is NOT enqueued. It becomes enqueueable
   * again as soon as the first order is terminal (filled, expired at the close, cancelled), i.e. the next session. Entry
   * repricing as a fill-rate enhancement is deliberately not built here (OWNER_POLICY / EMPIRICAL).
   */
  async enqueueWithDisposition(raw:ApprovedMasterPaperActionPlan,createdAt:string,chain?:{
    readonly botInstanceId:string;readonly underlyingId:string;
  }):Promise<{readonly inserted:boolean;readonly disposition:'ENQUEUED'|'REPLAY'|'EQUIVALENT_ENTRY_IN_FLIGHT';readonly conflictingIds:readonly string[]}>{
    const plan=masterPaperActionPlanSchema.parse(raw) as ApprovedMasterPaperActionPlan;
    const contentHash=hash(plan);
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
      const evidence=await client.query(`SELECT d.decision_id,d.decision_kind,d.selected_candidate_id::text AS candidate_id,
        d.runtime_selected_candidate_ref,d.quantity::numeric AS quantity,d.aegis_action::text AS aegis_action,
        d.decided_at::text AS decision_decided_at,
        d.receipt_json->>'aegisInputOrigin' AS aegis_input_origin,
        d.receipt_json->'aegisAssessmentIdentity' AS aegis_assessment_identity,
        fs.fusion_snapshot_id::text,fs.content_hash AS fusion_snapshot_hash,fs.decision_time::text,
        c.option_contract_id::text,oc.contract_symbol,u.symbol AS underlying_symbol,
        ea.account_kind::text AS account_kind,ea.account_ready
        FROM trade.decision d
        JOIN trade.fusion_snapshot fs ON fs.fusion_snapshot_id=d.fusion_snapshot_id
        JOIN trade.candidate c ON c.candidate_id=d.selected_candidate_id
        JOIN market.option_contract oc ON oc.option_contract_id=c.option_contract_id
        JOIN market.underlying u ON u.underlying_id=oc.underlying_id
        JOIN trade.execution_account ea ON ea.execution_account_id=$2
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
      assertNewRiskAegisLineage(row,plan);
      if(plan.action==='OPEN_CSP'&&plan.optionContractId!==null){
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`entry:${plan.executionAccountId}:${plan.optionContractId}`]);
        const equivalent=await readEquivalentEntryInFlight(client,{executionAccountId:plan.executionAccountId,decisionId:plan.decisionId,
          optionContractId:plan.optionContractId,at:createdAt});
        if(equivalent.length>0){
          return {inserted:false,disposition:'EQUIVALENT_ENTRY_IN_FLIGHT' as const,
            conflictingIds:equivalent};
        }
      }
      if(chain!==undefined){
        if(chain.underlyingId!==plan.underlyingId)throw new Error('ACTION_PLAN_CHAIN_UNDERLYING_MISMATCH');
        await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at)
          VALUES($1,$2,$3,'WAIT',$4) ON CONFLICT(chain_id) DO NOTHING`,
        [plan.chainId,chain.botInstanceId,chain.underlyingId,createdAt]);
      }
      const inserted=await this.insertPlan(client,plan,contentHash,createdAt);
      if(inserted)await this.event(plan.actionPlanId,'READY',createdAt,null,client);
      return {inserted,disposition:(inserted?'ENQUEUED':'REPLAY') as 'ENQUEUED'|'REPLAY',conflictingIds:[] as readonly string[]};
    },{verifyCommitted:async(pool,outcome)=>outcome.disposition==='EQUIVALENT_ENTRY_IN_FLIGHT'
      ?true:this.verifyPlanGroup(pool,[{plan,contentHash}])});
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
      let corrupt:string[]=[];
      let row:Record<string,unknown>|undefined;
      // A plan whose stored payload no longer matches its sealed hash is quarantined and the scan moves on: one corrupt row
      // can neither execute nor stall every other plan.
      for(let attempt=0;attempt<5;attempt+=1){
      const result=await client.query(`SELECT p.action_plan_id,p.plan_json,${integrityColumns},
        d.decision_id::text,d.decision_kind,d.selected_candidate_id::text AS candidate_id,d.aegis_action::text AS aegis_action,
        d.runtime_selected_candidate_ref,d.decided_at::text AS decision_decided_at,
        d.receipt_json->'aegisAssessmentIdentity' AS aegis_assessment_identity,
        fs.fusion_snapshot_id::text,fs.content_hash AS fusion_snapshot_hash,fs.decision_time::text,
        c.option_contract_id::text,oc.contract_symbol,u.symbol AS underlying_symbol
        FROM trade.master_paper_action_plan p
        JOIN trade.decision d ON d.decision_id=p.decision_id
        JOIN trade.fusion_snapshot fs ON fs.fusion_snapshot_id=d.fusion_snapshot_id
        LEFT JOIN trade.candidate c ON c.candidate_id=d.selected_candidate_id
        LEFT JOIN market.option_contract oc ON oc.option_contract_id=c.option_contract_id
        LEFT JOIN market.underlying u ON u.underlying_id=oc.underlying_id
        WHERE p.execution_account_id=$1 AND p.not_before<=$2 AND p.plan_version=$3 AND
          ($4::boolean OR p.authority_kind='MANAGEMENT') AND
          (p.status IN ('READY','WAITING_GATE') OR (p.status='CLAIMED' AND p.claim_expires_at<=$2))
          AND (p.depends_on_action_plan_id IS NULL OR EXISTS(
            SELECT 1 FROM trade.master_paper_action_plan parent
            JOIN trade.order_intent oi ON oi.order_intent_id=parent.execution_order_intent_id
            WHERE parent.action_plan_id=p.depends_on_action_plan_id AND oi.status='FILLED'))
        ORDER BY p.created_at,p.action_group_id,p.leg_sequence,p.action_plan_id
        FOR UPDATE OF p SKIP LOCKED LIMIT 1`,[executionAccountId,now,masterPaperActionPlanVersion,options.allowNewRisk]);
      row=result.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)break;
      const integrity=verifyActionPlanRow(integrityRow(row));
      if(integrity.ok)break;
      corrupt=[...integrity.mismatches];
      await client.query(`UPDATE trade.master_paper_action_plan SET status='QUARANTINED',last_blockers_json=$3::jsonb,claimed_by=NULL,
        claimed_at=NULL,claim_expires_at=NULL,updated_at=$2 WHERE action_plan_id=$1 AND status IN ('READY','WAITING_GATE','CLAIMED')`,
      [row.action_plan_id,now,JSON.stringify([planIntegrityMismatch])]);
      await client.query(`INSERT INTO trade.master_paper_action_plan_event(action_plan_event_id,action_plan_id,state,event_time,detail_json)
        VALUES($1,$2,'QUARANTINED',$3,$4::jsonb)`,[randomUUID(),row.action_plan_id,now,JSON.stringify({blockers:[planIntegrityMismatch],mismatches:corrupt})]);
      row=undefined;
      }
      if(row===undefined)return {plan:null,actionPlanId:null,claimExpiresAt:null};
      const plan=masterPaperActionPlanSchema.parse(row.plan_json) as ApprovedMasterPaperActionPlan;
      if(plan.decisionAuthority==='NEW_RISK')assertNewRiskAegisLineage(row,plan);
      const claimExpiresAt=new Date(Date.parse(now)+120_000).toISOString();
      const updated=await client.query(`UPDATE trade.master_paper_action_plan SET status='CLAIMED',claimed_by=$2,claimed_at=$3,
        claim_expires_at=$4,updated_at=$3 WHERE action_plan_id=$1 AND
        (status IN ('READY','WAITING_GATE') OR (status='CLAIMED' AND claim_expires_at<=$3)) RETURNING action_plan_id`,
      [row.action_plan_id,workerId,now,claimExpiresAt]);
      if(updated.rowCount!==1)throw new Error('ACTION_PLAN_CLAIM_RACE');
      await client.query(`INSERT INTO trade.master_paper_action_plan_event(action_plan_event_id,action_plan_id,state,event_time,detail_json)
        VALUES($1,$2,'CLAIMED',$3,$4::jsonb)`,[randomUUID(),row.action_plan_id,now,JSON.stringify({workerId})]);
      return {plan,actionPlanId:String(row.action_plan_id),claimExpiresAt};
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

  /** Re-reads the stored row immediately before submit and proves it is still exactly the claimed, approved plan. */
  async verifyBeforeSubmit(actionPlanId:string,claimed:ApprovedMasterPaperActionPlan,workerId:string,now:string=new Date().toISOString()):Promise<{readonly ok:boolean;readonly mismatches:readonly string[]}>{
    const read=await withRuntimePostgresReadRetry(this.pool,(client)=>client.query(`SELECT ${integrityColumns},p.status,p.claimed_by,p.claim_expires_at
      FROM trade.master_paper_action_plan p WHERE p.action_plan_id=$1`,[actionPlanId]));
    const row=read.value.rows[0] as Record<string,unknown>|undefined;
    if(row===undefined)return {ok:false,mismatches:['PLAN_ROW_MISSING']};
    const integrity=verifyActionPlanRow(integrityRow(row));
    if(!integrity.ok)return {ok:false,mismatches:integrity.mismatches};
    if(actionPlanContentHash(integrity.plan)!==actionPlanContentHash(claimed))return {ok:false,mismatches:['CLAIMED_PLAN_DIFFERS_FROM_STORED']};
    if(row.status!=='CLAIMED')return {ok:false,mismatches:['PLAN_NOT_CLAIMED']};
    // The claim must still belong to THIS worker and be unexpired: a stalled worker whose claim was reclaimed must not also submit.
    if(row.claimed_by!==workerId||!(Date.parse(String(row.claim_expires_at))>Date.parse(now)))return {ok:false,mismatches:['PLAN_CLAIM_NOT_HELD']};
    if(claimed.decisionAuthority==='MANAGEMENT'){
      // The management decision must still be the current one for its chain: the chain is open and still in the lifecycle
      // state the decision was made in. Otherwise the decision is superseded and a NEW management decision is required.
      const chain=await withRuntimePostgresReadRetry(this.pool,(client)=>client.query(`SELECT ec.closed_at,ec.lifecycle_state::text AS chain_state,
        mis.lifecycle_state::text AS plan_state FROM trade.economic_chain ec
        LEFT JOIN trade.management_input_snapshot mis ON mis.management_input_snapshot_id=$2 WHERE ec.chain_id=$1`,
      [claimed.chainId,claimed.managementInputSnapshotId]));
      const current=chain.value.rows[0] as Record<string,unknown>|undefined;
      if(current===undefined||!managementDecisionIsCurrent({legSequence:claimed.legSequence,chainClosed:current.closed_at!==null,
        chainState:current.chain_state==null?null:String(current.chain_state),
        planState:current.plan_state==null?null:String(current.plan_state)}))return {ok:false,mismatches:[planNoLongerCurrent]};
    }
    return {ok:true,mismatches:[]};
  }

  async wait(actionPlanId:string,blockers:readonly string[],retryAt:string,at:string):Promise<void>{
    await this.transition(actionPlanId,'WAITING_GATE',at,blockers,retryAt);
  }

  /**
   * Releases a plan back to WAITING_GATE ONLY while it is still claimed by this exact worker. An invocation that lost its claim (it
   * expired and another invocation reclaimed the plan) must never clear that other invocation's claim. Returns false when the claim
   * is not ours (nothing is changed).
   */
  async releaseOwnClaim(actionPlanId:string,workerId:string,blockers:readonly string[],retryAt:string,at:string):Promise<boolean>{
    return withRuntimePostgresTransaction(this.pool,(client)=>this.releaseOwnClaimOn(client,actionPlanId,workerId,blockers,retryAt,at));
  }

  /** Transaction-composable form of releaseOwnClaim (the caller owns BEGIN/COMMIT). */
  async releaseOwnClaimOn(client:PoolClient,actionPlanId:string,workerId:string,blockers:readonly string[],retryAt:string,at:string):Promise<boolean>{
    const result=await client.query(`UPDATE trade.master_paper_action_plan SET status='WAITING_GATE',last_blockers_json=$3::jsonb,
      not_before=COALESCE($4::timestamptz,not_before),claimed_by=NULL,claimed_at=NULL,claim_expires_at=NULL,updated_at=$5
      WHERE action_plan_id=$1 AND status='CLAIMED' AND claimed_by=$2 RETURNING action_plan_id`,
    [actionPlanId,workerId,JSON.stringify(blockers),retryAt,at]);
    if(result.rowCount!==1)return false;
    await this.event(actionPlanId,'WAITING_GATE',at,{blockers,releasedBy:'OWN_CLAIM_RELEASE'},client);
    return true;
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
