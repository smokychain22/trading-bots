import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { fillEvidenceKey,routeConfirmedFillLifecycle,routeConfirmedRollPair,type ConfirmedFillFact,type FillLifecycleContext } from './broker-fill-lifecycle-router.js';
import type { OpenStockLot } from './stock-lot-allocation.js';
import { PostgresLifecycleApplicationStore,type LifecycleApplicationResult } from '../theta/postgres-lifecycle-application-store.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { confirmedMasterCopyEventId,PostgresDisabledCopyPlanner } from '../customer/postgres-disabled-copy-planner.js';
import type { MasterCopyEvent } from '../customer/copy-engine-contract.js';

type Row=Record<string,unknown>;
const n=(v:unknown):number|null=>v==null||!Number.isFinite(Number(v))?null:Number(v);
const s=(v:unknown):string|null=>v==null?null:String(v);
const h=(v:string):string=>createHash('sha256').update(v).digest('hex');
const fills=(value:unknown):ConfirmedFillFact[]=>Array.isArray(value)?value.map((raw)=>{
  const row=raw as Row; return {providerFillId:String(row.provider_fill_id),providerActivityRefHash:h(String(row.provider_fill_id)),
    quantity:Number(row.quantity),pricePerShare:Number(row.price_per_share),occurredAt:String(row.filled_at),fees:n(row.fees)};
}):[];

/** Open lots of the chain as aggregated by the query. Malformed lot facts become UNKNOWN basis/shares, never zero. */
const openStockLots=(value:unknown):readonly OpenStockLot[]=>Array.isArray(value)?value.map((raw)=>{
  const row=raw as Row; return {stockLotId:String(row.stock_lot_id),shares:Number(row.shares),
    economicBasisPerShare:n(row.economic_basis_per_share),acquiredAt:s(row.acquired_at)};
}):[];

export interface FillLifecycleOrchestrationReport{readonly inspected:number;readonly applied:number;readonly duplicates:number;
  readonly partial:number;readonly unresolved:number;readonly results:readonly LifecycleApplicationResult[];}

