import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { PostgresLifecycleApplicationStore,type LifecycleApplicationResult,type LifecycleApplication } from '../theta/postgres-lifecycle-application-store.js';
import { confirmedMasterCopyEventId,PostgresDisabledCopyPlanner } from '../customer/postgres-disabled-copy-planner.js';
import type { MasterCopyEvent } from '../customer/copy-engine-contract.js';

type Row = Record<string,unknown>;
const n=(value:unknown):number|null=>value==null?null:Number.isFinite(Number(value))?Number(value):null;
const s=(value:unknown):string|null=>value==null?null:String(value);
const hash=(value:string):string=>createHash('sha256').update(value).digest('hex');

export interface LifecycleOrchestrationReport {
  readonly inspected:number; readonly applied:number; readonly duplicates:number; readonly unresolved:number;
  readonly results:readonly LifecycleApplicationResult[];
}

/**
 * Applies only assignment and expiration facts confirmed by broker activity
 * plus consecutive immutable position snapshots. Fill-driven opens, closes,
 * and rolls remain owned by order reconciliation and are never inferred here.
 */
export async function applyConfirmedTerminalLifecycle(pool:Pool,connectionId:string,
  currentSnapshotId:string,observedAt:string):Promise<LifecycleOrchestrationReport> {
  const previous=await pool.query(`SELECT reconciliation_snapshot_id FROM trade.broker_reconciliation_snapshot
    WHERE connection_id=$1 AND reconciliation_snapshot_id<>$2 AND observed_at <= (SELECT observed_at FROM trade.broker_reconciliation_snapshot WHERE reconciliation_snapshot_id=$2)
    ORDER BY observed_at DESC LIMIT 1`,[connectionId,currentSnapshotId]);
  if (previous.rowCount!==1) return {inspected:0,applied:0,duplicates:0,unresolved:0,results:[]};
  const rows=await pool.query(`SELECT ec.chain_id,ec.bot_instance_id,ec.lifecycle_state,ol.option_leg_id,ol.option_contract_id,
      ol.quantity AS contracts,ol.entry_credit_debit,oc.contract_symbol,oc.option_type,oc.strike,oc.multiplier,u.symbol AS underlying,
      previous_option.quantity AS previous_option_qty,current_option.quantity AS current_option_qty,
      previous_stock.quantity AS previous_stock_qty,current_stock.quantity AS current_stock_qty,
      current_stock.average_entry_price AS broker_stock_basis,
      activity.broker_activity_fact_id,activity.provider_activity_ref_hash,activity.activity_type,activity.quantity AS activity_quantity,
      activity.price AS activity_price,activity.activity_at,stock.stock_lot_id,stock.shares AS stock_lot_shares,
      stock.economic_basis_per_share
    FROM trade.economic_chain ec JOIN core.bot_instance bi ON bi.bot_instance_id=ec.bot_instance_id
    JOIN market.underlying u ON u.underlying_id=ec.underlying_id
    JOIN trade.option_leg ol ON ol.chain_id=ec.chain_id AND ol.closed_at IS NULL
    JOIN market.option_contract oc ON oc.option_contract_id=ol.option_contract_id
    LEFT JOIN trade.broker_position_snapshot previous_option ON previous_option.reconciliation_snapshot_id=$2 AND previous_option.symbol=oc.contract_symbol
    LEFT JOIN trade.broker_position_snapshot current_option ON current_option.reconciliation_snapshot_id=$3 AND current_option.symbol=oc.contract_symbol
    LEFT JOIN trade.broker_position_snapshot previous_stock ON previous_stock.reconciliation_snapshot_id=$2 AND previous_stock.symbol=u.symbol
    LEFT JOIN trade.broker_position_snapshot current_stock ON current_stock.reconciliation_snapshot_id=$3 AND current_stock.symbol=u.symbol
    LEFT JOIN LATERAL(SELECT baf.* FROM trade.broker_activity_fact baf WHERE baf.connection_id=$1
      AND baf.symbol=oc.contract_symbol AND baf.activity_type IN ('OPASN','OPEXP') AND baf.activity_at <= $4
      ORDER BY baf.activity_at DESC NULLS LAST LIMIT 1) activity ON true
    LEFT JOIN LATERAL(SELECT sl.* FROM trade.stock_lot sl WHERE sl.chain_id=ec.chain_id AND sl.disposed_at IS NULL ORDER BY sl.acquired_at LIMIT 1) stock ON true
    WHERE EXISTS(SELECT 1 FROM copy.follower_account fa WHERE fa.follower_account_id=$1
      AND fa.account_role='MASTER_THETA_PAPER' AND fa.environment='PAPER' AND fa.disconnected_at IS NULL)
      AND bi.bot_code='THETA' AND ec.closed_at IS NULL AND ec.lifecycle_state IN ('CSP_OPEN','CC_OPEN')`,
    [connectionId,String(previous.rows[0].reconciliation_snapshot_id),currentSnapshotId,observedAt]);
  const store=new PostgresLifecycleApplicationStore(pool),copyPlanner=new PostgresDisabledCopyPlanner(pool),results:LifecycleApplicationResult[]=[];
  let unresolved=0;
  for (const row of rows.rows as Row[]) {
    const contracts=n(row.contracts),multiplier=n(row.multiplier),previousOption=n(row.previous_option_qty)??0,
      currentOption=n(row.current_option_qty)??0,activityType=s(row.activity_type),activityQty=n(row.activity_quantity),
      priorShares=n(row.previous_stock_qty)??0,currentShares=n(row.current_stock_qty)??0,strike=n(row.strike),
      credit=n(row.entry_credit_debit),activityHash=s(row.provider_activity_ref_hash);
    if (contracts===null||multiplier===null||strike===null||credit===null||activityHash===null||previousOption>=0||currentOption!==0) { unresolved++; continue; }
    const expectedShares=contracts*multiplier, occurredAt=s(row.activity_at)??observedAt;
    let application:LifecycleApplication|null=null;
    const common={chainId:String(row.chain_id),occurredAt,decisionId:null,providerActivityRefHash:activityHash};
    if (activityType==='OPEXP') {
      if (String(row.lifecycle_state)==='CC_OPEN'&&currentShares<expectedShares) { unresolved++; continue; }
      application={...common,eventKind:'OPTION_EXPIRATION',optionLegId:String(row.option_leg_id),itm:false,realizedOptionPnl:credit,
        evidenceKey:hash(`${activityHash}:${row.chain_id}:OPTION_EXPIRATION`)};
    } else if (activityType==='OPASN'&&activityQty!==null&&Math.abs(activityQty)===contracts&&String(row.lifecycle_state)==='CSP_OPEN'&&currentShares-priorShares>=expectedShares) {
      application={...common,eventKind:'SHORT_PUT_ASSIGNMENT',optionLegId:String(row.option_leg_id),
        stockLotId:deterministicRuntimeUuid(`stock-lot:${activityHash}:${row.chain_id}`),shares:expectedShares,strikePrice:strike,
        brokerBasisPerShare:n(row.broker_stock_basis),economicBasisPerShare:strike,realizedOptionPnl:credit,
        evidenceKey:hash(`${activityHash}:${row.chain_id}:SHORT_PUT_ASSIGNMENT`)};
    } else if (activityType==='OPASN'&&activityQty!==null&&Math.abs(activityQty)===contracts&&String(row.lifecycle_state)==='CC_OPEN'&&priorShares-currentShares>=expectedShares) {
      const basis=n(row.economic_basis_per_share),lotShares=n(row.stock_lot_shares);
      if (basis===null||lotShares===null||s(row.stock_lot_id)===null||lotShares!==expectedShares) { unresolved++; continue; }
      application={...common,eventKind:'COVERED_CALL_ASSIGNMENT',optionLegId:String(row.option_leg_id),stockLotId:String(row.stock_lot_id),
        shares:expectedShares,strikePrice:strike,realizedOptionPnl:credit,realizedStockPnl:(strike-basis)*expectedShares,
        evidenceKey:hash(`${activityHash}:${row.chain_id}:COVERED_CALL_ASSIGNMENT`)};
    }
    if (application===null) { unresolved++; continue; }
    const applied=await store.apply(application); results.push(applied);
    const copyAction:MasterCopyEvent['action']=application.eventKind==='SHORT_PUT_ASSIGNMENT'?'ASSIGN_STOCK':
      application.eventKind==='COVERED_CALL_ASSIGNMENT'?'CALL_AWAY':String(row.lifecycle_state)==='CSP_OPEN'?'EXPIRE_CSP':'EXPIRE_CC';
    const event:MasterCopyEvent={masterDecisionId:null,masterLifecycleId:String(row.chain_id),masterOrderId:null,masterFillId:null,
      action:copyAction,symbol:String(row.contract_symbol),contractId:String(row.option_contract_id),masterQuantity:contracts,
      masterFilledQuantity:contracts,occurredAt};
    await copyPlanner.persistConfirmedEvent({masterCopyEventId:confirmedMasterCopyEventId(event),masterBotInstanceId:String(row.bot_instance_id),
      masterChainId:String(row.chain_id),parentMasterCopyEventId:null,brokerActivityFactId:String(row.broker_activity_fact_id),
      payloadHash:hash(JSON.stringify(event)),event},[]);
  }
  return {inspected:rows.rowCount??0,applied:results.filter((item)=>!item.duplicate).length,
    duplicates:results.filter((item)=>item.duplicate).length,unresolved,results};
}
