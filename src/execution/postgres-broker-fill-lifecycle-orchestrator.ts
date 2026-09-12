import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { routeConfirmedFillLifecycle,routeConfirmedRollPair,type ConfirmedFillFact,type FillLifecycleContext } from './broker-fill-lifecycle-router.js';
import { PostgresLifecycleApplicationStore,type LifecycleApplicationResult } from '../theta/postgres-lifecycle-application-store.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';

type Row=Record<string,unknown>;
const n=(v:unknown):number|null=>v==null||!Number.isFinite(Number(v))?null:Number(v);
const s=(v:unknown):string|null=>v==null?null:String(v);
const h=(v:string):string=>createHash('sha256').update(v).digest('hex');
const fills=(value:unknown):ConfirmedFillFact[]=>Array.isArray(value)?value.map((raw)=>{
  const row=raw as Row; return {providerFillId:String(row.provider_fill_id),providerActivityRefHash:h(String(row.provider_fill_id)),
    quantity:Number(row.quantity),pricePerShare:Number(row.price_per_share),occurredAt:String(row.filled_at),fees:n(row.fees)};
}):[];

export interface FillLifecycleOrchestrationReport{readonly inspected:number;readonly applied:number;readonly duplicates:number;
  readonly partial:number;readonly unresolved:number;readonly results:readonly LifecycleApplicationResult[];}

/** Routes fully broker-confirmed THETA fills into the same atomic lifecycle writer used by assignment and expiry. */
export async function applyConfirmedFillLifecycle(pool:Pool,connectionId:string,observedAt:string):Promise<FillLifecycleOrchestrationReport>{
  const rows=await pool.query(`SELECT oi.order_intent_id,oi.chain_id,oi.decision_id,oi.theta_action,oi.status,oi.quantity AS order_quantity,
    oi.option_contract_id,oi.underlying_id,oc.multiplier,ol.option_leg_id,ol.entry_credit_debit,
    sl.stock_lot_id,sl.economic_basis_per_share,
    COALESCE(jsonb_agg(jsonb_build_object('provider_fill_id',f.provider_fill_id,'quantity',f.quantity,
      'price_per_share',f.price_per_share,'filled_at',f.filled_at,'fees',f.fees) ORDER BY f.filled_at,f.provider_fill_id)
      FILTER(WHERE f.fill_id IS NOT NULL),'[]'::jsonb) AS fills
    FROM trade.order_intent oi JOIN trade.execution_account ea ON ea.execution_account_id=oi.execution_account_id
    JOIN copy.follower_account fa ON encode(digest(fa.provider_account_ref,'sha256'),'hex')=ea.provider_account_ref_hash
      AND fa.follower_account_id=$1 AND fa.account_role='MASTER_THETA_PAPER' AND fa.environment='PAPER' AND fa.disconnected_at IS NULL
    LEFT JOIN market.option_contract oc ON oc.option_contract_id=oi.option_contract_id
    LEFT JOIN trade.broker_order bo ON bo.order_intent_id=oi.order_intent_id
    LEFT JOIN trade.fill f ON f.broker_order_id=bo.broker_order_id
    LEFT JOIN LATERAL(SELECT l.option_leg_id,l.entry_credit_debit FROM trade.option_leg l WHERE l.chain_id=oi.chain_id AND l.closed_at IS NULL ORDER BY l.opened_at DESC LIMIT 1) ol ON true
    LEFT JOIN LATERAL(SELECT x.stock_lot_id,x.economic_basis_per_share FROM trade.stock_lot x WHERE x.chain_id=oi.chain_id AND x.disposed_at IS NULL ORDER BY x.acquired_at LIMIT 1) sl ON true
    WHERE oi.chain_id IS NOT NULL AND (f.filled_at IS NULL OR f.filled_at <= $2)
      AND oi.theta_action IN ('OPEN_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','OPEN_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN','SELL_STOCK')
    GROUP BY oi.order_intent_id,oc.multiplier,ol.option_leg_id,ol.entry_credit_debit,sl.stock_lot_id,sl.economic_basis_per_share
    ORDER BY oi.created_at,oi.order_intent_id`,[connectionId,observedAt]);
  const store=new PostgresLifecycleApplicationStore(pool),results:LifecycleApplicationResult[]=[];
  let partial=0,unresolved=0; const rollRows=new Map<string,Row[]>();
  for(const row of rows.rows as Row[]){
    const action=String(row.theta_action) as FillLifecycleContext['action'];
    if(action.startsWith('ROLL_')){const key=`${row.chain_id}:${row.decision_id}`;const list=rollRows.get(key)??[];list.push(row);rollRows.set(key,list);continue;}
    const context:FillLifecycleContext={action,orderStatus:String(row.status),orderQuantity:Number(row.order_quantity),chainId:String(row.chain_id),
      decisionId:s(row.decision_id),optionLegId:action==='OPEN_CSP'||action==='OPEN_CC'?deterministicRuntimeUuid(`option-leg:${row.order_intent_id}`):s(row.option_leg_id),
      optionContractId:s(row.option_contract_id),stockLotId:s(row.stock_lot_id),multiplier:n(row.multiplier),entryCreditDebit:n(row.entry_credit_debit),
      economicBasisPerShare:n(row.economic_basis_per_share),nextState:action==='CLOSE_CSP'?'REDEPLOY':action==='CLOSE_CC'?'RECOVERY_WAIT':action==='SELL_STOCK'?'CLOSED':null,
      fills:fills(row.fills)};
    const routed=routeConfirmedFillLifecycle(context);
    if(routed.state==='PARTIAL'){partial++;continue;} if(routed.application===null){unresolved++;continue;}
    results.push(await store.apply(routed.application));
  }
  for(const pair of rollRows.values()){
    const close=pair.find((row)=>String(row.theta_action).endsWith('_CLOSE'));
    const open=pair.find((row)=>String(row.theta_action).endsWith('_OPEN'));
    if(close===undefined||open===undefined){unresolved++;continue;}
    const multiplier=n(open.multiplier),credit=n(close.entry_credit_debit),oldLeg=s(close.option_leg_id),contract=s(open.option_contract_id);
    if(multiplier===null||credit===null||oldLeg===null||contract===null){unresolved++;continue;}
    const routed=routeConfirmedRollPair({legKind:String(close.theta_action).includes('CSP')?'SHORT_PUT':'COVERED_CALL',chainId:String(close.chain_id),
      decisionId:s(close.decision_id),oldOptionLegId:oldLeg,newOptionLegId:deterministicRuntimeUuid(`option-leg:${open.order_intent_id}`),
      newOptionContractId:contract,multiplier,oldEntryCreditDebit:credit,
      close:{orderStatus:String(close.status),orderQuantity:Number(close.order_quantity),fills:fills(close.fills)},
      open:{orderStatus:String(open.status),orderQuantity:Number(open.order_quantity),fills:fills(open.fills)}});
    if(routed.state==='PARTIAL'){partial++;continue;} if(routed.application===null){unresolved++;continue;}
    results.push(await store.apply(routed.application));
  }
  return {inspected:rows.rowCount??0,applied:results.filter((r)=>!r.duplicate).length,duplicates:results.filter((r)=>r.duplicate).length,partial,unresolved,results};
}
