import { createHash, randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { masterPaperActionPlanSchema, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';

export type MasterPaperActionPlanState='READY'|'CLAIMED'|'WAITING_GATE'|'SUBMITTED'|'TERMINAL'|'QUARANTINED';

const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');

export class PostgresMasterPaperActionPlanStore {
  constructor(private readonly pool:Pool){}

  async enqueue(raw:ApprovedMasterPaperActionPlan,createdAt:string,chain?:{
    readonly botInstanceId:string;readonly underlyingId:string;
  }):Promise<boolean>{
    const plan=masterPaperActionPlanSchema.parse(raw) as ApprovedMasterPaperActionPlan;
    const contentHash=hash(plan);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const evidence=await client.query(`SELECT d.decision_id,d.selected_candidate_id::text AS candidate_id,d.quantity::numeric AS quantity,
        d.aegis_action::text AS aegis_action,ea.account_kind::text AS account_kind,ea.account_ready
        FROM trade.decision d JOIN trade.execution_account ea ON ea.execution_account_id=$2
        WHERE d.decision_id=$1 FOR SHARE OF d,ea`,[plan.decisionId,plan.executionAccountId]);
      const row=evidence.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)throw new Error('ACTION_PLAN_DECISION_OR_ACCOUNT_NOT_FOUND');
      if(row.account_kind!=='MASTER_API_KEY'||row.account_ready!==true)throw new Error('ACTION_PLAN_MASTER_ACCOUNT_NOT_READY');
      if(String(row.candidate_id??'')!==plan.candidateId)throw new Error('ACTION_PLAN_SELECTED_CANDIDATE_MISMATCH');
      if(Number(row.quantity)!==plan.canonicalQuantity)throw new Error('ACTION_PLAN_CANONICAL_QUANTITY_MISMATCH');
      if(String(row.aegis_action)!==plan.aegisState)throw new Error('ACTION_PLAN_AEGIS_MISMATCH');
      if(chain!==undefined){
        if(chain.underlyingId!==plan.underlyingId)throw new Error('ACTION_PLAN_CHAIN_UNDERLYING_MISMATCH');
        await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at)
          VALUES($1,$2,$3,'WAIT',$4) ON CONFLICT(chain_id) DO NOTHING`,
        [plan.chainId,chain.botInstanceId,chain.underlyingId,createdAt]);
      }
      const result=await client.query(`INSERT INTO trade.master_paper_action_plan(action_plan_id,decision_id,execution_account_id,
        plan_version,status,plan_json,content_hash,not_before,created_at,updated_at,execution_tier,canonical_quantity,
        paper_evidence_quantity,empirical_economics_ready,expected_after_cost_ev)
        VALUES($1,$2,$3,$4,'READY',$5::jsonb,$6,$7,$7,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(decision_id) DO NOTHING RETURNING action_plan_id`,
      [plan.actionPlanId,plan.decisionId,plan.executionAccountId,plan.contractVersion,JSON.stringify(plan),contentHash,createdAt,
        plan.executionTier,plan.canonicalQuantity,plan.paperEvidenceQuantity,plan.empiricalEconomicsReady,plan.expectedAfterCostEv]);
      if((result.rowCount??0)>0)await this.event(plan.actionPlanId,'READY',createdAt,null,client);
      await client.query('COMMIT');
      return (result.rowCount??0)>0;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async claimNext(executionAccountId:string,workerId:string,now:string):Promise<ApprovedMasterPaperActionPlan|null>{
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const expired=await client.query(`UPDATE trade.master_paper_action_plan SET status='QUARANTINED',
        last_blockers_json='["DECISION_EXPIRED"]'::jsonb,claimed_by=NULL,claimed_at=NULL,claim_expires_at=NULL,updated_at=$2
        WHERE execution_account_id=$1 AND status IN ('READY','WAITING_GATE','CLAIMED')
          AND (plan_json->>'decisionExpiresAt')::timestamptz <= $2
        RETURNING action_plan_id`,[executionAccountId,now]);
      if((expired.rowCount??0)>0)await client.query(`INSERT INTO trade.master_paper_action_plan_event(
        action_plan_event_id,action_plan_id,state,event_time,detail_json)
        SELECT gen_random_uuid(),action_plan_id,'QUARANTINED',$2,'{"blockers":["DECISION_EXPIRED"]}'::jsonb
        FROM unnest($1::uuid[]) AS expired_id(action_plan_id)`,[expired.rows.map((row)=>String(row.action_plan_id)),now]);
      const result=await client.query(`SELECT action_plan_id,plan_json FROM trade.master_paper_action_plan
        WHERE execution_account_id=$1 AND not_before<=$2 AND
          (status IN ('READY','WAITING_GATE') OR (status='CLAIMED' AND claim_expires_at<=$2))
        ORDER BY created_at,action_plan_id FOR UPDATE SKIP LOCKED LIMIT 1`,[executionAccountId,now]);
      const row=result.rows[0] as {action_plan_id:string;plan_json:unknown}|undefined;
      if(row===undefined){await client.query('COMMIT');return null;}
      const claimExpiresAt=new Date(Date.parse(now)+120_000).toISOString();
      const updated=await client.query(`UPDATE trade.master_paper_action_plan SET status='CLAIMED',claimed_by=$2,claimed_at=$3,
        claim_expires_at=$4,updated_at=$3 WHERE action_plan_id=$1 AND
        (status IN ('READY','WAITING_GATE') OR (status='CLAIMED' AND claim_expires_at<=$3)) RETURNING action_plan_id`,
      [row.action_plan_id,workerId,now,claimExpiresAt]);
      if(updated.rowCount!==1)throw new Error('ACTION_PLAN_CLAIM_RACE');
      await client.query(`INSERT INTO trade.master_paper_action_plan_event(action_plan_event_id,action_plan_id,state,event_time,detail_json)
        VALUES($1,$2,'CLAIMED',$3,$4::jsonb)`,[randomUUID(),row.action_plan_id,now,JSON.stringify({workerId})]);
      await client.query('COMMIT');
      return masterPaperActionPlanSchema.parse(row.plan_json) as ApprovedMasterPaperActionPlan;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
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
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const result=await client.query(`UPDATE trade.master_paper_action_plan SET status=$2,last_blockers_json=$3::jsonb,
        not_before=COALESCE($4::timestamptz,not_before),claimed_by=NULL,claimed_at=NULL,claim_expires_at=NULL,updated_at=$5
        WHERE action_plan_id=$1 AND status='CLAIMED' RETURNING action_plan_id`,
      [actionPlanId,state,JSON.stringify(blockers),notBefore,at]);
      if(result.rowCount!==1)throw new Error('ACTION_PLAN_TRANSITION_RACE');
      await this.event(actionPlanId,state,at,{blockers,...extra},client);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  private async event(actionPlanId:string,state:MasterPaperActionPlanState,at:string,detail:Record<string,unknown>|null,db:Pool|PoolClient=this.pool):Promise<void>{
    await db.query(`INSERT INTO trade.master_paper_action_plan_event(action_plan_event_id,action_plan_id,state,event_time,detail_json)
      VALUES($1,$2,$3,$4,$5::jsonb)`,[randomUUID(),actionPlanId,state,at,JSON.stringify(detail??{})]);
  }
}