/** Routes fully broker-confirmed THETA fills into the same atomic lifecycle writer used by assignment and expiry. */
export async function applyConfirmedFillLifecycle(pool:Pool,connectionId:string,observedAt:string):Promise<FillLifecycleOrchestrationReport>{
  const rows=await pool.query(`SELECT oi.order_intent_id,oi.chain_id,ec.bot_instance_id,oi.decision_id,oi.theta_action,oi.status,oi.quantity AS order_quantity,
    oi.option_contract_id,oi.underlying_id,oc.contract_symbol,u.symbol AS underlying_symbol,oc.multiplier,ol.option_leg_id,ol.entry_credit_debit,
    ol.original_leg_quantity,COALESCE(pc.partial_closed_quantity,0) AS partial_closed_quantity,
    COALESCE(pc.partial_realized_pnl,0) AS partial_realized_pnl,
    sl.open_stock_lots,
    COALESCE(jsonb_agg(jsonb_build_object('provider_fill_id',f.provider_fill_id,'quantity',f.quantity,
      'price_per_share',f.price_per_share,'filled_at',f.filled_at,'fees',f.fees) ORDER BY f.filled_at,f.provider_fill_id)
      FILTER(WHERE f.fill_id IS NOT NULL),'[]'::jsonb) AS fills
    ,COALESCE(jsonb_agg(f.fill_id::text ORDER BY f.filled_at,f.provider_fill_id)
      FILTER(WHERE f.fill_id IS NOT NULL),'[]'::jsonb) AS fill_ids
    FROM trade.order_intent oi JOIN trade.execution_account ea ON ea.execution_account_id=oi.execution_account_id
    JOIN trade.economic_chain ec ON ec.chain_id=oi.chain_id
    JOIN market.underlying u ON u.underlying_id=ec.underlying_id
    JOIN copy.follower_account fa ON encode(digest(fa.provider_account_ref,'sha256'),'hex')=ea.provider_account_ref_hash
      AND fa.follower_account_id=$1 AND fa.account_role='MASTER_THETA_PAPER' AND fa.environment='PAPER' AND fa.disconnected_at IS NULL
    LEFT JOIN market.option_contract oc ON oc.option_contract_id=oi.option_contract_id
    LEFT JOIN trade.broker_order bo ON bo.order_intent_id=oi.order_intent_id
    LEFT JOIN trade.fill f ON f.broker_order_id=bo.broker_order_id
    LEFT JOIN LATERAL(SELECT l.option_leg_id,l.entry_credit_debit,l.quantity AS original_leg_quantity FROM trade.option_leg l WHERE l.chain_id=oi.chain_id
      AND l.option_contract_id=oi.option_contract_id AND l.opened_at<=oi.created_at ORDER BY l.opened_at DESC,l.option_leg_id LIMIT 1) ol ON true
    LEFT JOIN LATERAL(SELECT sum(p.closed_quantity) AS partial_closed_quantity,
      sum(p.realized_pnl_before_fees) AS partial_realized_pnl
      FROM trade.option_partial_close_realization p WHERE p.option_leg_id=ol.option_leg_id) pc ON true
    LEFT JOIN LATERAL(SELECT COALESCE(jsonb_agg(jsonb_build_object('stock_lot_id',x.stock_lot_id,'shares',x.shares,'economic_basis_per_share',x.economic_basis_per_share,'acquired_at',x.acquired_at) ORDER BY x.acquired_at,x.stock_lot_id),'[]'::jsonb) AS open_stock_lots FROM trade.stock_lot x WHERE x.chain_id=oi.chain_id AND x.disposed_at IS NULL) sl ON true
    WHERE oi.chain_id IS NOT NULL AND (f.filled_at IS NULL OR f.filled_at <= $2)
      AND oi.theta_action IN ('OPEN_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','OPEN_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN','SELL_STOCK')
    GROUP BY oi.order_intent_id,ec.bot_instance_id,oc.contract_symbol,u.symbol,oc.multiplier,ol.option_leg_id,
      ol.entry_credit_debit,ol.original_leg_quantity,pc.partial_closed_quantity,pc.partial_realized_pnl,
      sl.open_stock_lots
    ORDER BY oi.created_at,oi.order_intent_id`,[connectionId,observedAt]);
  const store=new PostgresLifecycleApplicationStore(pool),copyPlanner=new PostgresDisabledCopyPlanner(pool),results:LifecycleApplicationResult[]=[];
  let partial=0,unresolved=0,alreadyApplied=0; const rollRows=new Map<string,Row[]>();
  // A coded domain rejection (for example STOCK_DISPOSAL_LEAVES_OPEN_LOTS on a stale snapshot) rolls that one application back and is
  // reported as unresolved; it must not stop every other chain's fills from being applied. Infrastructure errors still abort the cycle.
  const applySafely=async(application:Parameters<PostgresLifecycleApplicationStore['apply']>[0]):Promise<LifecycleApplicationResult|null>=>{
    try{return await store.apply(application);}
    catch(error){if(error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)){unresolved++;return null;}throw error;}
  };
  const persistMasterFillEvent=async(row:Row,parentMasterCopyEventId:string|null=null):Promise<string|null>=>{
    const decision=s(row.decision_id),chain=s(row.chain_id),bot=s(row.bot_instance_id),order=s(row.order_intent_id);
    const fillIds=Array.isArray(row.fill_ids)?row.fill_ids.map(String):[],facts=fills(row.fills);
    const fillId=fillIds.at(-1)??null,filled=facts.reduce((sum,item)=>sum+item.quantity,0),quantity=n(row.order_quantity);
    if(decision===null||chain===null||bot===null||order===null||fillId===null||quantity===null||filled<=0||filled>quantity) return null;
    const action=String(row.theta_action) as MasterCopyEvent['action'];
    const event:MasterCopyEvent={masterDecisionId:decision,masterLifecycleId:chain,masterOrderId:order,masterFillId:fillId,
      action,symbol:String(row.contract_symbol??row.underlying_symbol),contractId:s(row.option_contract_id),
      masterQuantity:quantity,masterFilledQuantity:filled,occurredAt:facts.at(-1)?.occurredAt??observedAt};
    const id=confirmedMasterCopyEventId(event);
    await copyPlanner.persistConfirmedEvent({masterCopyEventId:id,masterBotInstanceId:bot,masterChainId:chain,
      parentMasterCopyEventId,brokerActivityFactId:null,payloadHash:h(JSON.stringify(event)),event},[]);
    return id;
  };
  for(const row of rows.rows as Row[]){
    const action=String(row.theta_action) as FillLifecycleContext['action'];
    if(action.startsWith('ROLL_')){const key=`${row.chain_id}:${row.decision_id}`;const list=rollRows.get(key)??[];list.push(row);rollRows.set(key,list);continue;}
    const context:FillLifecycleContext={action,orderStatus:String(row.status),orderQuantity:Number(row.order_quantity),
      orderIntentId:s(row.order_intent_id),originalLegQuantity:n(row.original_leg_quantity),
      priorPartialClosedQuantity:n(row.partial_closed_quantity)??0,priorPartialRealizedOptionPnl:n(row.partial_realized_pnl)??0,
      chainId:String(row.chain_id),
      decisionId:s(row.decision_id),optionLegId:action==='OPEN_CSP'||action==='OPEN_CC'?deterministicRuntimeUuid(`option-leg:${row.order_intent_id}`):s(row.option_leg_id),
      optionContractId:s(row.option_contract_id),stockLotId:null,openStockLots:openStockLots(row.open_stock_lots),multiplier:n(row.multiplier),entryCreditDebit:n(row.entry_credit_debit),
      economicBasisPerShare:null,nextState:action==='CLOSE_CSP'?'REDEPLOY':action==='CLOSE_CC'?'RECOVERY_WAIT':action==='SELL_STOCK'?'CLOSED':null,
      fills:fills(row.fills)};
    if(action==='SELL_STOCK'&&(context.openStockLots?.length??0)===0&&context.fills.length>0){
      // Every lot is already disposed: if this fill set was already applied it is a duplicate, not an unresolved fact.
      const applied=await pool.query(`SELECT 1 FROM trade.lifecycle_application WHERE evidence_key=$1 AND chain_id=$2
        AND event_kind='STOCK_DISPOSAL'`,[fillEvidenceKey(context.fills),context.chainId]);
      if((applied.rowCount??0)>0){alreadyApplied++;continue;}
    }
    const routed=routeConfirmedFillLifecycle(context);
    if(routed.state==='PARTIAL'){
      partial++;
      if(routed.application!==null){const applied=await applySafely(routed.application);if(applied!==null){results.push(applied);if(await persistMasterFillEvent(row)===null)unresolved++;}}
      continue;
    } if(routed.application===null){unresolved++;continue;}
    const appliedFill=await applySafely(routed.application);
    if(appliedFill===null)continue;
    results.push(appliedFill);
    if(await persistMasterFillEvent(row)===null) unresolved++;
  }
  for(const pair of rollRows.values()){
    const close=pair.find((row)=>String(row.theta_action).endsWith('_CLOSE'));
    const open=pair.find((row)=>String(row.theta_action).endsWith('_OPEN'));
    if(close===undefined){unresolved++;continue;}
    if((n(close.partial_closed_quantity)??0)>0){partial++;unresolved++;continue;}
    const closed=routeConfirmedFillLifecycle({action:String(close.theta_action) as FillLifecycleContext['action'],
      orderStatus:String(close.status),orderQuantity:Number(close.order_quantity),chainId:String(close.chain_id),
      orderIntentId:s(close.order_intent_id),originalLegQuantity:n(close.original_leg_quantity),
      priorPartialClosedQuantity:n(close.partial_closed_quantity)??0,priorPartialRealizedOptionPnl:n(close.partial_realized_pnl)??0,
      decisionId:s(close.decision_id),optionLegId:s(close.option_leg_id),optionContractId:s(close.option_contract_id),
      stockLotId:null,multiplier:n(close.multiplier),entryCreditDebit:n(close.entry_credit_debit),economicBasisPerShare:null,
      nextState:'ROLL_DECISION',fills:fills(close.fills)});
    if(closed.state==='PARTIAL'){
      partial++;
      if(closed.application!==null){const applied=await applySafely(closed.application);if(applied!==null){results.push(applied);if(await persistMasterFillEvent(close)===null)unresolved++;}}
      continue;
    }
    if(closed.application===null){partial++;continue;}
    const appliedClose=await applySafely(closed.application);
    if(appliedClose===null)continue;
    results.push(appliedClose);
    if(open===undefined){unresolved++;continue;}
    const multiplier=n(open.multiplier),credit=n(close.entry_credit_debit),oldLeg=s(close.option_leg_id),contract=s(open.option_contract_id);
    if(multiplier===null||credit===null||oldLeg===null||contract===null){unresolved++;continue;}
    const routed=routeConfirmedRollPair({legKind:String(close.theta_action).includes('CSP')?'SHORT_PUT':'COVERED_CALL',chainId:String(close.chain_id),
      decisionId:s(close.decision_id),oldOptionLegId:oldLeg,newOptionLegId:deterministicRuntimeUuid(`option-leg:${open.order_intent_id}`),
      newOptionContractId:contract,multiplier,oldEntryCreditDebit:credit,
      close:{orderStatus:String(close.status),orderQuantity:Number(close.order_quantity),fills:fills(close.fills)},
      open:{orderStatus:String(open.status),orderQuantity:Number(open.order_quantity),fills:fills(open.fills)}});
    if(routed.state==='PARTIAL'){partial++;continue;} if(routed.application===null){unresolved++;continue;}
    const appliedRoll=await applySafely(routed.application);
    if(appliedRoll===null)continue;
    results.push(appliedRoll);
    const closeEventId=await persistMasterFillEvent(close);
    if(closeEventId===null||await persistMasterFillEvent(open,closeEventId)===null) unresolved++;
  }
  return {inspected:rows.rowCount??0,applied:results.filter((r)=>!r.duplicate).length,duplicates:results.filter((r)=>r.duplicate).length+alreadyApplied,partial,unresolved,results};
}
