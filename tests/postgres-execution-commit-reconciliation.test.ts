import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool,PoolClient } from 'pg';
import { PostgresMasterPaperActionPlanStore } from '../src/execution/postgres-master-paper-action-plan-store.js';
import { masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from '../src/execution/master-paper-action-handoff.js';
import { PostgresCommitOutcomeUnknownError } from '../src/theta/postgres-runtime-error.js';
import { PostgresPaperOrderStore } from '../src/execution/postgres-paper-order-store.js';
import { PostgresTradeUpdateStore } from '../src/execution/postgres-trade-update-store.js';
import type { ManagementDecisionDraft } from '../src/execution/management-paper-plan-assembly.js';
import { testAegisAssessmentIdentity } from './fixtures/aegis-assessment-identity.js';

class ScriptedClient extends EventEmitter{
  released:boolean[]=[];
  constructor(private readonly handler:(sql:string,values:readonly unknown[])=>Promise<{rows:unknown[];rowCount:number}>){super();}
  query(sql:string,values:readonly unknown[]=[]){return this.handler(sql,values);}
  release(discard=false){this.released.push(discard);}
}

const poolOf=(...clients:ScriptedClient[]):Pool=>{
  let cursor=0;
  return {connect:async()=>clients[cursor++] as unknown as PoolClient} as Pool;
};

const persistedCandidateId='10000000-0000-4000-8000-000000000008';
const aegisAssessmentIdentity=testAegisAssessmentIdentity({persistedCandidateId});
const plan:ApprovedMasterPaperActionPlan={
  contractVersion:masterPaperActionPlanVersion,actionPlanId:'10000000-0000-4000-8000-000000000001',
  decisionAuthority:'NEW_RISK',managementInputSnapshotId:null,managementActionFrontierId:null,
  actionGroupId:'10000000-0000-4000-8000-000000000001',legSequence:1,dependsOnActionPlanId:null,
  executionAccountId:'10000000-0000-4000-8000-000000000002',decisionId:'10000000-0000-4000-8000-000000000003',
  candidateId:persistedCandidateId,strategyVersion:'strategy-v1',chainId:'10000000-0000-4000-8000-000000000004',
  optionContractId:'10000000-0000-4000-8000-000000000005',underlyingId:'10000000-0000-4000-8000-000000000006',
  underlying:'AAPL',optionType:'PUT',symbol:'AAPL261016P00150000',quantity:1,canonicalQuantity:1,
  paperEvidenceQuantity:1,paperEvidenceRiskCap:1,paperEvidenceCapReason:'CANONICAL_QUANTITY_LOWER',
  executionTier:'PAPER_EVIDENCE',multiplier:100,action:'OPEN_CSP',economicBoundary:0.03,economicsRemainPositive:true,
  expectedAfterCostEv:null,empiricalEconomicsReady:false,selectedByCanonicalAuthority:true,hardValidityPassed:true,
  accountVerified:true,optionsCapabilityVerified:true,noEquivalentExposureConflict:true,aegisState:'ALLOW_FULL',
  aegisAssessmentIdentity,
  killSwitchActive:false,decisionExpiresAt:'2026-09-23T16:00:00.000Z',
  pricingPolicy:{waitIntervalMs:5000,maxAttempts:3,concessionFractions:[0,0.5,1],tickSize:0.01},
  pricingAttempt:0,previousLimit:null,
};

const decisionRow={decision_id:plan.decisionId,decision_kind:'NEW_RISK',candidate_id:plan.candidateId,quantity:1,aegis_action:'ALLOW_FULL',
  runtime_selected_candidate_ref:aegisAssessmentIdentity.runtimeCandidateRef,
  decision_decided_at:aegisAssessmentIdentity.decisionAsOf,
  aegis_input_origin:'DERIVED_FROM_REAL',aegis_assessment_identity:aegisAssessmentIdentity,
  fusion_snapshot_id:aegisAssessmentIdentity.fusionSnapshotId,fusion_snapshot_hash:aegisAssessmentIdentity.fusionSnapshotHash,
  decision_time:aegisAssessmentIdentity.decisionAsOf,option_contract_id:plan.optionContractId,
  contract_symbol:plan.symbol,underlying_symbol:plan.underlying,account_kind:'MASTER_API_KEY',account_ready:true};

function enqueueClients(mode:'MATCH'|'ABSENT'|'CONFLICT'):[ScriptedClient,ScriptedClient]{
  let contentHash='';
  const transaction=new ScriptedClient(async(sql,values)=>{
    if(sql.includes('FROM trade.decision d'))return {rows:[decisionRow],rowCount:1};
    if(sql.includes('INSERT INTO trade.master_paper_action_plan(')){contentHash=String(values[5]);return {rows:[{action_plan_id:plan.actionPlanId}],rowCount:1};}
    if(sql==='COMMIT')throw {code:'08006'};
    return {rows:[],rowCount:0};
  });
  const verify=new ScriptedClient(async()=>({rows:mode==='ABSENT'?[]:[{action_plan_id:mode==='CONFLICT'
    ?'20000000-0000-4000-8000-000000000001':plan.actionPlanId,decision_id:plan.decisionId,
    action_group_id:plan.actionGroupId,leg_sequence:1,content_hash:contentHash}],rowCount:mode==='ABSENT'?0:1}));
  return [transaction,verify];
}

test('action-plan enqueue reconciles a lost COMMIT response without replaying the insert',async()=>{
  const [transaction,verify]=enqueueClients('MATCH');
  assert.equal(await new PostgresMasterPaperActionPlanStore(poolOf(transaction,verify)).enqueue(plan,'2026-09-23T15:00:00.000Z'),true);
  assert.deepEqual(transaction.released,[true]);
  assert.deepEqual(verify.released,[false]);
});

test('action-plan enqueue keeps absent and conflicting ambiguous commits distinct',async()=>{
  const absent=enqueueClients('ABSENT');
  await assert.rejects(new PostgresMasterPaperActionPlanStore(poolOf(...absent)).enqueue(plan,'2026-09-23T15:00:00.000Z'),
    PostgresCommitOutcomeUnknownError);
  const conflict=enqueueClients('CONFLICT');
  await assert.rejects(new PostgresMasterPaperActionPlanStore(poolOf(...conflict)).enqueue(plan,'2026-09-23T15:00:00.000Z'),
    /ACTION_PLAN_COMMIT_RECONCILIATION_CONFLICT/);
});

test('action-plan enqueue rechecks persisted AEGIS assessment identity before writing',async()=>{
  let insertAttempted=false;
  const transaction=new ScriptedClient(async(sql)=>{
    if(sql.includes('FROM trade.decision d'))return {rows:[{...decisionRow,
      runtime_selected_candidate_ref:'THETA_CONVENTIONAL:OTHER_CONTRACT'}],rowCount:1};
    if(sql.includes('INSERT INTO trade.master_paper_action_plan('))insertAttempted=true;
    return {rows:[],rowCount:0};
  });
  await assert.rejects(new PostgresMasterPaperActionPlanStore(poolOf(transaction)).enqueue(plan,
    '2026-09-23T15:00:00.000Z'),/ACTION_PLAN_AEGIS_ASSESSMENT_LINEAGE_INVALID/);
  assert.equal(insertAttempted,false);
});

test('atomic management publication reconciles the decision and complete plan group after lost COMMIT',async()=>{
  const managementPlan:ApprovedMasterPaperActionPlan={...plan,decisionAuthority:'MANAGEMENT',
    actionPlanId:'30000000-0000-4000-8000-000000000001',actionGroupId:'30000000-0000-4000-8000-000000000001',
    decisionId:'30000000-0000-4000-8000-000000000002',candidateId:'management:30000000-0000-4000-8000-000000000003:CLOSE_FULL',
    managementInputSnapshotId:'30000000-0000-4000-8000-000000000004',
    managementActionFrontierId:'30000000-0000-4000-8000-000000000003',action:'CLOSE_CSP',aegisState:'HOLD_ONLY'};
  const decision:ManagementDecisionDraft={decisionId:managementPlan.decisionId,decisionKind:'MANAGEMENT',actionCode:'CLOSE_FULL',
    quantity:1,aegisAction:'HOLD_ONLY',strategyVersion:managementPlan.strategyVersion,
    managementPolicyVersion:'management-policy-v1',managementPolicyEvidenceHash:'b'.repeat(64),
    authorityRef:managementPlan.candidateId,decidedAt:'2026-09-23T15:00:00.000Z',reasonCodes:['SELECT_CLOSE_FULL']};
  let contentHash='';
  const transaction=new ScriptedClient(async(sql,values)=>{
    if(sql.includes('FROM trade.management_action_frontier'))return {rows:[{management_action_frontier_id:managementPlan.managementActionFrontierId,
      selected_action:'CLOSE_FULL',decision_state:'ACTION_SELECTED',policy_version:decision.managementPolicyVersion,
      policy_evidence_hash:decision.managementPolicyEvidenceHash,management_input_snapshot_id:managementPlan.managementInputSnapshotId,
      fusion_snapshot_id:'30000000-0000-4000-8000-000000000005',chain_id:managementPlan.chainId,
      input_json:{underlyingId:managementPlan.underlyingId},account_kind:'MASTER_API_KEY',account_ready:true}],rowCount:1};
    if(sql.includes('INSERT INTO trade.decision('))return {rows:[{decision_id:decision.decisionId}],rowCount:1};
    if(sql.includes('INSERT INTO trade.master_paper_action_plan(')){contentHash=String(values[5]);return {rows:[{action_plan_id:managementPlan.actionPlanId}],rowCount:1};}
    if(sql==='COMMIT')throw {code:'08006'};
    return {rows:[],rowCount:1};
  });
  const verify=new ScriptedClient(async()=>({rows:[{action_code:decision.actionCode,
    runtime_selected_candidate_ref:decision.authorityRef,policy_version:decision.managementPolicyVersion,
    receipt_json:{managementPolicyEvidenceHash:decision.managementPolicyEvidenceHash},action_plan_id:managementPlan.actionPlanId,
    content_hash:contentHash,leg_sequence:1,depends_on_action_plan_id:null}],rowCount:1}));
  assert.equal(await new PostgresMasterPaperActionPlanStore(poolOf(transaction,verify))
    .publishManagementPlans(decision,[managementPlan],'2026-09-23T15:00:00.000Z'),1);
  assert.deepEqual(transaction.released,[true]);
});

test('SUBMITTED transition reconciles its exact order-intent identity after a lost COMMIT response',async()=>{
  const orderIntentId='10000000-0000-4000-8000-000000000007';
  const transaction=new ScriptedClient(async(sql)=>{
    if(sql.includes('UPDATE trade.master_paper_action_plan'))return {rows:[{action_plan_id:plan.actionPlanId}],rowCount:1};
    if(sql==='COMMIT')throw {code:'57P03'};
    return {rows:[],rowCount:0};
  });
  const verify=new ScriptedClient(async()=>({rows:[{status:'SUBMITTED',last_blockers_json:[],not_before:null,
    execution_order_intent_id:orderIntentId}],rowCount:1}));
  await new PostgresMasterPaperActionPlanStore(poolOf(transaction,verify)).submitted(plan.actionPlanId,orderIntentId,
    '2026-09-23T15:01:00.000Z');
  assert.deepEqual(transaction.released,[true]);
});

test('claimNext reconciles the exact worker and claim window after a lost COMMIT response',async()=>{
  const now='2026-09-23T15:01:00.000Z';
  const expires='2026-09-23T15:03:00.000Z';
  const transaction=new ScriptedClient(async(sql)=>{
    if(sql.includes('SELECT p.action_plan_id,p.plan_json'))return {rows:[{action_plan_id:plan.actionPlanId,plan_json:plan,...decisionRow}],rowCount:1};
    if(sql.includes("SET status='CLAIMED'"))return {rows:[{action_plan_id:plan.actionPlanId}],rowCount:1};
    if(sql==='COMMIT')throw {code:'08006'};
    return {rows:[],rowCount:0};
  });
  const verify=new ScriptedClient(async()=>({rows:[{status:'CLAIMED',claimed_by:'worker-1',claimed_at:now,
    claim_expires_at:expires}],rowCount:1}));
  const claimed=await new PostgresMasterPaperActionPlanStore(poolOf(transaction,verify))
    .claimNext(plan.executionAccountId,'worker-1',now);
  assert.equal(claimed?.actionPlanId,plan.actionPlanId);
  assert.deepEqual(transaction.released,[true]);
});

test('order-intent SUBMITTED state and provider order reconcile after a lost COMMIT response',async()=>{
  const transaction=new ScriptedClient(async(sql)=>{
    if(sql.includes('UPDATE trade.order_intent'))return {rows:[{order_intent_id:'intent-1'}],rowCount:1};
    if(sql==='COMMIT')throw {code:'08006'};
    return {rows:[],rowCount:1};
  });
  const verify=new ScriptedClient(async()=>({rows:[{status:'SUBMITTED',broker_state_matches:true}],rowCount:1}));
  await new PostgresPaperOrderStore(poolOf(transaction,verify)).transitionIntent('intent-1','SUBMITTING','SUBMITTED','broker-1');
  assert.deepEqual(transaction.released,[true]);
});

test('a fill event is reconciled by provider event and fill identities after a lost COMMIT response',async()=>{
  const update={eventId:'event-1',event:'fill',providerOrderId:'broker-1',clientOrderId:'theta-1',
    providerFillId:'fill-1',eventTime:'2026-09-23T15:02:00.000Z',fillQuantity:1,fillPrice:1.25,
    cumulativeFilledQuantity:1,orderState:'FILLED' as const,payloadHash:'a'.repeat(64)};
  const transaction=new ScriptedClient(async(sql)=>{
    if(sql.includes('FROM trade.broker_order b'))return {rows:[{broker_order_id:'broker-row-1',order_intent_id:'intent-1',status:'ACKNOWLEDGED'}],rowCount:1};
    if(sql.includes('INSERT INTO trade.broker_order_event'))return {rows:[{broker_order_event_id:'event-row-1'}],rowCount:1};
    if(sql.includes('INSERT INTO trade.fill'))return {rows:[{fill_id:'fill-row-1'}],rowCount:1};
    if(sql==='COMMIT')throw {code:'57P03'};
    return {rows:[],rowCount:1};
  });
  const verify=new ScriptedClient(async()=>({rows:[{payload_hash:update.payloadHash,status:'FILLED',fill_exists:true}],rowCount:1}));
  const result=await new PostgresTradeUpdateStore(poolOf(transaction,verify)).apply(update);
  assert.deepEqual(result,{matched:true,duplicate:false,fillInserted:true});
  assert.deepEqual(transaction.released,[true]);
});
