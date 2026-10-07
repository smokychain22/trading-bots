import type { Pool } from 'pg';
import type { PaperBrokerAdapter,BrokerOrderSnapshot } from './broker.js';
import { buildFirstCanaryAcceptanceReceipt,type CanaryBrokerState,type CanaryPackageLeg,
  type FirstCanaryAcceptanceReceipt } from './first-canary-acceptance.js';
import { isAutonomousMasterPaperAccepted,PostgresPaperExecutionAuthorizationStore,unfilledTerminalBrokerOrderSql,
  type PersistedPaperExecutionControl } from './paper-execution-authorization.js';
import { economicIdentitySeed, generateClientOrderId } from '../theta/order-intent-state.js';
import type { Evidence } from '../theta/first-paper-order-readiness.js';
import { masterPaperActionPlanSchema,type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';

type Row=Record<string,unknown>;
const good=<T>(value:T,source:string,asOf:string):Evidence<T>=>({state:'GOOD',value,source,asOf});
const invalid=<T>(source:string,asOf:string):Evidence<T>=>({state:'INVALID',value:null,source,asOf});

/** UNFILLED_REARM_REQUIRED: every canary so far ended CANCELED/EXPIRED with zero fills (no exposure, nothing to accept). New risk stays
 * locked; only the governed owner-authority activation (FIRST_PAPER_CANARY_ACTIVATE, which re-checks every activation gate) re-arms exactly one more canary. The lane never reopens by itself. */
export type FirstCanaryRuntimeAcceptanceState='NO_CANARY'|'IN_PROGRESS'|'FAILED'|'UNFILLED_REARM_REQUIRED'|'AUTONOMOUS_PAPER_ACTIVE';
export interface FirstCanaryRuntimeAcceptanceResult{
  readonly state:FirstCanaryRuntimeAcceptanceState;
  readonly receipt:FirstCanaryAcceptanceReceipt|null;
  readonly control:PersistedPaperExecutionControl|null;
}

export function classifyAlpacaCanaryOrderState(status:string):CanaryBrokerState|null{
  const value=status.toLowerCase();
  if(value==='filled')return 'FILLED';
  if(value==='partially_filled')return 'PARTIAL';
  if(['rejected','suspended'].includes(value))return 'REJECTED';
  if(['canceled','replaced','done_for_day'].includes(value))return 'CANCELED';
  if(value==='expired')return 'EXPIRED';
  if(['new','accepted','pending_new','accepted_for_bidding','pending_replace','pending_cancel','calculated'].includes(value))
    return 'WORKING';
  return null;
}

/** Read-only broker evaluation plus one database-governed state transition.
 * The method cannot submit, replace, or cancel an order. */
export async function reconcileFirstCanaryAcceptance(input:{readonly pool:Pool;readonly broker:PaperBrokerAdapter;
  readonly executionAccountId:string;readonly asOf:string}):Promise<FirstCanaryRuntimeAcceptanceResult>{
  // Once the canary was accepted this is a permanent, idempotent no-op. Later
  // autonomous orders are ordinary managed exposure; they must never re-enter
  // the single-canary identity check (which requires exactly one new-risk order).
  if(await isAutonomousMasterPaperAccepted(input.pool))
    return {state:'AUTONOMOUS_PAPER_ACTIVE',receipt:null,control:null};
  const result=await input.pool.query(`SELECT p.plan_json,oi.order_intent_id::text,oi.execution_account_id::text,
    oi.client_order_id,oi.status::text,oi.side,oi.position_intent,oi.quantity::numeric,oi.created_at::text,
    oc.contract_symbol,bo.provider_order_id,bo.submitted_at::text,bo.acknowledged_at::text,
    EXISTS(SELECT 1 FROM trade.transaction_cost_analysis t WHERE t.order_intent_id=oi.order_intent_id) AS tca_persisted,
    EXISTS(SELECT 1 FROM trade.option_leg l WHERE l.chain_id=oi.chain_id AND l.option_contract_id=oi.option_contract_id
      AND l.quantity=oi.quantity) AS lifecycle_applied,
    EXISTS(SELECT 1 FROM copy.master_copy_event m WHERE m.master_order_intent_id=oi.order_intent_id
      AND m.master_filled_quantity=oi.quantity) AS management_registered,
    EXISTS(SELECT 1 FROM research.theta_execution_observation_job j WHERE j.candidate_id::text=p.plan_json->>'candidateId')
      AS future_observations_scheduled,
    EXISTS(SELECT 1 FROM trade.broker_reconciliation_snapshot r
      JOIN copy.follower_account fa ON fa.follower_account_id=r.connection_id
      JOIN trade.execution_account ea ON ea.execution_account_id=oi.execution_account_id
        AND encode(digest(fa.provider_account_ref,'sha256'),'hex')=ea.provider_account_ref_hash
      JOIN trade.broker_position_snapshot bp ON bp.reconciliation_snapshot_id=r.reconciliation_snapshot_id
        AND bp.symbol=oc.contract_symbol
      WHERE r.data_quality='GOOD' AND r.observed_at>=COALESCE(bo.submitted_at,oi.created_at)
        AND abs(bp.quantity)=oi.quantity) AS reconciliation_complete,
    pec.pause_new_orders,pec.master_execution_enabled,pec.follower_execution_enabled,
    (SELECT count(*)::int FROM copy.follower_order_intent foi
      JOIN copy.follower_copy_event fce USING(follower_copy_event_id)
      JOIN copy.master_copy_event mce USING(master_copy_event_id)
      WHERE mce.master_order_intent_id=oi.order_intent_id
        AND (foi.submitted_at IS NOT NULL OR foi.state<>'PLANNED')) AS follower_mutation_count
    FROM trade.master_paper_action_plan p
    JOIN trade.order_intent oi ON oi.order_intent_id=p.execution_order_intent_id
    JOIN market.option_contract oc ON oc.option_contract_id=oi.option_contract_id
    JOIN LATERAL(SELECT x.* FROM trade.broker_order x WHERE x.order_intent_id=oi.order_intent_id
      ORDER BY x.created_at DESC,x.broker_order_id DESC LIMIT 1) bo ON true
    CROSS JOIN ops.paper_execution_control pec
    WHERE p.authority_kind='NEW_RISK' AND oi.execution_account_id=$1 AND NOT ${unfilledTerminalBrokerOrderSql('bo')}
    ORDER BY p.created_at,p.action_plan_id LIMIT 2`,[input.executionAccountId]);
  if(result.rowCount===0){
    const definedRisk=await reconcileDefinedRiskCanary(input);
    if(definedRisk!==null)return definedRisk;
    // only zero-fill CANCELED/EXPIRED canaries (or none): re-armed by the governed activation after the last one -> waiting for the next canary
    const unfilled=await input.pool.query(`SELECT count(*)::int AS unfilled,
      EXISTS(SELECT 1 FROM ops.paper_execution_control pec WHERE pec.singleton=true AND pec.changed_by='OWNER_DIRECTIVE_FIRST_PAPER_CANARY'
        AND pec.changed_at>(SELECT max(x.created_at) FROM trade.broker_order x)) AS owner_rearmed
      FROM trade.broker_order bo JOIN trade.order_intent oi USING(order_intent_id)
      WHERE oi.execution_account_id=$1 AND ${unfilledTerminalBrokerOrderSql('bo')}`,[input.executionAccountId]);
    const row=unfilled.rows[0] as {unfilled?:unknown;owner_rearmed?:unknown}|undefined;
    return {state:Number(row?.unfilled??0)>0&&row?.owner_rearmed!==true?'UNFILLED_REARM_REQUIRED':'NO_CANARY',receipt:null,control:null};
  }
  if((result.rowCount??0)!==1)throw new Error('FIRST_CANARY_MULTIPLE_LOCAL_BROKER_ORDERS');
  const row=result.rows[0] as Row;
  // The post-submit relock is persisted best-effort; a transient failure there
  // must not deadlock acceptance forever. The lock only tightens authority and
  // is itself guarded by the broker-order and owner-scope predicates.
  const authorizationStore=new PostgresPaperExecutionAuthorizationStore(input.pool);
  const newRiskRelocked=row.pause_new_orders===true||await authorizationStore.lockNewRiskAfterFirstCanary(input.asOf);
  const plan=masterPaperActionPlanSchema.parse(row.plan_json) as ApprovedMasterPaperActionPlan;
  const brokerOrder=await input.broker.getOrderByClientOrderId(String(row.client_order_id));
  if(brokerOrder===null)throw new Error('FIRST_CANARY_BROKER_ORDER_MISSING');
  const allOrders=await input.broker.getOrders('all');
  const duplicates=allOrders.filter((order)=>sameEconomicExposure(order,brokerOrder)
    &&!['rejected','canceled','expired'].includes(order.status.toLowerCase())).length;
  const state=classifyAlpacaCanaryOrderState(brokerOrder.status);
  const identitySeed=economicIdentitySeed({candidateId:plan.candidateId,strategyVersion:plan.strategyVersion,action:plan.action,chainId:plan.chainId});
  const deterministic=generateClientOrderId(plan.decisionId,identitySeed,plan.pricingAttempt+1)===row.client_order_id;
  const source=(name:string)=>`${name}:${row.order_intent_id}`;
  const receipt=buildFirstCanaryAcceptanceReceipt({asOf:input.asOf,expected:{
    orderIntentId:String(row.order_intent_id),executionAccountId:String(row.execution_account_id),
    occContract:String(row.contract_symbol),side:'sell',positionIntent:'sell_to_open',quantity:Number(row.quantity),
    clientOrderId:String(row.client_order_id)},persistence:{
    decisionPersisted:good(true,source('trade.decision'),input.asOf),
    orderIntentPersisted:good(true,source('trade.order_intent'),input.asOf),
    idempotencyReserved:good(true,source('trade.order_intent.client_order_id_unique'),input.asOf),
    deterministicClientOrderId:good(deterministic,source('theta-client-order-id-v1'),input.asOf)},broker:{
    executionAccountId:good(String(row.execution_account_id),'ALPACA_PAPER_AUTHENTICATED_MASTER',input.asOf),
    occContract:good(brokerOrder.symbol,'ALPACA_PAPER_ORDER',input.asOf),side:good(brokerOrder.side,'ALPACA_PAPER_ORDER',input.asOf),
    positionIntent:brokerOrder.positionIntent===null||brokerOrder.positionIntent===undefined
      ?invalid('ALPACA_PAPER_ORDER_POSITION_INTENT',input.asOf):good(brokerOrder.positionIntent,'ALPACA_PAPER_ORDER',input.asOf),
    requestedQuantity:good(brokerOrder.qty,'ALPACA_PAPER_ORDER',input.asOf),
    filledQuantity:good(brokerOrder.filledQty,'ALPACA_PAPER_ORDER',input.asOf),
    clientOrderId:good(brokerOrder.clientOrderId,'ALPACA_PAPER_ORDER',input.asOf),
    orderState:state===null?invalid('ALPACA_PAPER_ORDER_STATUS',input.asOf):good(state,'ALPACA_PAPER_ORDER',input.asOf),
    acknowledgementObserved:good(Boolean(row.acknowledged_at)||brokerOrder.submittedAt!==null,'trade.broker_order+ALPACA_PAPER',input.asOf),
    duplicateEconomicExposureCount:good(duplicates,'ALPACA_PAPER_ALL_ORDERS',input.asOf)},evidence:{
    reconciliationComplete:good(row.reconciliation_complete===true,'trade.broker_reconciliation_snapshot',input.asOf),
    tcaPersisted:good(row.tca_persisted===true,source('trade.transaction_cost_analysis'),input.asOf),
    lifecycleApplied:good(row.lifecycle_applied===true,source('trade.option_leg'),input.asOf),
    managementRegistered:good(row.management_registered===true,source('copy.master_copy_event'),input.asOf),
    futureObservationsScheduled:good(row.future_observations_scheduled===true,
      `research.theta_execution_observation_job:${plan.candidateId}`,input.asOf),
    newRiskRelocked:good(newRiskRelocked,'ops.paper_execution_control',input.asOf),
    managementEnabled:good(row.master_execution_enabled===true,'ops.paper_execution_control',input.asOf),
    followerMutationCount:good(Number(row.follower_mutation_count??0),'copy.follower_order_intent',input.asOf),
    liveMutationCount:good(0,'PAPER_ONLY_EXECUTION_ACCOUNT_AND_ADAPTER',input.asOf)}});
  if(receipt.status!=='ACCEPTED')return {state:receipt.status==='FAILED'?'FAILED':'IN_PROGRESS',receipt,control:null};
  const control=await authorizationStore
    .activateAutonomousPaperAfterAcceptedCanary({acceptance:receipt,activatedAt:input.asOf});
  return {state:'AUTONOMOUS_PAPER_ACTIVE',receipt,control};
}

/** The first canary may be a native D package (an mleg parent with no single option contract). It is read by its own query so the
 * single-leg Q/H acceptance query above stays exactly as certified. Identity is the persisted leg set; lifecycle and management evidence
 * come from the defined-risk position registry; reconciliation must see BOTH leg positions. Returns null when no D canary exists. */
async function reconcileDefinedRiskCanary(input:{readonly pool:Pool;readonly broker:PaperBrokerAdapter;
  readonly executionAccountId:string;readonly asOf:string}):Promise<FirstCanaryRuntimeAcceptanceResult|null>{
  const result=await input.pool.query(`SELECT p.plan_json,oi.order_intent_id::text,oi.execution_account_id::text,
    oi.client_order_id,oi.quantity::numeric,oi.package_identity,bo.acknowledged_at::text,
    (SELECT json_agg(json_build_object('occ',l.occ_symbol,'positionIntent',l.position_intent,'ratio',l.ratio_quantity) ORDER BY l.leg_index)
      FROM trade.order_intent_leg l WHERE l.order_intent_id=oi.order_intent_id) AS legs,
    EXISTS(SELECT 1 FROM trade.transaction_cost_analysis t WHERE t.order_intent_id=oi.order_intent_id) AS tca_persisted,
    EXISTS(SELECT 1 FROM trade.defined_risk_position d WHERE d.order_intent_id=oi.order_intent_id AND d.opened_at IS NOT NULL) AS lifecycle_applied,
    EXISTS(SELECT 1 FROM trade.defined_risk_position d WHERE d.order_intent_id=oi.order_intent_id
      AND d.state IN ('OPEN','ASYMMETRIC_OPEN','CLOSE_PENDING','DIVERGED_EMERGENCY')) AS management_registered,
    EXISTS(SELECT 1 FROM research.theta_execution_observation_job j WHERE j.candidate_id::text=p.plan_json->>'candidateId')
      AS future_observations_scheduled,
    EXISTS(SELECT 1 FROM trade.broker_reconciliation_snapshot r
      JOIN copy.follower_account fa ON fa.follower_account_id=r.connection_id
      JOIN trade.execution_account ea ON ea.execution_account_id=oi.execution_account_id
        AND encode(digest(fa.provider_account_ref,'sha256'),'hex')=ea.provider_account_ref_hash
      WHERE r.data_quality='GOOD' AND r.observed_at>=COALESCE(bo.submitted_at,oi.created_at)
        AND NOT EXISTS(SELECT 1 FROM trade.order_intent_leg l WHERE l.order_intent_id=oi.order_intent_id
          AND NOT EXISTS(SELECT 1 FROM trade.broker_position_snapshot bp WHERE bp.reconciliation_snapshot_id=r.reconciliation_snapshot_id
            AND bp.symbol=l.occ_symbol AND abs(bp.quantity)=oi.quantity*l.ratio_quantity))) AS reconciliation_complete,
    pec.pause_new_orders,pec.master_execution_enabled,pec.follower_execution_enabled
    FROM trade.master_paper_action_plan p
    JOIN trade.order_intent oi ON oi.order_intent_id=p.execution_order_intent_id AND oi.order_class='mleg'
    JOIN LATERAL(SELECT x.* FROM trade.broker_order x WHERE x.order_intent_id=oi.order_intent_id
      ORDER BY x.created_at DESC,x.broker_order_id DESC LIMIT 1) bo ON true
    CROSS JOIN ops.paper_execution_control pec
    WHERE p.authority_kind='NEW_RISK' AND oi.execution_account_id=$1 AND NOT ${unfilledTerminalBrokerOrderSql('bo')}
    ORDER BY p.created_at,p.action_plan_id LIMIT 2`,[input.executionAccountId]);
  if(result.rowCount===0)return null;
  if((result.rowCount??0)!==1)throw new Error('FIRST_CANARY_MULTIPLE_LOCAL_BROKER_ORDERS');
  const row=result.rows[0] as Row;
  const expectedLegs=(Array.isArray(row.legs)?row.legs:[]) as CanaryPackageLeg[];
  const authorizationStore=new PostgresPaperExecutionAuthorizationStore(input.pool);
  const newRiskRelocked=row.pause_new_orders===true||await authorizationStore.lockNewRiskAfterFirstCanary(input.asOf);
  const plan=masterPaperActionPlanSchema.parse(row.plan_json) as ApprovedMasterPaperActionPlan;
  const brokerOrder=await input.broker.getOrderByClientOrderId(String(row.client_order_id));
  if(brokerOrder===null)throw new Error('FIRST_CANARY_BROKER_ORDER_MISSING');
  const allOrders=await input.broker.getOrders('all');
  const duplicates=allOrders.filter((order)=>sameEconomicExposure(order,brokerOrder)
    &&!['rejected','canceled','expired'].includes(order.status.toLowerCase())).length;
  const state=classifyAlpacaCanaryOrderState(brokerOrder.status);
  const identitySeed=economicIdentitySeed({candidateId:plan.candidateId,strategyVersion:plan.strategyVersion,action:plan.action,chainId:plan.chainId});
  const deterministic=generateClientOrderId(plan.decisionId,identitySeed,plan.pricingAttempt+1)===row.client_order_id;
  const source=(name:string)=>`${name}:${row.order_intent_id}`;
  const brokerLegs=brokerOrder.orderClass==='mleg'&&brokerOrder.legs!==undefined&&brokerOrder.legs.length>=2
    ?good(brokerOrder.legs.map((leg)=>({occ:leg.symbol,positionIntent:String(leg.positionIntent??'UNKNOWN'),ratio:leg.ratioQty,filledQuantity:leg.filledQty})),
      'ALPACA_PAPER_ORDER_LEGS',input.asOf)
    :invalid<readonly {occ:string;positionIntent:string;ratio:number;filledQuantity:number}[]>('ALPACA_PAPER_ORDER_LEGS',input.asOf);
  const receipt=buildFirstCanaryAcceptanceReceipt({asOf:input.asOf,expected:{
    orderIntentId:String(row.order_intent_id),executionAccountId:String(row.execution_account_id),
    occContract:String(row.package_identity),side:'sell',positionIntent:'sell_to_open',quantity:Number(row.quantity),
    clientOrderId:String(row.client_order_id),package:{legs:expectedLegs}},persistence:{
    decisionPersisted:good(true,source('trade.decision'),input.asOf),
    orderIntentPersisted:good(true,source('trade.order_intent'),input.asOf),
    idempotencyReserved:good(true,source('trade.order_intent.client_order_id_unique'),input.asOf),
    deterministicClientOrderId:good(deterministic,source('theta-client-order-id-v1'),input.asOf)},broker:{
    executionAccountId:good(String(row.execution_account_id),'ALPACA_PAPER_AUTHENTICATED_MASTER',input.asOf),
    occContract:good(brokerOrder.symbol,'ALPACA_PAPER_ORDER',input.asOf),side:good(brokerOrder.side,'ALPACA_PAPER_ORDER',input.asOf),
    positionIntent:invalid('MLEG_PARENT_HAS_NO_SINGLE_POSITION_INTENT',input.asOf),
    requestedQuantity:good(brokerOrder.qty,'ALPACA_PAPER_ORDER',input.asOf),
    filledQuantity:good(brokerOrder.filledQty,'ALPACA_PAPER_ORDER',input.asOf),
    clientOrderId:good(brokerOrder.clientOrderId,'ALPACA_PAPER_ORDER',input.asOf),
    orderState:state===null?invalid('ALPACA_PAPER_ORDER_STATUS',input.asOf):good(state,'ALPACA_PAPER_ORDER',input.asOf),
    acknowledgementObserved:good(Boolean(row.acknowledged_at)||brokerOrder.submittedAt!==null,'trade.broker_order+ALPACA_PAPER',input.asOf),
    duplicateEconomicExposureCount:good(duplicates,'ALPACA_PAPER_ALL_ORDERS',input.asOf),packageLegs:brokerLegs},evidence:{
    reconciliationComplete:good(row.reconciliation_complete===true,'trade.broker_reconciliation_snapshot:both_legs',input.asOf),
    tcaPersisted:good(row.tca_persisted===true,source('trade.transaction_cost_analysis'),input.asOf),
    lifecycleApplied:good(row.lifecycle_applied===true,source('trade.defined_risk_position.opened_at'),input.asOf),
    managementRegistered:good(row.management_registered===true,source('trade.defined_risk_position.active'),input.asOf),
    futureObservationsScheduled:good(row.future_observations_scheduled===true,
      `research.theta_execution_observation_job:${plan.candidateId}`,input.asOf),
    newRiskRelocked:good(newRiskRelocked,'ops.paper_execution_control',input.asOf),
    managementEnabled:good(row.master_execution_enabled===true,'ops.paper_execution_control',input.asOf),
    followerMutationCount:good(0,'copy.follower_order_intent:none_for_defined_risk',input.asOf),
    liveMutationCount:good(0,'PAPER_ONLY_EXECUTION_ACCOUNT_AND_ADAPTER',input.asOf)}});
  if(receipt.status!=='ACCEPTED')return {state:receipt.status==='FAILED'?'FAILED':'IN_PROGRESS',receipt,control:null};
  const control=await authorizationStore
    .activateAutonomousPaperAfterAcceptedCanary({acceptance:receipt,activatedAt:input.asOf});
  return {state:'AUTONOMOUS_PAPER_ACTIVE',receipt,control};
}

function sameEconomicExposure(left:BrokerOrderSnapshot,right:BrokerOrderSnapshot):boolean{
  return left.symbol===right.symbol&&left.side===right.side
    &&(left.positionIntent??null)===(right.positionIntent??null);
}
